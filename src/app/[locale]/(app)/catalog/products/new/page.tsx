import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  NewProductForm,
  type AttributeOptionRow,
  type BrandOption,
  type CategoryAttributeMapping,
  type CategoryOption,
  type ProductTypeOption,
  type UnitOption,
} from "@/components/catalog/product-edit/NewProductForm";

/**
 * Full-page product creation form. Loads every dropdown source up
 * front (RLS scopes brand/category/product_type/category_product_attribute
 * to the user's instance; unit_of_measure is global) and hands the
 * lookup sets to the client form. The form posts via createProductFull.
 *
 * Phase 2: variant axes and descriptive attributes both come from
 * `category_product_attribute`, distinguished by `is_variant_axis`.
 * Both lists are derived client-side from the user's category picks.
 */

export const dynamic = "force-dynamic";

type CpaRow = {
  category_id: number;
  attribute_id: number;
  is_variant_axis: boolean;
  variant_axis_order: number | null;
  form_order: number | null;
  requirement_level: "required" | "optional" | "hidden" | null;
  product_attribute: {
    attribute_id: number;
    attribute_code: string;
    attribute_name: string;
    data_type: string | null;
    dimension: string | null;
    is_active: boolean;
    product_attribute_option: AttributeOptionRow[] | null;
  } | null;
};

export default async function NewProductPage() {
  const supabase = await createClient();

  const [
    { data: productTypes },
    { data: brands },
    { data: categories },
    { data: cpaRows },
    { data: units },
  ] = await Promise.all([
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
    supabase
      .from("category")
      .select("category_id, category_name, slug, level")
      .eq("is_active", true)
      .order("category_name")
      .returns<CategoryOption[]>(),
    supabase
      .from("category_product_attribute")
      .select(
        `category_id, attribute_id, is_variant_axis, variant_axis_order, form_order, requirement_level,
         product_attribute:attribute_id (
           attribute_id, attribute_code, attribute_name, data_type, dimension, is_active,
           product_attribute_option ( value_id, value, sort_order, is_active )
         )`,
      )
      .returns<CpaRow[]>(),
    supabase
      .from("unit_of_measure")
      .select("unit_id, code, name, dimension")
      .eq("is_active", true)
      .order("dimension")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .returns<UnitOption[]>(),
  ]);

  // Project the join into the client-friendly mapping shape and drop
  // rows whose attribute is missing or inactive (RLS may already filter
  // these, but we double-check here so the UI never has to).
  const mappings: CategoryAttributeMapping[] = (cpaRows ?? [])
    .filter((r) => r.product_attribute && r.product_attribute.is_active)
    .map((r) => ({
      category_id: r.category_id,
      is_variant_axis: r.is_variant_axis,
      variant_axis_order: r.variant_axis_order,
      form_order: r.form_order,
      requirement_level: r.requirement_level,
      attribute: {
        attribute_id: r.product_attribute!.attribute_id,
        attribute_code: r.product_attribute!.attribute_code,
        attribute_name: r.product_attribute!.attribute_name,
        data_type: r.product_attribute!.data_type,
        dimension: r.product_attribute!.dimension,
        options: (r.product_attribute!.product_attribute_option ?? [])
          .filter((o) => o.is_active)
          .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0)),
      },
    }));

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
          <span className="s-breadcrumb-sep">/</span>
          <span>Nuevo producto</span>
        </div>
      </div>

      <NewProductForm
        productTypes={productTypes ?? []}
        brands={brands ?? []}
        categories={categories ?? []}
        categoryAttributeMappings={mappings}
        units={units ?? []}
      />
    </div>
  );
}
