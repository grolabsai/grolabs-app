import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { LocalTime } from "@/components/ui/LocalTime";
import { EvidenceScreenshot } from "@/components/diagnostic/EvidenceScreenshot";
import {
  SearchTestsBody,
  groupSearchTestResults,
  SEARCH_TEST_RESULT_SELECT,
} from "@/components/diagnostic/SearchTestsCard";

export const dynamic = "force-dynamic";

type Run = {
  run_id: string;
  prospect_id: number;
  run_status: "queued" | "running" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  overall_score: number | null;
  stage_scores: Record<string, number> | null;
  maturity_tier: "low" | "medium" | "high" | null;
  est_annual_uplift_usd: number | null;
  error_message: string | null;
};

type Prospect = {
  prospect_id: number;
  url: string;
  display_name: string | null;
};

type Stage = {
  diagnostic_stage_id: number;
  stage_code: string;
  stage_name: string;
  sort_order: number;
};

type Check = {
  diagnostic_check_id: number;
  check_code: string;
  check_name: string;
  diagnostic_stage_id: number;
};

type Finding = {
  finding_id: number;
  diagnostic_check_id: number;
  score: number | null;
  result_status: "pass" | "fail" | "partial" | "na" | "error";
  evidence: Record<string, unknown> | null;
  notes: string | null;
};

type Fix = {
  finding_id: number;
  fix_recommendation_id: number;
  fix_title: string;
  fix_body_md: string;
  effort: string;
  impact: string;
  priority: number;
};

type Sample = {
  sample_id: number;
  sample_type: string;
  url_or_query: string;
  selection_reason: string | null;
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const t = await getTranslations("prospects.run");
  const instanceId = await currentInstanceId();
  if (instanceId === null) notFound();

  const supabase = await createClient();

  const { data: runRaw } = await supabase
    .from("diagnostic_run")
    .select(
      "run_id, prospect_id, run_status, started_at, completed_at, overall_score, stage_scores, maturity_tier, est_annual_uplift_usd, error_message",
    )
    .eq("run_id", runId)
    .maybeSingle();

  if (!runRaw) notFound();
  const run = runRaw as Run;

  const { data: prospectRaw } = await supabase
    .from("prospect")
    .select("prospect_id, url, display_name")
    .eq("prospect_id", run.prospect_id)
    .maybeSingle();
  const prospect = prospectRaw as Prospect | null;

  const [
    { data: stagesRaw },
    { data: checksRaw },
    { data: findingsRaw },
    { data: samplesRaw },
    { data: entryResultsRaw },
  ] = await Promise.all([
    supabase
      .from("diagnostic_stage")
      .select("diagnostic_stage_id, stage_code, stage_name, sort_order")
      .order("sort_order"),
    supabase
      .from("diagnostic_check")
      .select("diagnostic_check_id, check_code, check_name, diagnostic_stage_id"),
    supabase
      .from("finding")
      .select(
        "finding_id, diagnostic_check_id, score, result_status, evidence, notes",
      )
      .eq("run_id", runId),
    supabase
      .from("run_sample")
      .select("sample_id, sample_type, url_or_query, selection_reason")
      .eq("run_id", runId),
    // Search test results for this run, joined with their variant + entry.
    // Renders the "Search tests" section grouped by entry.
    supabase
      .from("search_test_result")
      .select(SEARCH_TEST_RESULT_SELECT)
      .eq("run_id", runId),
  ]);

  const stages: Stage[] = (stagesRaw ?? []) as Stage[];
  const checks: Check[] = (checksRaw ?? []) as Check[];
  const findings: Finding[] = (findingsRaw ?? []) as Finding[];
  const samples: Sample[] = (samplesRaw ?? []) as Sample[];
  const entryGroupsList = groupSearchTestResults(
    (entryResultsRaw ?? []) as Parameters<typeof groupSearchTestResults>[0],
  );

  // Load fixes attached to findings (joined via finding_fix → fix_recommendation)
  const findingIds = findings.map((f) => f.finding_id);
  let fixes: Fix[] = [];
  if (findingIds.length > 0) {
    const { data: fixesRaw } = await supabase
      .from("finding_fix")
      .select(
        "finding_id, priority, fix_recommendation:fix_recommendation_id ( fix_recommendation_id, fix_title, fix_body_md, effort, impact )",
      )
      .in("finding_id", findingIds)
      .order("priority");
    fixes =
      (fixesRaw ?? [])
        .map((row: {
          finding_id: number;
          priority: number;
          fix_recommendation:
            | { fix_recommendation_id: number; fix_title: string; fix_body_md: string; effort: string; impact: string }
            | { fix_recommendation_id: number; fix_title: string; fix_body_md: string; effort: string; impact: string }[]
            | null;
        }) => {
          const fr = Array.isArray(row.fix_recommendation)
            ? row.fix_recommendation[0]
            : row.fix_recommendation;
          if (!fr) return null;
          return {
            finding_id: row.finding_id,
            fix_recommendation_id: fr.fix_recommendation_id,
            fix_title: fr.fix_title,
            fix_body_md: fr.fix_body_md,
            effort: fr.effort,
            impact: fr.impact,
            priority: row.priority,
          };
        })
        .filter((x): x is Fix => x !== null);
  }

  const checkById = new Map(checks.map((c) => [c.diagnostic_check_id, c]));
  const findingsByStage = new Map<number, Finding[]>();
  for (const f of findings) {
    const check = checkById.get(f.diagnostic_check_id);
    if (!check) continue;
    const arr = findingsByStage.get(check.diagnostic_stage_id) ?? [];
    arr.push(f);
    findingsByStage.set(check.diagnostic_stage_id, arr);
  }
  const fixesByFinding = new Map<number, Fix[]>();
  for (const fix of fixes) {
    const arr = fixesByFinding.get(fix.finding_id) ?? [];
    arr.push(fix);
    fixesByFinding.set(fix.finding_id, arr);
  }

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <div style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginBottom: 4 }}>
            <Link href="/prospects" style={{ color: "var(--gl-text-tertiary)" }}>
              ← {t("backToList")}
            </Link>
          </div>
          <h1 className="s-title">{prospect?.display_name ?? prospect?.url ?? runId}</h1>
          <p className="s-subtitle">{prospect?.url}</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Stat label={t("overallScore")} value={run.overall_score ?? "—"} mono />
        <Stat label={t("maturityTier")} value={run.maturity_tier ?? "—"} />
        <Stat
          label={t("uplift")}
          value={
            run.est_annual_uplift_usd != null
              ? `$${Math.round(run.est_annual_uplift_usd).toLocaleString()}`
              : "—"
          }
          mono
        />
        <Stat label={t("status")} value={run.run_status} />
        <Stat
          label={t("completedAt")}
          value={
            <LocalTime
              iso={run.completed_at}
              fallback="—"
              options={{
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }}
            />
          }
        />
      </div>

      {run.run_status === "failed" && run.error_message && (
        <div className="s-strip danger" style={{ marginBottom: 16 }}>
          <span className="s-strip-title">{t("failedTitle")}</span>
          <span className="s-strip-text">{run.error_message}</span>
        </div>
      )}

      {samples.length > 0 && (
        <Card>
          <CardHeader>{t("samplesTitle")}</CardHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {samples.map((s) => (
                <tr key={s.sample_id} style={{ borderBottom: "0.5px solid var(--gl-border)" }}>
                  <td style={{ padding: "8px 14px", color: "var(--gl-text-tertiary)", width: 120 }}>
                    {s.sample_type}
                  </td>
                  <td style={{ padding: "8px 14px", fontFamily: "var(--gl-font-mono, ui-monospace, monospace)" }}>
                    {s.url_or_query}
                  </td>
                  <td style={{ padding: "8px 14px", fontSize: 11, color: "var(--gl-text-tertiary)" }}>
                    {s.selection_reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {entryGroupsList.length > 0 && (
        <Card>
          <CardHeader>{t("searchTestsTitle")}</CardHeader>
          <SearchTestsBody entries={entryGroupsList} />
        </Card>
      )}

      {stages.map((stage) => {
        const stageFindings = findingsByStage.get(stage.diagnostic_stage_id) ?? [];
        if (stageFindings.length === 0) return null;
        const stageScore =
          run.stage_scores && stage.stage_code in run.stage_scores
            ? (run.stage_scores as Record<string, number>)[stage.stage_code]
            : null;
        const stageScoreFromId =
          run.stage_scores && stage.diagnostic_stage_id.toString() in run.stage_scores
            ? (run.stage_scores as Record<string, number>)[stage.diagnostic_stage_id.toString()]
            : null;
        const score = stageScore ?? stageScoreFromId;
        return (
          <Card key={stage.diagnostic_stage_id}>
            <CardHeader>
              {stage.stage_name}
              {score != null && (
                <span style={{ marginLeft: 10, color: "var(--gl-text-tertiary)", fontWeight: 400 }}>
                  ({score}/100)
                </span>
              )}
            </CardHeader>
            <div>
              {stageFindings.map((f) => {
                const check = checkById.get(f.diagnostic_check_id);
                const findingFixes = fixesByFinding.get(f.finding_id) ?? [];
                return (
                  <FindingRow
                    key={f.finding_id}
                    finding={f}
                    checkName={check?.check_name ?? f.diagnostic_check_id.toString()}
                    checkCode={check?.check_code ?? ""}
                    fixes={findingFixes}
                  />
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        background: "var(--gl-surface)",
        border: "0.5px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-lg)",
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--gl-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "var(--gl-text)",
          fontFamily: mono ? "var(--gl-font-mono, ui-monospace, monospace)" : undefined,
          fontVariantNumeric: mono ? "tabular-nums" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--gl-surface)",
        border: "0.5px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-lg)",
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: "0.5px solid var(--gl-border)",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--gl-text)",
      }}
    >
      {children}
    </div>
  );
}

function FindingRow({
  finding,
  checkName,
  checkCode,
  fixes,
}: {
  finding: Finding;
  checkName: string;
  checkCode: string;
  fixes: Fix[];
}) {
  const statusColor: Record<string, string> = {
    pass: "var(--gl-success)",
    partial: "#d97706",
    fail: "var(--gl-danger)",
    na: "var(--gl-text-tertiary)",
    error: "var(--gl-danger)",
  };
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: "0.5px solid var(--gl-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: statusColor[finding.result_status] ?? "var(--gl-text-tertiary)",
            minWidth: 70,
          }}
        >
          {finding.result_status}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gl-text)" }}>
            {checkName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--gl-text-tertiary)",
              fontFamily: "var(--gl-font-mono, ui-monospace, monospace)",
            }}
          >
            {checkCode}
          </div>
        </div>
        {finding.score != null && (
          <div
            style={{
              fontSize: 12,
              fontFamily: "var(--gl-font-mono, ui-monospace, monospace)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--gl-text)",
            }}
          >
            {finding.score}/100
          </div>
        )}
      </div>
      {finding.notes && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--gl-text-tertiary)", paddingLeft: 82 }}>
          {finding.notes}
        </div>
      )}
      {typeof finding.evidence?.screenshot_url === "string" && (
        <div style={{ marginTop: 10, paddingLeft: 82 }}>
          <EvidenceScreenshot
            url={finding.evidence.screenshot_url as string}
            label={`${checkName} — captured by the browser probe`}
            thumbWidth={140}
          />
        </div>
      )}
      {fixes.length > 0 && (
        <div style={{ marginTop: 10, paddingLeft: 82 }}>
          {fixes.map((fix) => (
            <div
              key={fix.fix_recommendation_id}
              style={{
                padding: "8px 10px",
                marginBottom: 6,
                border: "0.5px solid var(--gl-border)",
                borderRadius: "var(--gl-radius-md)",
                background: "var(--gl-surface-alt)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--gl-text)" }}>
                {fix.fix_title}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--gl-text-tertiary)",
                  marginTop: 2,
                  display: "flex",
                  gap: 10,
                }}
              >
                <span>effort: {fix.effort}</span>
                <span>impact: {fix.impact}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

