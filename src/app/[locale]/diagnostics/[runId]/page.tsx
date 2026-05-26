import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

type Run = {
  run_id: string;
  prospect_id: number;
  instance_id: number | null;
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
  platform_detected: string | null;
  engine_detected: string | null;
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
};

/**
 * Public report page for anonymous diagnostic runs. Reachable by anyone
 * who has the run_id UUID. Authenticated-instance runs render their
 * report under /prospects/runs/[runId] instead — this page hard-rejects
 * those (the route is *only* for anon runs).
 */
export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const supabase = createServiceRoleClient();

  const { data: runRaw } = await supabase
    .from("diagnostic_run")
    .select(
      "run_id, prospect_id, instance_id, run_status, started_at, completed_at, overall_score, stage_scores, maturity_tier, est_annual_uplift_usd, error_message",
    )
    .eq("run_id", runId)
    .maybeSingle();

  if (!runRaw || runRaw.instance_id !== null) notFound();
  const run = runRaw as Run;

  const { data: prospectRaw } = await supabase
    .from("prospect")
    .select("prospect_id, url, display_name, platform_detected, engine_detected")
    .eq("prospect_id", run.prospect_id)
    .maybeSingle();
  const prospect = prospectRaw as Prospect | null;

  const [{ data: stagesRaw }, { data: checksRaw }, { data: findingsRaw }] =
    await Promise.all([
      supabase
        .from("diagnostic_stage")
        .select("diagnostic_stage_id, stage_code, stage_name, sort_order")
        .order("sort_order"),
      supabase
        .from("diagnostic_check")
        .select("diagnostic_check_id, check_code, check_name, diagnostic_stage_id")
        .eq("instance_id", 0),
      supabase
        .from("finding")
        .select(
          "finding_id, diagnostic_check_id, score, result_status, evidence, notes",
        )
        .eq("run_id", runId),
    ]);

  const stages: Stage[] = (stagesRaw ?? []) as Stage[];
  const checks: Check[] = (checksRaw ?? []) as Check[];
  const findings: Finding[] = (findingsRaw ?? []) as Finding[];

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
    fixes = (fixesRaw ?? [])
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
    <main
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "48px 24px 64px",
        fontFamily: "var(--font-hanken), system-ui, sans-serif",
        color: "#131316",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888", marginBottom: 6 }}>
          GroLabs · Prospectos diagnostic
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "0 0 6px" }}>
          {prospect?.display_name ?? prospect?.url ?? runId}
        </h1>
        {prospect?.url && (
          <a
            href={prospect.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: "#666", textDecoration: "underline" }}
          >
            {prospect.url}
          </a>
        )}
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Stat label="Overall score" value={run.overall_score ?? "—"} mono />
        <Stat label="Maturity" value={(run.maturity_tier ?? "—").toString().toUpperCase()} />
        <Stat label="Platform" value={prospect?.platform_detected ?? "—"} />
        <Stat label="Search engine" value={prospect?.engine_detected ?? "—"} />
      </section>

      {run.est_annual_uplift_usd != null && (
        <section
          style={{
            padding: "18px 22px",
            marginBottom: 28,
            border: "1px solid #fae194",
            background: "#fff8e0",
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#996b00", marginBottom: 4 }}>
            Estimated annual uplift
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "#131316" }}>
            ${run.est_annual_uplift_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
            Calculated from per-vertical benchmarks and your current scores. Lower confidence in v1 — see fixes below for the levers.
          </div>
        </section>
      )}

      {run.run_status === "failed" && run.error_message && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 20,
            border: "1px solid #f5c2c7",
            background: "#fde2e4",
            borderRadius: 8,
            color: "#842029",
            fontSize: 13,
          }}
        >
          The diagnostic failed: {run.error_message}
        </div>
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
          <section
            key={stage.diagnostic_stage_id}
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: 10,
              padding: 20,
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 14px", display: "flex", alignItems: "baseline", gap: 12 }}>
              {stage.stage_name}
              {score != null && (
                <span style={{ fontSize: 13, color: "#666", fontWeight: 400 }}>
                  {score}/100
                </span>
              )}
            </h2>
            {stageFindings.map((f) => {
              const check = checkById.get(f.diagnostic_check_id);
              const ffixes = fixesByFinding.get(f.finding_id) ?? [];
              return (
                <FindingRow
                  key={f.finding_id}
                  finding={f}
                  checkName={check?.check_name ?? `Check #${f.diagnostic_check_id}`}
                  checkCode={check?.check_code ?? ""}
                  fixes={ffixes}
                />
              );
            })}
          </section>
        );
      })}

      <footer
        style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: "1px solid #eee",
          fontSize: 11,
          color: "#888",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span>
          Diagnostic completed {run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}.
        </span>
        <span>Run ID: <code>{runId}</code></span>
      </footer>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "#131316",
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          fontVariantNumeric: mono ? "tabular-nums" : undefined,
        }}
      >
        {value}
      </div>
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
    pass: "#0a7d3c",
    partial: "#996b00",
    fail: "#b03030",
    na: "#888",
    error: "#b03030",
  };
  return (
    <div
      style={{
        padding: "12px 0",
        borderTop: "1px solid #f0f0f0",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: statusColor[finding.result_status] ?? "#888",
            minWidth: 72,
          }}
        >
          {finding.result_status}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{checkName}</div>
          <div style={{ fontSize: 11, color: "#888", fontFamily: "ui-monospace, monospace" }}>
            {checkCode}
          </div>
        </div>
        {finding.score != null && (
          <div style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", fontVariantNumeric: "tabular-nums", color: "#444" }}>
            {finding.score}/100
          </div>
        )}
      </div>
      {finding.notes && (
        <p style={{ marginTop: 6, fontSize: 12, color: "#666", paddingLeft: 86 }}>{finding.notes}</p>
      )}
      {fixes.length > 0 && (
        <div style={{ marginTop: 10, paddingLeft: 86 }}>
          {fixes.map((fix) => (
            <div
              key={fix.fix_recommendation_id}
              style={{
                padding: "10px 12px",
                marginBottom: 6,
                background: "#fafafa",
                border: "1px solid #ececec",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{fix.fix_title}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2, display: "flex", gap: 12 }}>
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
