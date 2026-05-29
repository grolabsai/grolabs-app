import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { BenchmarksEditor } from "./_editor";

export const dynamic = "force-dynamic";

export type VerticalRow = {
  vertical_id: number;
  vertical_code: string;
  vertical_name: string;
  description: string | null;
};

export type StageRow = {
  diagnostic_stage_id: number;
  stage_code: string;
  stage_name: string;
};

export type CheckRow = {
  diagnostic_check_id: number;
  check_code: string;
  check_name: string;
  diagnostic_stage_id: number;
};

export type BenchmarkRow = {
  vertical_benchmark_id: number;
  instance_id: number;
  vertical_id: number;
  diagnostic_stage_id: number | null;
  diagnostic_check_id: number | null;
  baseline_cr: number | null;
  stage_share: number | null;
  delta_rate: number | null;
  default_aov_usd: number | null;
  source: string | null;
  effective_from: string;
  notes: string | null;
};

export default async function BenchmarksPage() {
  const instanceId = await currentInstanceId();
  const t = await getTranslations("prospects.benchmarks");

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

  const [
    { data: verticalsRaw },
    { data: stagesRaw },
    { data: checksRaw },
    { data: benchmarksRaw },
  ] = await Promise.all([
    supabase
      .from("vertical")
      .select("vertical_id, vertical_code, vertical_name, description")
      .order("vertical_name"),
    supabase
      .from("diagnostic_stage")
      .select("diagnostic_stage_id, stage_code, stage_name")
      .order("sort_order"),
    supabase
      .from("diagnostic_check")
      .select("diagnostic_check_id, check_code, check_name, diagnostic_stage_id")
      .order("check_code"),
    supabase
      .from("vertical_benchmark")
      .select(
        "vertical_benchmark_id, instance_id, vertical_id, diagnostic_stage_id, diagnostic_check_id, baseline_cr, stage_share, delta_rate, default_aov_usd, source, effective_from, notes",
      )
      .order("effective_from", { ascending: false }),
  ]);

  const verticals: VerticalRow[] = (verticalsRaw ?? []) as VerticalRow[];
  const stages: StageRow[] = (stagesRaw ?? []) as StageRow[];
  const checks: CheckRow[] = (checksRaw ?? []) as CheckRow[];
  const benchmarks: BenchmarkRow[] = (benchmarksRaw ?? []) as BenchmarkRow[];

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
      </div>

      <BenchmarksEditor
        verticals={verticals}
        stages={stages}
        checks={checks}
        benchmarks={benchmarks}
        currentInstanceId={instanceId}
      />
    </div>
  );
}
