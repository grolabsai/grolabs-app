import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { AttributeList } from "./_list";
import { AttributeEditor } from "./_editor";
import type { AttributeRow, OptionRow } from "./_types";

export const dynamic = "force-dynamic";

type SearchParams = { id?: string; mode?: string };

export default async function AttributesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { id, mode } = await searchParams;
  const selectedId = id ? parseInt(id, 10) : null;
  const isCreate = mode === "create";

  const instanceId = await currentInstanceId();
  const t = await getTranslations("catalog.attributes");

  if (!instanceId) {
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

  const { data: rawAttributes } = await supabase
    .from("product_attribute")
    .select(
      "attribute_id, attribute_code, attribute_name, description, data_type, dimension, is_multivalue, is_filterable, is_searchable, applies_to_variants, is_active",
    )
    .eq("instance_id", instanceId)
    .order("attribute_name");

  const attributes: AttributeRow[] = (rawAttributes ?? []) as AttributeRow[];

  let options: OptionRow[] = [];
  if (selectedId) {
    const { data: rawOptions } = await supabase
      .from("product_attribute_option")
      .select("value_id, value, value_code, sort_order, is_active")
      .eq("attribute_id", selectedId)
      .eq("instance_id", instanceId)
      .order("sort_order", { ascending: true });
    options = (rawOptions ?? []) as OptionRow[];
  }

  const selectedAttr = attributes.find((a) => a.attribute_id === selectedId) ?? null;
  const editorMode = isCreate ? "create" : selectedAttr ? "edit" : "empty";

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
          gridTemplateColumns: "280px 1fr 320px",
          minHeight: "calc(100vh - 220px)",
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          overflow: "hidden",
        }}
      >
        <AttributeList attributes={attributes} />

        <AttributeEditor
          key={selectedId ?? (isCreate ? "create" : "empty")}
          attribute={selectedAttr}
          options={options}
          mode={editorMode}
        />

        {/* Right: assistant placeholder */}
        <div
          style={{
            borderLeft: "0.5px solid var(--s-border)",
            padding: "20px 18px",
            background: "var(--s-surface-alt)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("assistant.title")}
            <span style={{ fontWeight: 400, marginLeft: 4 }}>· {t("assistant.comingSoon")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
