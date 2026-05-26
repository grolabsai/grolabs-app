/**
 * Probe runner — orchestrates a single diagnostic run end-to-end.
 *
 * Flow:
 *  1. Upsert a `prospect` row for (instance_id, url).
 *  2. Create a `diagnostic_run` (status=running).
 *  3. Probe site-wide (llms.txt / robots.txt / sitemap.xml).
 *  4. Probe the PDP via GLPIM `/tools/pdp-signals`.
 *  5. For each active diagnostic_check, dispatch to a registered scorer
 *     (or write 'na' if none exists yet).
 *  6. Write `finding` rows in a single batch.
 *  7. Materialize `finding_fix` rows from each finding's check's
 *     fix_recommendations whose `trigger_condition` matches.
 *  8. Roll up overall_score, stage_scores, est_annual_uplift_usd (NULL
 *     for v1 — that calculation arrives with the benchmarks formula PR)
 *     and mark the run completed.
 *
 * Sync execution for v1. A queued/worker pattern is a future PR.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import {
  scanPdpSignals,
  scanSiteSignals,
  type PdpSignals,
  type SiteSignals,
} from "@/lib/glpim";
import { probeSiteWide } from "./site-checks";
import { SCORERS, scoreCheck } from "./scorers";
import type {
  Evidence,
  FindingStatus,
  ScoringResult,
} from "./types";

export type StartDiagnosticInput = {
  url: string;
  pdpUrl?: string | null;
  categoryUrl?: string | null;
  prospectName?: string | null;
  verticalId?: number | null;
};

export type StartDiagnosticResult =
  | { ok: true; runId: string; prospectId: number }
  | { error: string };

type CheckRow = {
  diagnostic_check_id: number;
  check_code: string;
  diagnostic_stage_id: number;
  weight: number;
};

type FixRow = {
  fix_recommendation_id: number;
  diagnostic_check_id: number;
  trigger_condition: Record<string, unknown>;
  sort_order: number;
};

function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

async function upsertProspect(
  supabase: SupabaseClient,
  instanceId: number,
  url: string,
  name: string | null,
  verticalId: number | null,
): Promise<{ prospect_id: number } | { error: string }> {
  // Try existing first to keep the row stable across runs.
  const { data: existing } = await supabase
    .from("prospect")
    .select("prospect_id")
    .eq("instance_id", instanceId)
    .eq("url", url)
    .maybeSingle();

  if (existing) return { prospect_id: existing.prospect_id as number };

  const { data, error } = await supabase
    .from("prospect")
    .insert({
      instance_id: instanceId,
      url,
      display_name: name,
      vertical_id: verticalId,
    })
    .select("prospect_id")
    .single();
  if (error) return { error: error.message };
  return { prospect_id: data.prospect_id as number };
}

function triggerMatches(
  condition: Record<string, unknown>,
  result: ScoringResult,
): boolean {
  // Empty trigger = always include.
  if (!condition || Object.keys(condition).length === 0) return true;

  if (
    "result_status" in condition &&
    condition.result_status !== result.result_status
  ) {
    return false;
  }
  if (
    "score_below" in condition &&
    typeof condition.score_below === "number" &&
    (result.score == null || result.score >= condition.score_below)
  ) {
    return false;
  }
  if (
    "score_at_or_below" in condition &&
    typeof condition.score_at_or_below === "number" &&
    (result.score == null || result.score > condition.score_at_or_below)
  ) {
    return false;
  }
  return true;
}

function rollupStageScores(
  findings: { score: number | null; diagnostic_stage_id: number; weight: number }[],
): { stageScores: Record<number, number>; overall: number | null } {
  const byStage = new Map<number, { sum: number; weight: number }>();
  for (const f of findings) {
    if (f.score == null) continue;
    const acc = byStage.get(f.diagnostic_stage_id) ?? { sum: 0, weight: 0 };
    acc.sum += f.score * f.weight;
    acc.weight += f.weight;
    byStage.set(f.diagnostic_stage_id, acc);
  }
  const stageScores: Record<number, number> = {};
  let overallSum = 0;
  let overallW = 0;
  for (const [stageId, { sum, weight }] of byStage) {
    if (weight === 0) continue;
    const stageScore = Math.round(sum / weight);
    stageScores[stageId] = stageScore;
    overallSum += stageScore;
    overallW += 1;
  }
  const overall = overallW > 0 ? Math.round(overallSum / overallW) : null;
  return { stageScores, overall };
}

function maturityTier(overall: number | null): "low" | "medium" | "high" | null {
  if (overall == null) return null;
  if (overall >= 75) return "high";
  if (overall >= 45) return "medium";
  return "low";
}

export async function startDiagnostic(
  input: StartDiagnosticInput,
): Promise<StartDiagnosticResult> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };

  const rootUrl = normalizeUrl(input.url);
  const pdpUrl = input.pdpUrl ? normalizeUrl(input.pdpUrl) : rootUrl;
  const categoryUrl = input.categoryUrl ? normalizeUrl(input.categoryUrl) : null;

  const supabase = await createClient();

  // 1. Upsert prospect
  const prospectResult = await upsertProspect(
    supabase,
    instanceId,
    rootUrl,
    input.prospectName?.trim() || null,
    input.verticalId ?? null,
  );
  if ("error" in prospectResult) return { error: prospectResult.error };
  const prospectId = prospectResult.prospect_id;

  // 2. Create run
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runErr } = await supabase
    .from("diagnostic_run")
    .insert({
      prospect_id: prospectId,
      instance_id: instanceId,
      run_source: "scout_admin",
      run_status: "running",
      started_at: startedAt,
    })
    .select("run_id")
    .single();
  if (runErr || !runRow) {
    return { error: runErr?.message ?? "Failed to create run" };
  }
  const runId = runRow.run_id as string;

  // Sample list for evidence/reproducibility
  const samples: {
    run_id: string;
    sample_type: "homepage" | "pdp" | "category" | "search_query";
    url_or_query: string;
    selection_reason: string;
  }[] = [
    {
      run_id: runId,
      sample_type: "homepage",
      url_or_query: rootUrl,
      selection_reason: "user_supplied_root",
    },
    {
      run_id: runId,
      sample_type: "pdp",
      url_or_query: pdpUrl,
      selection_reason: input.pdpUrl ? "user_supplied" : "root_as_pdp_fallback",
    },
  ];
  if (categoryUrl) {
    samples.push({
      run_id: runId,
      sample_type: "category",
      url_or_query: categoryUrl,
      selection_reason: "user_supplied_category",
    });
  }
  await supabase.from("run_sample").insert(samples);

  // 3 + 4. Probe in parallel: site-wide HTTP, GLPIM PDP, GLPIM site-signals
  const [siteCtx, pdpResult, siteSignalsResult] = await Promise.all([
    probeSiteWide(rootUrl),
    fetchPdpSignals(pdpUrl),
    fetchSiteSignals({ url: rootUrl, categoryUrl }),
  ]);

  const ctx: import("./types").RunContext = {
    site: siteCtx,
    pdp: { url: pdpUrl, signals: pdpResult.signals, fetchError: pdpResult.error },
    siteSignals: {
      signals: siteSignalsResult.signals,
      fetchError: siteSignalsResult.error,
    },
  };

  // Persist the detected platform/engine on the prospect for future runs.
  if (siteSignalsResult.signals) {
    await supabase
      .from("prospect")
      .update({
        platform_detected: siteSignalsResult.signals.platform_detected,
        engine_detected: siteSignalsResult.signals.engine_detected,
      })
      .eq("prospect_id", prospectId);
  }

  // 5. Load active checks (this instance + template fallthrough via RLS).
  const { data: checksRaw, error: checksErr } = await supabase
    .from("diagnostic_check")
    .select("diagnostic_check_id, check_code, diagnostic_stage_id, weight")
    .eq("is_active", true);

  if (checksErr || !checksRaw) {
    await markRunFailed(supabase, runId, checksErr?.message ?? "No checks loaded");
    return { error: checksErr?.message ?? "No checks loaded" };
  }
  const checks: CheckRow[] = checksRaw as CheckRow[];

  // 6. Score each + insert findings
  const findingsToInsert = checks.map((check) => {
    const result = scoreCheck(check.check_code, ctx);
    return {
      check,
      result,
    };
  });

  const findingRows = findingsToInsert.map(({ check, result }) => ({
    run_id: runId,
    instance_id: instanceId,
    diagnostic_check_id: check.diagnostic_check_id,
    score: result.score,
    result_status: result.result_status,
    evidence: result.evidence,
    notes: result.notes ?? null,
  }));

  const { data: insertedFindings, error: findingErr } = await supabase
    .from("finding")
    .insert(findingRows)
    .select("finding_id, diagnostic_check_id, result_status, score");

  if (findingErr || !insertedFindings) {
    await markRunFailed(
      supabase,
      runId,
      findingErr?.message ?? "Failed to write findings",
    );
    return { error: findingErr?.message ?? "Failed to write findings" };
  }

  // 7. Materialize finding_fix from triggers
  const checkIdToFindingId = new Map<number, number>();
  const findingScoreById = new Map<
    number,
    { status: FindingStatus; score: number | null }
  >();
  for (const f of insertedFindings) {
    checkIdToFindingId.set(
      f.diagnostic_check_id as number,
      f.finding_id as number,
    );
    findingScoreById.set(f.finding_id as number, {
      status: f.result_status as FindingStatus,
      score: f.score as number | null,
    });
  }

  const checkIds = Array.from(checkIdToFindingId.keys());
  if (checkIds.length > 0) {
    const { data: fixesRaw } = await supabase
      .from("fix_recommendation")
      .select(
        "fix_recommendation_id, diagnostic_check_id, trigger_condition, sort_order",
      )
      .eq("is_active", true)
      .in("diagnostic_check_id", checkIds);

    const fixes: FixRow[] = (fixesRaw ?? []) as FixRow[];
    const finRows: {
      finding_id: number;
      fix_recommendation_id: number;
      priority: number;
    }[] = [];

    for (const fix of fixes) {
      const findingId = checkIdToFindingId.get(fix.diagnostic_check_id);
      if (findingId == null) continue;
      const findingState = findingScoreById.get(findingId);
      if (!findingState) continue;
      const matched = triggerMatches(fix.trigger_condition ?? {}, {
        result_status: findingState.status,
        score: findingState.score,
        evidence: {} as Evidence,
      });
      if (!matched) continue;
      finRows.push({
        finding_id: findingId,
        fix_recommendation_id: fix.fix_recommendation_id,
        priority: fix.sort_order,
      });
    }

    if (finRows.length > 0) {
      await supabase.from("finding_fix").insert(finRows);
    }
  }

  // 8. Rollup + complete the run
  const findingsForRollup = findingsToInsert.map(({ check, result }) => ({
    score: result.score,
    diagnostic_stage_id: check.diagnostic_stage_id,
    weight: check.weight,
  }));
  const { stageScores, overall } = rollupStageScores(findingsForRollup);

  await supabase
    .from("diagnostic_run")
    .update({
      run_status: "completed",
      completed_at: new Date().toISOString(),
      overall_score: overall,
      stage_scores: stageScores,
      maturity_tier: maturityTier(overall),
      // est_annual_uplift_usd intentionally left NULL — formula PR follows.
    })
    .eq("run_id", runId);

  return { ok: true, runId, prospectId };
}

async function fetchPdpSignals(
  url: string,
): Promise<{ signals: PdpSignals | null; error: string | null }> {
  try {
    const signals = await scanPdpSignals(url);
    return { signals, error: null };
  } catch (e) {
    return { signals: null, error: String(e instanceof Error ? e.message : e) };
  }
}

async function fetchSiteSignals(input: {
  url: string;
  categoryUrl: string | null;
}): Promise<{ signals: SiteSignals | null; error: string | null }> {
  try {
    const signals = await scanSiteSignals({
      url: input.url,
      categoryUrl: input.categoryUrl,
    });
    return { signals, error: null };
  } catch (e) {
    return { signals: null, error: String(e instanceof Error ? e.message : e) };
  }
}

async function markRunFailed(
  supabase: SupabaseClient,
  runId: string,
  message: string,
) {
  await supabase
    .from("diagnostic_run")
    .update({
      run_status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    })
    .eq("run_id", runId);
}
