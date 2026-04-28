import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { formatGTQ, formatRelative, initialsFromName } from "@/lib/format";
import type { ProductListRow } from "./_types";

export const dynamic = "force-dynamic";

type SearchParams = { filter?: string };
type FilterKey = "all" | "active" | "inactive" | "consignment" | "service";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const active: FilterKey = (sp.filter as FilterKey) || "all";
  const t = await getTranslations("catalog.products");

  const supabase = await createClient();

  let base = supabase
    .from("product")
    .select(
      `product_id, product_name, slug, is_active, is_consignment, updated_at,
       product_type:product_type_id ( product_type_id, type_name, type_code, kind ),
       brand:brand_id ( brand_id, brand_name ),
       product_variant ( variant_id, is_active, product_pricing ( list_price, channel ) )`,
    )
    .order("updated_at", { ascending: false });

  if (active === "active") base = base.eq("is_active", true);
  if (active === "inactive") base = base.eq("is_active", false);
  if (active === "consignment") base = base.eq("is_consignment", true);

  const { data: rows, error } = await base.returns<ProductListRow[]>();

  const [all, activeCount, inactive, consignment, service] = await Promise.all([
    supabase.from("product").select("*", { count: "exact", head: true }),
    supabase.from("product").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("product").select("*", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("product").select("*", { count: "exact", head: true }).eq("is_consignment", true),
    supabase
      .from("product")
      .select("product_id, product_type!inner(kind)", { count: "exact", head: true })
      .eq("product_type.kind", "service"),
  ]);

  const counts: Record<FilterKey, number | null> = {
    all: all.count,
    active: activeCount.count,
    inactive: inactive.count,
    consignment: consignment.count,
    service: service.count,
  };

  const filtered = (rows ?? []).filter((r) => {
    if (active === "service") return r.product_type?.type_code?.startsWith("service");
    return true;
  });

  const totalProducts = counts.all ?? 0;
  const totalVariants = filtered.reduce((n, p) => n + (p.product_variant?.length ?? 0), 0);

  const FILTER_KEYS: FilterKey[] = ["all", "active", "inactive", "consignment", "service"];

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
          <span>{t("title")}</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-meta">
            {totalProducts.toLocaleString("es-GT")} productos · {totalVariants} variantes mostradas
          </p>
        </div>
        <div className="s-title-actions">
          <button className="s-btn s-btn-ghost" type="button">
            {t("import")}
          </button>
          <Link href="/catalog/products/new" className="s-btn s-btn-primary" style={{ textDecoration: "none" }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 2v10M2 7h10" />
            </svg>
            {t("new")}
          </Link>
        </div>
      </div>

      {error ? (
        <div className="s-strip warning">
          <span className="s-strip-title">Error</span>
          <span className="s-strip-text">{error.message}</span>
        </div>
      ) : null}

      <div className="s-filter-row">
        {FILTER_KEYS.map((f) => {
          const href = f === "all" ? "/catalog/products" : `/catalog/products?filter=${f}`;
          const n = counts[f];
          return (
            <Link
              key={f}
              href={href}
              className={`s-filter${active === f ? " active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              {t(`filters.${f}`)}
              {typeof n === "number" ? (
                <span className="s-filter-count">{n.toLocaleString("es-GT")}</span>
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
                <th>{t("table.price")}</th>
                <th>{t("table.status")}</th>
                <th>{t("table.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="s-empty">
                      <div className="s-empty-title">{t("empty.title")}</div>
                      <div className="s-empty-sub">{t("empty.sub")}</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const variants = p.product_variant ?? [];
                  const allPrices = variants.flatMap((v) =>
                    (v.product_pricing ?? [])
                      .filter((pr) => pr.list_price !== null)
                      .map((pr) => ({ channel: pr.channel, price: Number(pr.list_price) })),
                  );
                  const retail = allPrices.filter((x) => x.channel === "retail").map((x) => x.price);
                  const priceSet = retail.length ? retail : allPrices.map((x) => x.price);
                  const minPrice = priceSet.length ? Math.min(...priceSet) : null;
                  const status = p.is_active
                    ? { dot: "success", label: t("status.active") }
                    : { dot: "neutral", label: t("status.inactive") };

                  return (
                    <tr key={p.product_id} className="clickable">
                      <td style={{ paddingLeft: 20 }}>
                        <Link
                          href={`/catalog/products/${p.product_id}`}
                          style={{ display: "block", color: "inherit" }}
                        >
                          <div className="s-prod-cell">
                            <div className="s-prod-thumb">{initialsFromName(p.product_name)}</div>
                            <div>
                              <div className="s-prod-name">{p.product_name}</div>
                              <div className="s-prod-slug">{p.slug}</div>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td>
                        {p.product_type ? (
                          <span className="s-tag s-tag-accent">{p.product_type.type_name}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td style={{ color: "var(--s-text-secondary)", fontSize: 12 }}>
                        {p.brand?.brand_name ?? "—"}
                      </td>
                      <td className="text-center tabular" style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
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
            {t("showing", { shown: filtered.length, total: totalProducts.toLocaleString("es-GT") })}
          </span>
        </div>
      </div>
    </div>
  );
}
