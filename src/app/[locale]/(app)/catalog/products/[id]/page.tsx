import { Link } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  ProductEditor,
  type ProductDetail,
  type ProductTypeOption,
  type BrandOption,
} from "@/components/catalog/product-edit/ProductEditor";

/**
 * Product detail. Fetches the product + the option lists the editor's
 * Select dropdowns need (product_type + brand for the current instance),
 * then hands off to ProductEditor (client) which owns the inline-edit
 * state machine.
 */

export const dynamic = "force-dynamic";

export default async function ProductEditorPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const supabase = await createClient();
  const tCrumb = await getTranslations("product.breadcrumb");
  const tDetail = await getTranslations("product.detail");

  const { data, error } = await supabase
    .from("product")
    .select(
      `
      product_id,
      product_name,
      slug,
      short_description,
      long_description,
      is_active,
      is_consignment,
      track_inventory,
      created_at,
      updated_at,
      wazudb1_id,
      product_type_id,
      brand_id,
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
      ),
      product_media (
        media_id,
        image_url,
        alt_text,
        is_primary,
        sort_order
      )
    `,
    )
    .eq("product_id", productId)
    .maybeSingle<ProductDetail>();

  if (error) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">{tDetail("loadError")}</span>
          <span className="s-strip-text">{error.message}</span>
        </div>
      </div>
    );
  }
  if (!data) notFound();

  // Option lists for the editor's Select dropdowns. RLS scopes them to
  // the user's instance.
  const [{ data: productTypes }, { data: brands }] = await Promise.all([
    supabase
      .from("product_type")
      .select("product_type_id, type_name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .returns<ProductTypeOption[]>(),
    supabase
      .from("brand")
      .select("brand_id, brand_name")
      .order("brand_name")
      .returns<BrandOption[]>(),
  ]);

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
          <Link href={"/catalog/products"}>{tCrumb("products")}</Link>
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

      <ProductEditor
        product={data}
        productTypes={productTypes ?? []}
        brands={brands ?? []}
      />
    </div>
  );
}
