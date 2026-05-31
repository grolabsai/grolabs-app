import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { ImportWizard } from "@/components/import/ImportWizard";

/**
 * Bulk-import wizard. Six steps:
 *   1. Upload xlsx/csv → preview
 *   2. Pick brand + product-name column → ask ASE to suggest categories
 *   3. Ask ASE to group rows into base products with variants/attributes
 *   4. Map remaining GroLabs fields to file columns
 *   5. Review (edit cells, fix errors)
 *   6. Submit → bulk-create products
 *
 * The page is server-side; it loads the brand + active-category lists for
 * the wizard's dropdowns. Everything else is client-side state in
 * WizardProvider.
 */

export const dynamic = "force-dynamic";

type BrandRow = { brand_id: number; brand_name: string };
type CategoryRow = { category_id: number; category_name: string; parent_category_id: number | null };
type ProductTypeRow = { product_type_id: number; type_name: string };
type AttributeOptionRow = { value_id: number; attribute_id: number; value: string };
type AttributeRow = {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: "text" | "number" | "list" | "multiselect" | "boolean" | "quantity" | "url";
  dimension: "mass" | "volume" | "count" | "length" | null;
  parsing_hint: string | null;
};
type CategoryAttributeLinkRow = {
  category_id: number;
  attribute_id: number;
  is_variant_axis: boolean;
  variant_axis_order: number | null;
  form_order: number | null;
  requirement_level: "required" | "optional" | null;
};
type UnitRow = {
  unit_id: number;
  code: string;
  name: string;
  dimension: "mass" | "volume" | "count" | "length";
};

export default async function ImportWizardPage() {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();
  const tCrumb = await getTranslations("import.wizard.breadcrumb");

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
    { data: brands },
    { data: categories },
    { data: productTypes },
    { data: attributeOptions },
    { data: attributes },
    { data: categoryAttributes },
    { data: units },
  ] = await Promise.all([
    supabase
      .from("brand")
      .select("brand_id, brand_name")
      .eq("instance_id", instanceId)
      .order("brand_name")
      .returns<BrandRow[]>(),
    supabase
      .from("category")
      .select("category_id, category_name, parent_category_id")
      .eq("instance_id", instanceId)
      .eq("is_active", true)
      // Definition order (sort_order primary, category_id tiebreak) so the
      // Step-2 tree picker renders categories the way the user laid them out.
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("category_id", { ascending: true })
      .returns<CategoryRow[]>(),
    supabase
      .from("product_type")
      .select("product_type_id, type_name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .returns<ProductTypeRow[]>(),
    // Step 3 renders `value_id` references as their human label and the
    // editable list-cells need to know which options belong to each
    // attribute. Both come out of one query.
    supabase
      .from("product_attribute_option")
      .select("value_id, attribute_id, value")
      .eq("instance_id", instanceId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .returns<AttributeOptionRow[]>(),
    // Full attribute catalog for the instance — Step 3 uses this to know
    // each attribute's data_type (so it can render the right input) and
    // dimension (so quantity unit dropdowns filter correctly).
    supabase
      .from("product_attribute")
      .select("attribute_id, attribute_code, attribute_name, data_type, dimension, parsing_hint")
      .eq("instance_id", instanceId)
      .eq("is_active", true)
      .returns<AttributeRow[]>(),
    // Category × attribute mapping. Step 3 walks the inheritance chain
    // (CLAUDE.md §10) over this set to compute each category's effective
    // axis + descriptive set, then renders one column per attribute even
    // if the agent didn't populate it for any variant.
    supabase
      .from("category_product_attribute")
      .select("category_id, attribute_id, is_variant_axis, variant_axis_order, form_order, requirement_level")
      .eq("instance_id", instanceId)
      .returns<CategoryAttributeLinkRow[]>(),
    // Global unit table; quantity inputs filter by attribute.dimension.
    supabase
      .from("unit_of_measure")
      .select("unit_id, code, name, dimension")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .returns<UnitRow[]>(),
  ]);

  const defaultProductTypeId = productTypes?.[0]?.product_type_id ?? null;

  return (
    <div className="s-content">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          paddingBottom: 14,
          borderBottom: "0.5px solid var(--gl-border)",
        }}
      >
        <div className="s-breadcrumb">
          <Link href={"/import"}>{tCrumb("import")}</Link>
          <span className="s-breadcrumb-sep">/</span>
          <span>{tCrumb("excel")}</span>
        </div>
      </div>

      <ImportWizard
        brands={brands ?? []}
        categories={categories ?? []}
        attributeOptions={attributeOptions ?? []}
        attributes={attributes ?? []}
        categoryAttributes={categoryAttributes ?? []}
        units={units ?? []}
        defaultProductTypeId={defaultProductTypeId}
      />
    </div>
  );
}
