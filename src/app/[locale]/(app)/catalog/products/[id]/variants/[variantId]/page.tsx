import { notFound } from "next/navigation";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { formatGTQ, formatRelative } from "@/lib/format";
import { VariantEditForm } from "./_form";

export const dynamic = "force-dynamic";

type VariantPageData = {
  variant_id: number;
  product_id: number;
  variant_name: string | null;
  variant_label: string | null;
  sku: string | null;
  barcode: string | null;
  weight_grams: string | null;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  product: { product_id: number; product_name: string } | null;
  product_variant_attribute: Array<{
    attribute_id: number;
    value_id: number | null;
    value_text: string | null;
    value_number: number | null;
    unit_id: number | null;
    product_attribute: { attribute_name: string; attribute_code: string; data_type: string | null } | null;
    product_attribute_option: { value: string } | null;
    unit_of_measure: { code: string; name: string } | null;
  }>;
  product_pricing: Array<{
    pricing_id: number;
    channel: string;
    currency: string;
    list_price: string;
    cost_price: string | null;
    is_active: boolean;
  }>;
};

export default async function VariantEditorPage({
  params,
}: {
  params: Promise<{ id: string; variantId: string }>;
}) {
  const { id, variantId: variantIdStr } = await params;
  const productId = Number(id);
  const variantId = Number(variantIdStr);
  if (!Number.isFinite(productId) || !Number.isFinite(variantId)) notFound();

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

  const { data, error } = await supabase
    .from("product_variant")
    .select(
      `variant_id, product_id, variant_name, variant_label, sku, barcode,
       weight_grams, is_active, image_url, created_at, updated_at,
       product:product_id ( product_id, product_name ),
       product_variant_attribute (
         attribute_id, value_id, value_text, value_number, unit_id,
         product_attribute:attribute_id ( attribute_name, attribute_code, data_type ),
         product_attribute_option:value_id ( value ),
         unit_of_measure:unit_id ( code, name )
       ),
       product_pricing (
         pricing_id, channel, currency, list_price, cost_price, is_active
       )`,
    )
    .eq("variant_id", variantId)
    .eq("instance_id", instanceId)
    .maybeSingle<VariantPageData>();

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

  const product = data.product;
  const retailPricing = data.product_pricing.find((p) => p.channel === "retail");

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
          <Link href={`/catalog/products/${productId}`}>
            {product?.product_name ?? `#${productId}`}
          </Link>
          <span className="s-breadcrumb-sep">/</span>
          <span>{data.variant_name ?? `#${variantId}`}</span>
        </div>
      </div>

      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div className="s-title-inner">
          <h1 className="s-title">
            {data.variant_name ?? data.sku ?? `#${variantId}`}
            {data.is_active ? (
              <span className="s-tag s-tag-success">{tv("status.active")}</span>
            ) : (
              <span className="s-tag s-tag-neutral">{tv("status.inactive")}</span>
            )}
          </h1>
          <p className="s-meta">
            {tp("table.updated").toLowerCase()} {formatRelative(data.updated_at)}
          </p>
        </div>
      </div>

      <div className="s-grid">
        <div className="s-col-stack">
          <div className="s-card">
            <VariantEditForm
              variantId={data.variant_id}
              productId={productId}
              initial={{
                variant_name: data.variant_name ?? "",
                variant_label: data.variant_label ?? "",
                sku: data.sku ?? "",
                barcode: data.barcode ?? "",
                image_url: data.image_url ?? "",
                is_active: data.is_active,
              }}
            />
          </div>
        </div>

        <div className="s-col-stack">
          {/* Axis values — read-only */}
          {data.product_variant_attribute.length > 0 ? (
            <div className="s-card">
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--s-text-tertiary)",
                  marginBottom: 12,
                  paddingBottom: 6,
                  borderBottom: "0.5px solid var(--s-border)",
                }}
              >
                {tv("form.sections.axes")}
              </div>
              {data.product_variant_attribute.map((attr) => {
                const displayValue =
                  attr.product_attribute_option?.value ??
                  attr.value_text ??
                  (attr.value_number != null
                    ? `${attr.value_number}${attr.unit_of_measure ? " " + attr.unit_of_measure.code : ""}`
                    : "—");
                return (
                  <div
                    key={attr.attribute_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      padding: "8px 0",
                      borderBottom: "0.5px solid var(--s-border)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--s-text-secondary)" }}>
                      {attr.product_attribute?.attribute_name ?? `attr_${attr.attribute_id}`}
                    </span>
                    <span style={{ fontWeight: 500 }}>{displayValue}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Pricing display */}
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
              {tv("form.sections.pricing")}
            </div>
            <PricingRow label={tv("table.price")} value={formatGTQ(retailPricing?.list_price)} />
            <PricingRow
              label={tv("table.cost")}
              value={formatGTQ(retailPricing?.cost_price)}
            />
            {data.sku ? (
              <PricingRow label={tv("table.sku")} value={data.sku} mono />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingRow({
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
