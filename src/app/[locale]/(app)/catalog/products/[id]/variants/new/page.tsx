import { notFound } from "next/navigation";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { getInheritedVariantAxes } from "@/lib/getInheritedVariantAxes";
import { VariantCreateForm } from "./_form";
import type { CategoryOption } from "../../../_types";

export const dynamic = "force-dynamic";

type UnitOption = {
  unit_id: number;
  code: string;
  name: string;
  dimension: string;
};

export default async function NewVariantPage({
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
    { data: product },
    { data: categoryRows },
    { data: axisRows },
    { data: unitRows },
  ] = await Promise.all([
    supabase
      .from("product")
      .select(
        `product_id, product_name,
         product_category_link ( is_primary, category:category_id ( category_id ) )`,
      )
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from("category")
      .select("category_id, category_name, parent_category_id, level")
      .eq("instance_id", instanceId)
      .order("level")
      .order("category_name"),
    supabase
      .from("category_product_attribute")
      .select(
        `category_id, attribute_id, variant_axis_order,
         product_attribute:attribute_id (
           attribute_code, attribute_name, data_type, dimension,
           product_attribute_option ( value_id, value )
         )`,
      )
      .eq("is_variant_axis", true),
    supabase
      .from("unit_of_measure")
      .select("unit_id, code, name, dimension")
      .order("dimension")
      .order("code"),
  ]);

  if (!product) notFound();

  const primaryCategoryId =
    (product as any).product_category_link?.find((l: any) => l.is_primary)?.category
      ?.category_id ?? null;

  const axisMappings = (axisRows ?? []).map((row: any) => ({
    category_id: row.category_id as number,
    attribute_id: row.attribute_id as number,
    attribute_code: (row.product_attribute?.attribute_code ?? "") as string,
    attribute_name: (row.product_attribute?.attribute_name ?? "") as string,
    data_type: (row.product_attribute?.data_type ?? null) as string | null,
    dimension: (row.product_attribute?.dimension ?? null) as string | null,
    variant_axis_order: (row.variant_axis_order ?? 0) as number,
    options: ((row.product_attribute?.product_attribute_option ?? []) as Array<{
      value_id: number;
      value: string;
    }>),
  }));

  const allCategories = (categoryRows ?? []).map((c: any) => ({
    category_id: c.category_id as number,
    parent_category_id: c.parent_category_id as number | null,
    category_name: c.category_name as string,
  }));

  const axes =
    primaryCategoryId != null
      ? getInheritedVariantAxes(primaryCategoryId, allCategories, axisMappings)
      : [];

  const units = (unitRows ?? []) as UnitOption[];

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
            {(product as any).product_name}
          </Link>
          <span className="s-breadcrumb-sep">/</span>
          <span>{tv("form.createTitle")}</span>
        </div>
      </div>

      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{tv("form.createTitle")}</h1>
        </div>
      </div>

      <div className="s-card">
        <VariantCreateForm
          productId={productId}
          productName={(product as any).product_name as string}
          axes={axes}
          units={units}
        />
      </div>
    </div>
  );
}
