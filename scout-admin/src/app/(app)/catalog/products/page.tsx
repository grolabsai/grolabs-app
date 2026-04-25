import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { formatQuetzal } from "@/lib/format";

export default async function ProductsPage() {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();

  const { data: products } = await supabase
    .from("product")
    .select(`
      product_id,
      product_name,
      slug,
      is_active,
      is_consignment,
      brand:brand_id(brand_name),
      product_type:product_type_id(type_name, kind),
      variants:product_variant(variant_id, variant_name, sku),
      pricing:product_variant!inner(
        prices:product_pricing(list_price, channel)
      )
    `)
    .eq("instance_id", instanceId)
    .order("product_name", { ascending: true });

  const prods = products ?? [];

  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--s-text)" }}>Productos</h1>
        <div style={{ fontSize: 12, color: "var(--s-muted)" }}>
          {prods.length} productos
        </div>
      </div>

      <table className="prod-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Marca</th>
            <th style={{ textAlign: "center" }}>Variantes</th>
            <th style={{ textAlign: "right" }}>Precio</th>
          </tr>
        </thead>
        <tbody>
          {prods.map((p: any) => {
            const brand = Array.isArray(p.brand) ? p.brand[0] : p.brand;
            const ptype = Array.isArray(p.product_type) ? p.product_type[0] : p.product_type;
            const variants = p.variants ?? [];
            const prices = (p.pricing ?? []).flatMap((v: any) =>
              (v.prices ?? []).filter((pr: any) => pr.channel === "retail").map((pr: any) => pr.list_price)
            );
            const minPrice = prices.length > 0 ? Math.min(...prices) : null;
            const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

            return (
              <tr key={p.product_id}>
                <td>
                  <div style={{ fontWeight: 500, color: "var(--s-text)", fontSize: 13 }}>
                    {p.product_name}
                  </div>
                  {!p.is_active && (
                    <span style={{ fontSize: 10, color: "var(--s-muted)", fontStyle: "italic" }}>
                      Inactivo
                    </span>
                  )}
                </td>
                <td>
                  <span style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                    background: ptype?.kind === "service" ? "#f0e8fa" : "var(--s-surface)",
                    color: ptype?.kind === "service" ? "#7c3aed" : "var(--s-muted)",
                  }}>
                    {ptype?.type_name ?? "—"}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: "var(--s-muted)" }}>
                  {brand?.brand_name ?? "—"}
                </td>
                <td style={{ textAlign: "center", fontSize: 13 }}>
                  {variants.length}
                </td>
                <td style={{ textAlign: "right", fontSize: 13, fontFamily: "var(--font-mono)" }}>
                  {minPrice != null
                    ? minPrice === maxPrice
                      ? formatQuetzal(minPrice)
                      : `${formatQuetzal(minPrice)} – ${formatQuetzal(maxPrice)}`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <style>{`
        .prod-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .prod-table th {
          text-align: left; padding: 8px 12px; font-size: 11px;
          font-weight: 600; color: var(--s-muted, #73726c);
          text-transform: uppercase; letter-spacing: 0.04em;
          border-bottom: 1px solid var(--s-border, #e5e2da);
        }
        .prod-table td {
          padding: 10px 12px; border-bottom: 1px solid var(--s-border, #e5e2da);
          vertical-align: middle;
        }
        .prod-table tr:hover td { background: var(--s-surface, #f5f2eb); }
      `}</style>
    </div>
  );
}
