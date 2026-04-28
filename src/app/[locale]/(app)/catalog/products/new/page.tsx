import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { ProductCreateForm } from "./_form";
import type { ProductTypeOption, BrandOption, CategoryOption } from "../_types";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const instanceId = await currentInstanceId();
  const t = await getTranslations("catalog.products");

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

  const supabase = await createClient();

  const [{ data: productTypes }, { data: brands }, { data: categories }] = await Promise.all([
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
          <Link href="/catalog/products">{t("title")}</Link>
          <span className="s-breadcrumb-sep">/</span>
          <span>{t("form.createTitle")}</span>
        </div>
      </div>

      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("form.createTitle")}</h1>
        </div>
      </div>

      <div className="s-card">
        <ProductCreateForm
          productTypes={(productTypes ?? []) as ProductTypeOption[]}
          brands={(brands ?? []) as BrandOption[]}
          categories={(categories ?? []) as CategoryOption[]}
        />
      </div>
    </div>
  );
}
