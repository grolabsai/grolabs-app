import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { CheckList } from "./_list";
import { CheckEditor } from "./_editor";
import type {
  DiagnosticCheckRow,
  DiagnosticStageRow,
  FixRecommendationRow,
} from "./_types";

export const dynamic = "force-dynamic";

type SearchParams = { id?: string; mode?: string };

export default async function RubricPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { id, mode } = await searchParams;
  const selectedId = id ? parseInt(id, 10) : null;
  const isCreate = mode === "create";

  const instanceId = await currentInstanceId();
  const t = await getTranslations("prospects.rubric");

  if (instanceId === null) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">{t("sessionExpired")}</span>
        </div>
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: stagesRaw }, { data: checksRaw }] = await Promise.all([
    supabase
      .from("diagnostic_stage")
      .select("diagnostic_stage_id, stage_code, stage_name, description, sort_order")
      .order("sort_order"),
    supabase
      .from("diagnostic_check")
      .select(
        "diagnostic_check_id, instance_id, check_code, check_name, description, diagnostic_stage_id, probe_type, weight, revenue_lever, default_delta_rate, default_confidence, is_active, notes, created_at, updated_at",
      )
      .order("check_code"),
  ]);

  const stages: DiagnosticStageRow[] = (stagesRaw ?? []) as DiagnosticStageRow[];
  const checks: DiagnosticCheckRow[] = (checksRaw ?? []) as DiagnosticCheckRow[];

  const selectedCheck = checks.find((c) => c.diagnostic_check_id === selectedId) ?? null;

  // Fetch fixes for the selected check only
  let fixes: FixRecommendationRow[] = [];
  if (selectedCheck) {
    const { data: fixesRaw } = await supabase
      .from("fix_recommendation")
      .select(
        "fix_recommendation_id, instance_id, diagnostic_check_id, fix_code, fix_title, fix_body_md, trigger_condition, effort, impact, sort_order, is_active, created_at, updated_at",
      )
      .eq("diagnostic_check_id", selectedCheck.diagnostic_check_id)
      .order("sort_order")
      .order("fix_code");
    fixes = (fixesRaw ?? []) as FixRecommendationRow[];
  }

  const editorMode = isCreate ? "create" : selectedCheck ? "edit" : "empty";

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          minHeight: "calc(100vh - 240px)",
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          overflow: "hidden",
        }}
      >
        <CheckList
          stages={stages}
          checks={checks}
          currentInstanceId={instanceId}
        />

        <CheckEditor
          key={selectedId ?? (isCreate ? "create" : "empty")}
          check={selectedCheck}
          fixes={fixes}
          stages={stages}
          currentInstanceId={instanceId}
          mode={editorMode}
        />
      </div>
    </div>
  );
}
