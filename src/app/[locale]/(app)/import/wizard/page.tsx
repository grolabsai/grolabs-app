import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { ImportWizard } from "@/components/import/ImportWizard";

/**
 * Bulk-import wizard. Six steps:
 *   1. Upload xlsx/csv → preview
 *   2. Pick brand + product-name column → ask GLPIM to suggest categories
 *   3. Ask GLPIM to group rows into base products with variants/attributes
 *   4. Map remaining Scout fields to file columns
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

  const [{ data: brands }, { data: categories }, { data: productTypes }] = await Promise.all([
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
      .order("category_name")
      .returns<CategoryRow[]>(),
    supabase
      .from("product_type")
      .select("product_type_id, type_name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .returns<ProductTypeRow[]>(),
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
          borderBottom: "0.5px solid var(--s-border)",
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
        defaultProductTypeId={defaultProductTypeId}
      />
    </div>
  );
}
