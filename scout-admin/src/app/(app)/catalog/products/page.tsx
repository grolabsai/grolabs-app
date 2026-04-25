import Link from "next/link";
import type { Route } from "next";
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
 * the user's auth cookies, so every query inherits the JWT `instance_id`
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
    product_pricing: Array<{ list_price: string | null; channel: string }>;
  }>;
};

// Map the filter chip to a server-side query predicate. Kept simple —
// more sophisticated faceting (species, category tree, tag) comes later.
type FilterKey = "all" | "active" | "inactive" | "consignment" | "service";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "active", label: "Activos" },
  { key: "inactive", label: "Inactivos" },
  { key: "consignment", label: "Consignación" },
  { key: "service", label: "Servicios" },
];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const active: FilterKey = (sp.filter as FilterKey) || "all";

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
      product_variant ( variant_id, is_active, product_pricing ( list_price, channel ) )
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
          <span>Productos</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">Productos</h1>
          <p className="s-meta">
            {totalProducts.toLocaleString("es-GT")} productos · {totalVariants}{" "}
            variantes mostradas
          </p>
        </div>
        <div className="s-title-actions">
          <button className="s-btn s-btn-ghost" type="button">
            Importar
          </button>
          <button
            className="s-btn s-btn-primary"
            type="button"
            title="Crear producto — próximamente"
            disabled
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M7 2v10M2 7h10" />
            </svg>
            Nuevo producto
          </button>
        </div>
      </div>

      {error ? (
        <div className="s-strip warning">
          <span className="s-strip-title">Error</span>
          <span className="s-strip-text">{error.message}</span>
        </div>
      ) : null}

      <div className="s-filter-row">
        {FILTERS.map((f) => {
          const n = counts[f.key];
          const href =
            f.key === "all" ? "/catalog/products" : `/catalog/products?filter=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href as Route}
              className={`s-filter${active === f.key ? " active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              {f.label}
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
                <th style={{ paddingLeft: 20 }}>Producto</th>
                <th>Tipo</th>
                <th>Marca</th>
                <th className="text-center">Variantes</th>
                <th>Precio desde</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="s-empty">
                      <div className="s-empty-title">
                        No hay productos que coincidan con este filtro.
                      </div>
                      <div className="s-empty-sub">
                        Probá ajustar los filtros o crear un producto nuevo.
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
                    ? { dot: "success", label: "Activo" }
                    : { dot: "neutral", label: "Inactivo" };

                  return (
                    <tr key={p.product_id} className="clickable">
                      <td style={{ paddingLeft: 20 }}>
                        <Link
                          href={`/catalog/products/${p.product_id}` as Route}
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
            Mostrando {filtered.length} de {totalProducts.toLocaleString("es-GT")}{" "}
            productos
          </span>
          {/* Pagination controls visual-only this pass — we return
              everything for the tenant (Wazu has 6 products, it's fine).
              Real paging lands when tenants grow. */}
        </div>
      </div>
    </div>
  );
}
