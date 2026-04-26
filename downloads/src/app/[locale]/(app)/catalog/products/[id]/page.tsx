import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatGTQ, formatRelative } from "@/lib/format";

/**
 * Product editor. Read-only in this first pass — every input is
 * populated from the DB but `disabled`, so the layout is fully exercised
 * without any write wiring. Save/edit wiring comes in the next slice.
 *
 * Layout mirrors Bloom's `screen-product-editor`:
 *   - Two-column grid (2/3 left, 1/3 right)
 *   - Left: Info básica, Configuración, Variantes
 *   - Right: Gallery placeholder, Summary card
 *
 * Scout-specific departures from Bloom's design:
 *   - "Tipo" is product_type (retail_good / service_basic / etc.) not a
 *     freeform category label.
 *   - Category selection references the hierarchical category table, not
 *     freeform pills — shown as a single primary-category chip for now.
 *   - Species selection derives from product_attribute_value where
 *     attribute_code='target_species', consistent with the schema.
 */

export const dynamic = "force-dynamic";

type ProductDetail = {
  product_id: number;
  product_name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  manufacturer: string | null;
  is_active: boolean;
  is_consignment: boolean;
  track_inventory: boolean;
  created_at: string;
  updated_at: string;
  wazudb1_id: string | null;
  product_type: {
    product_type_id: number;
    type_name: string;
    type_code: string;
    kind: string;
  } | null;
  brand: { brand_id: number; brand_name: string } | null;
  product_variant: Array<{
    variant_id: number;
    variant_name: string | null;
    variant_label: string | null;
    sku: string | null;
    barcode: string | null;
    weight_grams: string | null;
    is_active: boolean;
    product_pricing: Array<{
      list_price: string | null;
      cost_price: string | null;
      channel: string;
    }>;
  }>;
  product_attribute_value: Array<{
    attribute_id: number;
    product_attribute: {
      attribute_name: string;
      attribute_code: string;
    } | null;
    value_id: number | null;
    value_text: string | null;
    product_attribute_option: { value: string } | null;
  }>;
  product_category_link: Array<{
    is_primary: boolean;
    category: { category_name: string; slug: string } | null;
  }>;
};

export default async function ProductEditorPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("product")
    .select(
      `
      product_id,
      product_name,
      slug,
      short_description,
      long_description,
      manufacturer,
      is_active,
      is_consignment,
      track_inventory,
      created_at,
      updated_at,
      wazudb1_id,
      product_type:product_type_id ( product_type_id, type_name, type_code, kind ),
      brand:brand_id ( brand_id, brand_name ),
      product_variant (
        variant_id, variant_name, variant_label, sku, barcode, weight_grams, is_active,
        product_pricing ( list_price, cost_price, channel )
      ),
      product_attribute_value (
        attribute_id,
        value_id,
        value_text,
        product_attribute:attribute_id ( attribute_name, attribute_code ),
        product_attribute_option:value_id ( value )
      ),
      product_category_link (
        is_primary,
        category:category_id ( category_name, slug )
      )
    `,
    )
    .eq("product_id", productId)
    .maybeSingle<ProductDetail>();

  if (error) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">Error al cargar</span>
          <span className="s-strip-text">{error.message}</span>
        </div>
      </div>
    );
  }
  if (!data) notFound();

  const variants = data.product_variant ?? [];
  const primaryCategory = data.product_category_link?.find((l) => l.is_primary)
    ?.category;

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
          <Link href={"/catalog/products"}>Productos</Link>
          {primaryCategory ? (
            <>
              <span className="s-breadcrumb-sep">/</span>
              <a>{primaryCategory.category_name}</a>
            </>
          ) : null}
          <span className="s-breadcrumb-sep">/</span>
          <span>{data.product_name}</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">
            {data.product_name}
            {data.is_active ? (
              <span className="s-tag s-tag-success">Activo</span>
            ) : (
              <span className="s-tag s-tag-neutral">Inactivo</span>
            )}
            {data.is_consignment ? (
              <span className="s-tag s-tag-neutral">Consignación</span>
            ) : null}
          </h1>
          <p className="s-meta">
            ID {data.product_id} · creado {formatRelative(data.created_at)} ·
            actualizado {formatRelative(data.updated_at)}
          </p>
        </div>
        <div className="s-title-actions">
          <Link href={"/catalog/products"} className="s-btn s-btn-secondary">
            Volver
          </Link>
          <button className="s-btn s-btn-primary" type="button" disabled title="Edición — próximamente">
            Guardar cambios
          </button>
        </div>
      </div>

      <div className="s-strip info">
        <span className="s-strip-title">Solo lectura</span>
        <span className="s-strip-text">
          Este editor muestra el producto en modo lectura. La edición y
          guardado se habilitan en la próxima iteración.
        </span>
      </div>

      <div className="s-grid">
        <div className="s-col-stack">
          {/* Información básica */}
          <div className="s-card">
            <p className="s-card-label">Información básica</p>
            <div className="s-field">
              <label className="s-field-label" htmlFor="name">
                Nombre del producto
              </label>
              <input
                className="s-input"
                id="name"
                defaultValue={data.product_name}
                disabled
              />
            </div>
            <div className="s-field">
              <label className="s-field-label" htmlFor="short_desc">
                Descripción corta
              </label>
              <textarea
                className="s-textarea"
                id="short_desc"
                rows={2}
                defaultValue={data.short_description ?? ""}
                disabled
              />
            </div>
            <div className="s-field">
              <label className="s-field-label" htmlFor="long_desc">
                Descripción larga
              </label>
              <textarea
                className="s-textarea"
                id="long_desc"
                rows={4}
                defaultValue={data.long_description ?? ""}
                disabled
              />
            </div>
            <div className="s-row-pair">
              <div className="s-field">
                <label className="s-field-label" htmlFor="slug">
                  Slug
                </label>
                <input
                  className="s-input s-input-mono"
                  id="slug"
                  defaultValue={data.slug}
                  disabled
                />
              </div>
              <div className="s-field">
                <label className="s-field-label" htmlFor="type">
                  Tipo
                </label>
                <input
                  className="s-input"
                  id="type"
                  defaultValue={data.product_type?.type_name ?? "—"}
                  disabled
                />
              </div>
            </div>
          </div>

          {/* Configuración + Marca */}
          <div className="s-card">
            <p className="s-card-label">Configuración y proveedor</p>
            <div className="s-row-pair">
              <div>
                <div className="s-toggle-row">
                  <div className="s-toggle-info">
                    <p className="s-toggle-title">Producto activo</p>
                    <p className="s-toggle-sub">Visible en el catálogo</p>
                  </div>
                  <div
                    className={`s-toggle${data.is_active ? " on" : ""}`}
                    style={{ opacity: 0.6, cursor: "not-allowed" }}
                  />
                </div>
                <div className="s-toggle-row">
                  <div className="s-toggle-info">
                    <p className="s-toggle-title">Control de inventario</p>
                    <p className="s-toggle-sub">
                      Se lleva seguimiento de stock
                    </p>
                  </div>
                  <div
                    className={`s-toggle${data.track_inventory ? " on" : ""}`}
                    style={{ opacity: 0.6, cursor: "not-allowed" }}
                  />
                </div>
                <div className="s-toggle-row">
                  <div className="s-toggle-info">
                    <p className="s-toggle-title">Consignación</p>
                    <p className="s-toggle-sub">
                      El inventario pertenece al proveedor
                    </p>
                  </div>
                  <div
                    className={`s-toggle${data.is_consignment ? " on" : ""}`}
                    style={{ opacity: 0.6, cursor: "not-allowed" }}
                  />
                </div>
              </div>
              <div>
                <div className="s-field">
                  <label className="s-field-label" htmlFor="brand">
                    Marca
                  </label>
                  <input
                    className="s-input"
                    id="brand"
                    defaultValue={data.brand?.brand_name ?? "—"}
                    disabled
                  />
                </div>
                <div className="s-field">
                  <label className="s-field-label" htmlFor="manufacturer">
                    Fabricante
                  </label>
                  <input
                    className="s-input"
                    id="manufacturer"
                    defaultValue={data.manufacturer ?? ""}
                    disabled
                  />
                </div>
                <div className="s-field">
                  <label className="s-field-label" htmlFor="category">
                    Categoría principal
                  </label>
                  <input
                    className="s-input"
                    id="category"
                    defaultValue={primaryCategory?.category_name ?? "—"}
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Atributos — simple list, grouped by attribute */}
          <div className="s-card">
            <p className="s-card-label">Atributos del producto</p>
            {data.product_attribute_value.length === 0 ? (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--s-text-tertiary)",
                }}
              >
                Sin atributos asignados.
              </p>
            ) : (
              <div>
                {data.product_attribute_value.map((av, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 0",
                      borderBottom:
                        idx < data.product_attribute_value.length - 1
                          ? "0.5px solid var(--s-border)"
                          : "none",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {av.product_attribute?.attribute_name ?? "—"}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--s-text-tertiary)",
                          fontFamily: "var(--s-font-mono)",
                          marginTop: 1,
                        }}
                      >
                        {av.product_attribute?.attribute_code ?? ""}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--s-text-secondary)",
                      }}
                    >
                      {av.product_attribute_option?.value ??
                        av.value_text ??
                        "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="s-col-stack">
          <div className="s-card">
            <div className="s-card-header">
              <p className="s-card-label" style={{ margin: 0 }}>
                Galería
              </p>
              <button className="s-card-link" type="button" disabled>
                Subir nueva
              </button>
            </div>
            <div className="s-gallery-main">
              <div className="s-gallery-main-label">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="9" cy="11" r="2" />
                  <path d="M21 16l-5-5-8 8" />
                </svg>
                <span>Sin imagen principal</span>
              </div>
            </div>
            <div className="s-gallery-thumbs">
              <div className="s-thumb" />
              <div className="s-thumb" />
              <div className="s-thumb" />
              <div className="s-thumb" />
            </div>
          </div>

          <div
            style={{
              background: "var(--scout-accent-50)",
              borderRadius: "var(--s-radius-lg)",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                color: "var(--scout-accent-800)",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Resumen
            </div>
            <Row label="Variantes" value={`${variants.length}`} />
            <Row
              label="Activas"
              value={`${variants.filter((v) => v.is_active).length}`}
            />
            <Row
              label="Con SKU"
              value={`${variants.filter((v) => v.sku).length}`}
            />
            <Row
              label="Con barcode"
              value={`${variants.filter((v) => v.barcode).length}`}
            />
            {data.wazudb1_id ? (
              <Row
                label="ID origen"
                value={data.wazudb1_id.slice(0, 8) + "…"}
                mono
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Variants table — full width under the two columns */}
      <div className="s-card" style={{ marginBottom: 16 }}>
        <div className="s-card-header">
          <div>
            <h3 className="s-card-h">Variantes</h3>
            <p className="s-card-sub">
              Presentaciones, SKUs y precios por variante.
            </p>
          </div>
          <button className="s-btn s-btn-ghost" type="button" disabled>
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
            Nueva variante
          </button>
        </div>
        <div className="s-table-wrap">
          <table className="s-table">
            <thead>
              <tr>
                <th>Variante</th>
                <th>SKU</th>
                <th>Código de barras</th>
                <th>Peso</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Costo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="s-empty" style={{ padding: "32px 20px" }}>
                      <div className="s-empty-sub">
                        Este producto aún no tiene variantes.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                variants.map((v) => {
                  const retail = v.product_pricing?.find(
                    (p) => p.channel === "retail",
                  );
                  return (
                    <tr key={v.variant_id}>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {v.variant_name ?? "—"}
                        </div>
                        {v.variant_label && v.variant_label !== v.variant_name ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--s-text-tertiary)",
                            }}
                          >
                            {v.variant_label}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {v.sku ? <span className="s-sku">{v.sku}</span> : "—"}
                      </td>
                      <td>
                        {v.barcode ? (
                          <span className="s-barcode">{v.barcode}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {v.weight_grams ? (
                          <span className="s-size-pill">
                            {formatWeight(v.weight_grams)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-right tabular">
                        {formatGTQ(retail?.list_price)}
                      </td>
                      <td
                        className="text-right tabular"
                        style={{ color: "var(--s-text-secondary)" }}
                      >
                        {formatGTQ(retail?.cost_price)}
                      </td>
                      <td>
                        <div className="s-dot-row">
                          <div
                            className={`s-dot ${v.is_active ? "success" : "neutral"}`}
                          />
                          <span style={{ fontSize: 12 }}>
                            {v.is_active ? "Activa" : "Inactiva"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Convert weight_grams (numeric/string) into a compact human label.
// 3000 → "3 kg"; 500 → "500 g"; 15000 → "15 kg".
function formatWeight(grams: string | number): string {
  const n = typeof grams === "number" ? grams : Number(grams);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) {
    const kg = n / 1000;
    return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
  }
  return `${n} g`;
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "5px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--scout-accent-800)", opacity: 0.85 }}>
        {label}
      </span>
      <span
        style={{
          color: "var(--scout-accent-800)",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          fontFamily: mono ? "var(--s-font-mono)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
