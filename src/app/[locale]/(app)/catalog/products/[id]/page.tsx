import { notFound } from "next/navigation";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { formatGTQ, formatRelative } from "@/lib/format";
import { ProductEditForm } from "./_product-form";
import type { ProductTypeOption, BrandOption, CategoryOption } from "../_types";

export const dynamic = "force-dynamic";

type ProductPageData = {
  product_id: number;
  product_name: string;
  slug: string;
  short_description: string | null;
  image_url: string | null;
  is_active: boolean;
  is_consignment: boolean;
  track_inventory: boolean;
  created_at: string;
  updated_at: string;
  wazudb1_id: string | null;
  product_type: { product_type_id: number; type_name: string; type_code: string } | null;
  brand: { brand_id: number; brand_name: string } | null;
  product_variant: Array<{
    variant_id: number;
    variant_name: string | null;
    variant_label: string | null;
    sku: string | null;
    barcode: string | null;
    weight_grams: string | null;
    is_active: boolean;
    product_pricing: Array<{ list_price: string | null; cost_price: string | null; channel: string }>;
  }>;
  product_category_link: Array<{
    is_primary: boolean;
    category: { category_id: number; category_name: string } | null;
  }>;
};

export default async function ProductEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const instanceId = await currentInstanceId();
  const tp = await getTranslations("catalog.products");
  const tv = await getTranslations("catalog.variants");
  const supabase = await createClient();

  if (instanceId === null) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">Sesión expirada</span>
          <span className="s-strip-text">Volvé a iniciar sesión.</span>
        </div>
      </div>
    );
  }

  const [
    { data, error },
    { data: productTypes },
    { data: brands },
    { data: categories },
  ] = await Promise.all([
    supabase
      .from("product")
      .select(
        `product_id, product_name, slug, short_description, image_url,
         is_active, is_consignment, track_inventory, created_at, updated_at, wazudb1_id,
         product_type:product_type_id ( product_type_id, type_name, type_code ),
         brand:brand_id ( brand_id, brand_name ),
         product_variant (
           variant_id, variant_name, variant_label, sku, barcode, weight_grams, is_active,
           product_pricing ( list_price, cost_price, channel )
         ),
         product_category_link (
           is_primary,
           category:category_id ( category_id, category_name )
         )`,
      )
      .eq("product_id", productId)
      .maybeSingle<ProductPageData>(),
    supabase
      .from("product_type")
      .select("product_type_id, type_name, type_code")
      .order("type_name"),
    supabase
      .from("brand")
      .select("brand_id, brand_name")
      .eq("instance_id", instanceId)
      .order("brand_name"),
    supabase
      .from("category")
      .select("category_id, category_name, parent_category_id, level")
      .eq("instance_id", instanceId)
      .order("level")
      .order("category_name"),
  ]);

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
  const primaryCategory = data.product_category_link?.find((l) => l.is_primary)?.category;

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
          <Link href="/catalog/products">{tp("title")}</Link>
          <span className="s-breadcrumb-sep">/</span>
          <span>{data.product_name}</span>
        </div>
      </div>

      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div className="s-title-inner">
          <h1 className="s-title">
            {data.product_name}
            {data.is_active ? (
              <span className="s-tag s-tag-success">{tp("status.active")}</span>
            ) : (
              <span className="s-tag s-tag-neutral">{tp("status.inactive")}</span>
            )}
            {data.is_consignment ? (
              <span className="s-tag s-tag-neutral">{tp("form.fields.isConsignment")}</span>
            ) : null}
          </h1>
          <p className="s-meta">
            ID {data.product_id} · {tp("table.updated").toLowerCase()} {formatRelative(data.updated_at)}
          </p>
        </div>
      </div>

      <div className="s-grid">
        <div className="s-col-stack">
          <div className="s-card">
            <ProductEditForm
              productId={data.product_id}
              initial={{
                product_name: data.product_name,
                slug: data.slug,
                product_type_id: data.product_type?.product_type_id ?? null,
                brand_id: data.brand?.brand_id ?? null,
                primary_category_id: primaryCategory?.category_id ?? null,
                short_description: data.short_description,
                image_url: data.image_url,
                is_active: data.is_active,
                is_consignment: data.is_consignment,
                track_inventory: data.track_inventory,
              }}
              productTypes={(productTypes ?? []) as ProductTypeOption[]}
              brands={(brands ?? []) as BrandOption[]}
              categories={(categories ?? []) as CategoryOption[]}
            />
          </div>
        </div>

        <div className="s-col-stack">
          <div
            style={{
              background: "var(--scout-accent-50)",
              borderRadius: "var(--s-radius-lg)",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--scout-accent-800)",
                marginBottom: 12,
              }}
            >
              {tp("form.sections.basic")}
            </div>
            <SummaryRow label={tp("summary.variants")} value={`${variants.length}`} />
            <SummaryRow
              label={tp("summary.active")}
              value={`${variants.filter((v) => v.is_active).length}`}
            />
            <SummaryRow
              label={tp("summary.withSku")}
              value={`${variants.filter((v) => v.sku).length}`}
            />
            <SummaryRow
              label={tp("summary.withBarcode")}
              value={`${variants.filter((v) => v.barcode).length}`}
            />
            {data.wazudb1_id ? (
              <SummaryRow
                label={tp("summary.origin")}
                value={data.wazudb1_id.slice(0, 8) + "…"}
                mono
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="s-card" style={{ marginTop: 16 }}>
        <div className="s-card-header">
          <div>
            <h3 className="s-card-h">{tv("title")}</h3>
          </div>
          <Link
            href={`/catalog/products/${data.product_id}/variants/new`}
            className="s-btn s-btn-ghost"
            style={{ textDecoration: "none" }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 2v10M2 7h10" />
            </svg>
            {tv("new")}
          </Link>
        </div>
        <div className="s-table-wrap">
          <table className="s-table">
            <thead>
              <tr>
                <th>{tv("table.variant")}</th>
                <th>{tv("table.sku")}</th>
                <th>{tv("table.barcode")}</th>
                <th>{tv("table.weight")}</th>
                <th className="text-right">{tv("table.price")}</th>
                <th className="text-right">{tv("table.cost")}</th>
                <th>{tv("table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="s-empty" style={{ padding: "32px 20px" }}>
                      <div className="s-empty-title">{tv("empty.title")}</div>
                      <div className="s-empty-sub">{tv("empty.sub")}</div>
                    </div>
                  </td>
                </tr>
              ) : (
                variants.map((v) => {
                  const retail = v.product_pricing?.find((p) => p.channel === "retail");
                  return (
                    <tr key={v.variant_id} className="clickable">
                      <td>
                        <Link
                          href={`/catalog/products/${data.product_id}/variants/${v.variant_id}`}
                          style={{ display: "block", color: "inherit" }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {v.variant_name ?? "—"}
                          </div>
                          {v.variant_label && v.variant_label !== v.variant_name ? (
                            <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                              {v.variant_label}
                            </div>
                          ) : null}
                        </Link>
                      </td>
                      <td>
                        {v.sku ? <span className="s-sku">{v.sku}</span> : <span className="text-muted">—</span>}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
                        {v.barcode ?? "—"}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
                        {v.weight_grams ? formatWeight(v.weight_grams) : "—"}
                      </td>
                      <td className="text-right tabular" style={{ fontSize: 12 }}>
                        {formatGTQ(retail?.list_price)}
                      </td>
                      <td
                        className="text-right tabular"
                        style={{ fontSize: 12, color: "var(--s-text-secondary)" }}
                      >
                        {formatGTQ(retail?.cost_price)}
                      </td>
                      <td>
                        <div className="s-dot-row">
                          <div className={`s-dot ${v.is_active ? "success" : "neutral"}`} />
                          <span style={{ fontSize: 12 }}>
                            {v.is_active ? tv("status.active") : tv("status.inactive")}
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

function formatWeight(grams: string | number): string {
  const n = typeof grams === "number" ? grams : Number(grams);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) {
    const kg = n / 1000;
    return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
  }
  return `${n} g`;
}

function SummaryRow({
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
      <span style={{ color: "var(--scout-accent-800)", opacity: 0.85 }}>{label}</span>
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
