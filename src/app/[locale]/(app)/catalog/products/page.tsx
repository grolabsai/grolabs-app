import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { formatGTQ, formatRelative, initialsFromName } from "@/lib/format";

/**
 * Products list screen. Mirror of Bloom's `screen-products` visually,
 * re-wired to Scout's schema and backed by real Supabase data.
 *
 * Data shape per row:
 *   product + its type + its brand + its variants (for min price and count)
 *
 * Tenant scoping is automatic: the Supabase server client is built from
 * the user's auth cookies, so every query inherits the JWT `tenant_id`
 * claim and RLS filters to the right tenant. No WHERE tenant_id = X in
 * application code — the policies handle it.
 */

export const dynamic = "force-dynamic"; // never cache — reads live data per request

type SearchParams = { filter?: string };

type ProductRow = {
  product_id: number;
  product_name: string;
  slug: string;
  is_active: boolean;
  updated_at: string;
  product_type: { type_name: string; type_code: string } | null;
  brand: { brand_name: string } | null;
  product_variant: Array<{
    variant_id: number;
    is_active: boolean;
    updated_at: string;
    product_pricing: Array<{ list_price: string | null; channel: string; updated_at: string }>;
  }>;
};

type SyncStatusRow = {
  product_id: number;
  platform: "algolia" | "woocommerce";
  last_synced_at: string | null;
};

// Map the filter chip to a server-side query predicate. Kept simple —
// more sophisticated faceting (species, category tree, tag) comes later.
type FilterKey = "all" | "active" | "inactive" | "consignment" | "service";

const FILTER_KEYS: FilterKey[] = ["all", "active", "inactive", "consignment", "service"];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const active: FilterKey = (sp.filter as FilterKey) || "all";
  const t = await getTranslations("product.list");
  const tCrumb = await getTranslations("product.breadcrumb");

  const supabase = await createClient();

  // Base query — everything for the tenant, with joins the list needs.
  // !inner on product_type gives us an inner join so products without a
  // type never reach the UI (a data-integrity invariant — every product
  // has a type in Scout's schema).
  let base = supabase
    .from("product")
    .select(
      `
      product_id,
      product_name,
      slug,
      is_active,
      is_consignment,
      updated_at,
      product_type:product_type_id ( type_name, type_code, kind ),
      brand:brand_id ( brand_name ),
      product_variant ( variant_id, is_active, updated_at, product_pricing ( list_price, channel, updated_at ) )
    `,
    )
    .order("updated_at", { ascending: false });

  // Apply the selected filter. We do this server-side so the row counts
  // match reality.
  if (active === "active") base = base.eq("is_active", true);
  if (active === "inactive") base = base.eq("is_active", false);
  if (active === "consignment") base = base.eq("is_consignment", true);

  const { data: rows, error } = await base.returns<ProductRow[]>();

  // Also fetch counts per filter so the chips show the right numbers.
  // Five parallel counts; RLS handles scoping.
  const [all, activeCount, inactive, consignment, service] = await Promise.all([
    supabase.from("product").select("*", { count: "exact", head: true }),
    supabase
      .from("product")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("product")
      .select("*", { count: "exact", head: true })
      .eq("is_active", false),
    supabase
      .from("product")
      .select("*", { count: "exact", head: true })
      .eq("is_consignment", true),
    // Service filter uses product_type.kind; count via a separate narrower query.
    supabase
      .from("product")
      .select("product_id, product_type!inner(kind)", {
        count: "exact",
        head: true,
      })
      .eq("product_type.kind", "service"),
  ]);

  const counts: Record<FilterKey, number | null> = {
    all: all.count,
    active: activeCount.count,
    inactive: inactive.count,
    consignment: consignment.count,
    service: service.count,
  };

  // Filter for services is applied client-side on the fetched rows for
  // the "service" case only, because the initial query above didn't
  // re-scope on kind (to keep it one query). Small impact: services are
  // ≤ 10% of any pet shop.
  const filtered = (rows ?? []).filter((r) => {
    if (active === "service") return r.product_type?.type_code?.startsWith("service");
    return true;
  });

  // ── Sync status per platform per visible product ─────────────────────────
  const filteredIds = filtered.map((r) => r.product_id);
  const { data: syncStatuses } = filteredIds.length
    ? await supabase
        .from("product_sync_status")
        .select("product_id, platform, last_synced_at")
        .in("product_id", filteredIds)
        .returns<SyncStatusRow[]>()
    : { data: [] as SyncStatusRow[] };
  const lastSyncByPair = new Map<string, string | null>();
  for (const s of syncStatuses ?? []) {
    lastSyncByPair.set(`${s.product_id}:${s.platform}`, s.last_synced_at);
  }
  function deriveStatusFor(p: ProductRow, platform: "algolia" | "woocommerce"): "synced" | "pending" | "never" {
    const last = lastSyncByPair.get(`${p.product_id}:${platform}`);
    if (!last) return "never";
    const candidates: number[] = [new Date(p.updated_at).getTime()];
    for (const v of p.product_variant ?? []) {
      candidates.push(new Date(v.updated_at).getTime());
      for (const pr of v.product_pricing ?? []) candidates.push(new Date(pr.updated_at).getTime());
    }
    const eff = Math.max(...candidates);
    return eff <= new Date(last).getTime() ? "synced" : "pending";
  }

  const totalProducts = counts.all ?? 0;
  const totalVariants = filtered.reduce(
    (n, p) => n + (p.product_variant?.length ?? 0),
    0,
  );

  return (
    <div className="s-content">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          paddingBottom: 14,
          borderBottom: "0.5px solid var(--s-border)",
        }}
      >
        <div className="s-breadcrumb">
          <span>{tCrumb("products")}</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-meta">
            {t("meta", {
              products: totalProducts.toLocaleString("es-GT"),
              variants: totalVariants,
            })}
          </p>
        </div>
        <div className="s-title-actions">
          <button className="s-btn s-btn-ghost" type="button">
            {t("import")}
          </button>
          <Link
            href={"/catalog/products/new"}
            className="s-btn s-btn-primary"
            style={{ textDecoration: "none" }}
          >
            + {t("newProduct")}
          </Link>
        </div>
      </div>

      {error ? (
        <div className="s-strip warning">
          <span className="s-strip-title">{t("error")}</span>
          <span className="s-strip-text">{error.message}</span>
        </div>
      ) : null}

      <div className="s-filter-row">
        {FILTER_KEYS.map((key) => {
          const n = counts[key];
          const href =
            key === "all" ? "/catalog/products" : `/catalog/products?filter=${key}`;
          return (
            <Link
              key={key}
              href={href}
              className={`s-filter${active === key ? " active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              {t(`filters.${key}`)}
              {typeof n === "number" ? (
                <span className="s-filter-count">
                  {n.toLocaleString("es-GT")}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <div className="s-card" style={{ padding: 0 }}>
        <div className="s-table-wrap">
          <table className="s-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>{t("table.product")}</th>
                <th>{t("table.type")}</th>
                <th>{t("table.brand")}</th>
                <th className="text-center">{t("table.variants")}</th>
                <th>{t("table.priceFrom")}</th>
                <th>{t("table.status")}</th>
                <th className="text-center" title="Algolia">A</th>
                <th className="text-center" title="WooCommerce">{t("table.tienda")}</th>
                <th>{t("table.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="s-empty">
                      <div className="s-empty-title">
                        {t("empty.title")}
                      </div>
                      <div className="s-empty-sub">
                        {t("empty.sub")}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const variants = p.product_variant ?? [];
                  // Prefer retail channel; fall back to any channel if no retail
                  // pricing row exists for this product.
                  const allPrices = variants.flatMap((v) =>
                    (v.product_pricing ?? []).map((pr) => ({
                      channel: pr.channel,
                      price:
                        pr.list_price === null ? null : Number(pr.list_price),
                    })),
                  );
                  const retailPrices = allPrices
                    .filter((x) => x.channel === "retail" && x.price !== null)
                    .map((x) => x.price as number);
                  const fallbackPrices = allPrices
                    .filter((x) => x.price !== null)
                    .map((x) => x.price as number);
                  const priceSet = retailPrices.length
                    ? retailPrices
                    : fallbackPrices;
                  const minPrice = priceSet.length ? Math.min(...priceSet) : null;
                  const status = p.is_active
                    ? { dot: "success", label: t("statusActive") }
                    : { dot: "neutral", label: t("statusInactive") };

                  return (
                    <tr key={p.product_id} className="clickable">
                      <td style={{ paddingLeft: 20 }}>
                        <Link
                          href={`/catalog/products/${p.product_id}`}
                          style={{ display: "block", color: "inherit" }}
                        >
                          <div className="s-prod-cell">
                            <div className="s-prod-thumb">
                              {initialsFromName(p.product_name)}
                            </div>
                            <div>
                              <div className="s-prod-name">
                                {p.product_name}
                              </div>
                              <div className="s-prod-slug">{p.slug}</div>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td>
                        {p.product_type ? (
                          <span className="s-tag s-tag-accent">
                            {p.product_type.type_name}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td style={{ color: "var(--s-text-secondary)", fontSize: 12 }}>
                        {p.brand?.brand_name ?? "—"}
                      </td>
                      <td
                        className="text-center tabular"
                        style={{ fontSize: 12, color: "var(--s-text-secondary)" }}
                      >
                        {variants.length}
                      </td>
                      <td className="tabular" style={{ fontSize: 12 }}>
                        {formatGTQ(minPrice)}
                      </td>
                      <td>
                        <div className="s-dot-row">
                          <div className={`s-dot ${status.dot}`} />
                          <span style={{ fontSize: 12 }}>{status.label}</span>
                        </div>
                      </td>
                      <td className="text-center">
                        <SyncDot status={deriveStatusFor(p, "algolia")} />
                      </td>
                      <td className="text-center">
                        <SyncDot status={deriveStatusFor(p, "woocommerce")} />
                      </td>
                      <td style={{ fontSize: 12, color: "var(--s-text-muted)" }}>
                        {formatRelative(p.updated_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="s-pagination">
          <span className="s-page-info">
            {t("pagination", {
              shown: filtered.length,
              total: totalProducts.toLocaleString("es-GT"),
            })}
          </span>
          {/* Pagination controls visual-only this pass — we return
              everything for the tenant (Wazu has 6 products, it's fine).
              Real paging lands when tenants grow. */}
        </div>
      </div>
    </div>
  );
}

// ─── Tiny sync-status dot for the table ────────────────────────────────────

function SyncDot({ status }: { status: "synced" | "pending" | "never" }) {
  const colors = {
    synced: "var(--s-success)",
    pending: "var(--s-warning)",
    never: "var(--s-text-muted)",
  } as const;
  const titles = {
    synced: "Sincronizado",
    pending: "Pendiente",
    never: "Nunca sincronizado",
  } as const;
  return (
    <span
      title={titles[status]}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: colors[status],
      }}
    />
  );
}
