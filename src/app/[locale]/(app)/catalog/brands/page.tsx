import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { BrandList } from "./_list";
import { BrandEditor } from "./_editor";
import type { BrandRow } from "./_types";

export const dynamic = "force-dynamic";

type SearchParams = { id?: string; mode?: string };

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { id, mode } = await searchParams;
  const selectedId = id ? parseInt(id, 10) : null;
  const isCreate = mode === "create";

  const instanceId = await currentInstanceId();
  const t = await getTranslations("catalog.brands");

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

  const { data: rawBrands } = await supabase
    .from("brand")
    .select("brand_id, brand_name, manufacturer, created_at, updated_at")
    .order("brand_name");

  const brands: BrandRow[] = (rawBrands ?? []) as BrandRow[];

  const { data: productCountRows } = await supabase
    .from("product")
    .select("brand_id")
    .not("brand_id", "is", null);

  const productCounts: Record<number, number> = {};
  for (const row of productCountRows ?? []) {
    const bid = row.brand_id as number | null;
    if (bid == null) continue;
    productCounts[bid] = (productCounts[bid] ?? 0) + 1;
  }

  const selectedBrand = brands.find((b) => b.brand_id === selectedId) ?? null;
  const editorMode = isCreate ? "create" : selectedBrand ? "edit" : "empty";

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          minHeight: "calc(100vh - 220px)",
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          overflow: "hidden",
        }}
      >
        <BrandList brands={brands} productCounts={productCounts} />

        <BrandEditor
          key={selectedId ?? (isCreate ? "create" : "empty")}
          brand={selectedBrand}
          productCount={selectedBrand ? productCounts[selectedBrand.brand_id] ?? 0 : 0}
          mode={editorMode}
        />
      </div>
    </div>
  );
}
