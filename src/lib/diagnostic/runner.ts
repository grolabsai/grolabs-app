/**
 * Probe runner — orchestrates a single diagnostic run end-to-end.
 *
 * Flow:
 *  1. Upsert a `prospect` row for (instance_id, url).
 *  2. Create a `diagnostic_run` (status=running).
 *  3. Probe site-wide (llms.txt / robots.txt / sitemap.xml).
 *  4. Probe the PDP via ASE `/tools/pdp-signals`.
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
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { currentInstanceId } from "@/lib/instance";
import {
  scanPdpSignals,
  scanSiteSignals,
  type PdpSignals,
  type SiteSignals,
} from "@/lib/ase";
import { probeSiteWide } from "./site-checks";
import { runBrowserProbe, type BrowserProbeResult } from "./browser-probe";
import { scoreCheck } from "./scorers";
import {
  computeFindingUplift,
  resolveFactors,
  type BenchmarkRow,
} from "./revenue";
import { discoverSamples } from "./sample-discovery";
import { classifyVertical } from "./classify-vertical";
import { fetchCoreWebVitals } from "./psi";
import type { ExpectedAttribute, VerticalKnowledge } from "./types";
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
  contactEmail?: string | null;
};

export type StartDiagnosticResult =
  | { ok: true; runId: string; prospectId: number }
  | { error: string };

type CheckRow = {
  diagnostic_check_id: number;
  check_code: string;
  diagnostic_stage_id: number;
  weight: number;
  default_delta_rate: number | null;
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
  instanceId: number | null,
  url: string,
  name: string | null,
  verticalId: number | null,
  contactEmail: string | null,
): Promise<{ prospect_id: number } | { error: string }> {
  // Look up existing — anonymous flow has its own unique-url-when-null index.
  let lookup = supabase.from("prospect").select("prospect_id").eq("url", url);
  if (instanceId === null) {
    lookup = lookup.is("instance_id", null);
  } else {
    lookup = lookup.eq("instance_id", instanceId);
  }
  const { data: existing } = await lookup.maybeSingle();
  if (existing) return { prospect_id: existing.prospect_id as number };

  const { data, error } = await supabase
    .from("prospect")
    .insert({
      instance_id: instanceId,
      url,
      display_name: name,
      vertical_id: verticalId,
      contact_email: contactEmail,
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
  return runDiagnostic({
    input,
    instanceId,
    supabase: await createClient(),
    runSource: "scout_admin",
  });
}

/**
 * Public-API entry: anonymous run with instance_id NULL, using a
 * service-role client so RLS doesn't block the writes. Read access for
 * anon is granted by the diagnostic_run_anon_read policy + the unguessable
 * run_id UUID.
 */
export async function startAnonymousDiagnostic(
  input: StartDiagnosticInput,
): Promise<StartDiagnosticResult> {
  const supabase = createServiceRoleClient();
  return runDiagnostic({
    input,
    instanceId: null,
    supabase,
    runSource: "landing_page",
  });
}

async function runDiagnostic(opts: {
  input: StartDiagnosticInput;
  instanceId: number | null;
  supabase: SupabaseClient;
  runSource: "scout_admin" | "landing_page";
}): Promise<StartDiagnosticResult> {
  const { input, instanceId, supabase, runSource } = opts;

  const rootUrl = normalizeUrl(input.url);

  // ── Pre-flight: discover samples + (when needed) classify vertical ─────
  // discoverSamples does one homepage fetch and returns featured-PDP +
  // category links plus the snippet hints the classifier consumes.
  const discovered = await discoverSamples(rootUrl);
  const pdpUrl = input.pdpUrl
    ? normalizeUrl(input.pdpUrl)
    : discovered.pdpUrl ?? rootUrl;
  const categoryUrl = input.categoryUrl
    ? normalizeUrl(input.categoryUrl)
    : discovered.categoryUrl;

  // Vertical classification: explicit > prospect's stored vertical >
  // homepage classifier. When the user supplies it, we trust them; when
  // missing, we run the classifier (keyword first, Haiku tie-breaker).
  let resolvedVerticalId: number | null = input.verticalId ?? null;
  let verticalDetection: { method: string; scores: Record<string, number>; confidence: string } | null = null;
  if (resolvedVerticalId == null) {
    const classification = await classifyVertical({
      homepageText: discovered.homepageText,
      homepageHints: discovered.homepageHints,
      supabase,
    });
    resolvedVerticalId = classification.vertical_id;
    verticalDetection = {
      method: classification.method,
      scores: classification.scores,
      confidence: classification.confidence,
    };
  }

  // 1. Upsert prospect
  const prospectResult = await upsertProspect(
    supabase,
    instanceId,
    rootUrl,
    input.prospectName?.trim() || null,
    resolvedVerticalId,
    input.contactEmail?.trim() || null,
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
      run_source: runSource,
      run_status: "running",
      started_at: startedAt,
    })
    .select("run_id")
    .single();
  if (runErr || !runRow) {
    return { error: runErr?.message ?? "Failed to create run" };
  }
  const runId = runRow.run_id as string;

  // Sample list for evidence/reproducibility. selection_reason carries
  // how each URL was picked (user-supplied vs auto-discovered).
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
      selection_reason: input.pdpUrl
        ? "user_supplied"
        : discovered.pdpUrl
          ? `auto:${discovered.pdpReason}`
          : "root_as_pdp_fallback",
    },
  ];
  if (categoryUrl) {
    samples.push({
      run_id: runId,
      sample_type: "category",
      url_or_query: categoryUrl,
      selection_reason: input.categoryUrl
        ? "user_supplied"
        : `auto:${discovered.categoryReason}`,
    });
  }
  await supabase.from("run_sample").insert(samples);

  // ── Persist prospect_pages and create page_scan rows ────────────────
  // Each unique URL we're about to probe becomes (or reuses) a
  // prospect_page row, and a page_scan row links that page to this
  // run. Scan results (overall_score, etc.) are written back at the
  // end alongside the run rollup.
  type PageRef = {
    pageType: "homepage" | "pdp" | "category";
    url: string;
    pageId: number;
    scanId: number;
  };
  const pageRefs: PageRef[] = [];
  for (const sample of samples) {
    if (
      sample.sample_type !== "homepage" &&
      sample.sample_type !== "pdp" &&
      sample.sample_type !== "category"
    ) {
      continue;
    }
    const url = sample.url_or_query;
    const pageType = sample.sample_type;

    // Insert-or-update prospect_page. Unique on (prospect_id, url).
    let { data: pageRow } = await supabase
      .from("prospect_page")
      .select("prospect_page_id")
      .eq("prospect_id", prospectId)
      .eq("url", url)
      .maybeSingle();
    if (!pageRow) {
      const { data: inserted } = await supabase
        .from("prospect_page")
        .insert({
          prospect_id: prospectId,
          instance_id: instanceId,
          url,
          page_type: pageType,
          discovered_via:
            sample.selection_reason.startsWith("user_supplied") ? "manual" : "auto",
        })
        .select("prospect_page_id")
        .single();
      if (inserted) pageRow = inserted;
    }
    if (!pageRow) continue;
    const pageId = pageRow.prospect_page_id as number;

    // Create the scan row for this page within this run.
    const { data: scanRow } = await supabase
      .from("page_scan")
      .insert({
        prospect_page_id: pageId,
        run_id: runId,
        instance_id: instanceId,
        status: "running",
        started_at: startedAt,
      })
      .select("scan_id")
      .single();
    if (!scanRow) continue;

    pageRefs.push({
      pageType,
      url,
      pageId,
      scanId: scanRow.scan_id as number,
    });
  }

  // Persist the resolved vertical + logo on the prospect so subsequent
  // runs skip the classifier and the UI has a visual badge to show.
  const prospectPatch: Record<string, unknown> = {};
  if (resolvedVerticalId != null) prospectPatch.vertical_id = resolvedVerticalId;
  if (discovered.logoUrl) prospectPatch.logo_url = discovered.logoUrl;
  if (Object.keys(prospectPatch).length > 0) {
    await supabase
      .from("prospect")
      .update(prospectPatch)
      .eq("prospect_id", prospectId);
  }

  // Helper: pick the appropriate scan_id for a finding based on which
  // signal source primarily drives the check. The runner sets
  // finding.page_scan_id directly when inserting findings.
  function scanIdForCheck(checkCode: string): number | null {
    // PDP-specific checks → the PDP scan
    if (checkCode.startsWith("pdp.")) {
      return pageRefs.find((p) => p.pageType === "pdp")?.scanId ?? null;
    }
    // Returns-risk + product JSON-LD checks also read PDP signals
    if (
      checkCode === "returns.attribute_completeness" ||
      checkCode === "discovery.product_jsonld_complete" ||
      checkCode === "discovery.og_cards" ||
      checkCode === "discovery.core_web_vitals"
    ) {
      return pageRefs.find((p) => p.pageType === "pdp")?.scanId ?? null;
    }
    // Faceting + engine ID read the category page when supplied
    if (checkCode === "on_site_nav.faceting") {
      return (
        pageRefs.find((p) => p.pageType === "category")?.scanId ??
        pageRefs.find((p) => p.pageType === "homepage")?.scanId ??
        null
      );
    }
    // Site-wide checks (llms.txt, sitemap, search engine, browser probes)
    // are owned by the homepage scan
    return pageRefs.find((p) => p.pageType === "homepage")?.scanId ?? null;
  }

  // Detect locale from the homepage snippet so we can prefer matching
  // synonym pairs and empty-state queries. ES vs EN heuristic is rough
  // but good enough for v1; failure falls back to "everything".
  const detectedLocale = detectLocaleFromText(discovered.homepageText);

  // Resolve test vocabulary for the prospect's vertical (or generic
  // fallback when no vertical is set). Always read template-instance rows
  // — anon callers see them too via the diagnostic_check_anon_template_read
  // policy; authenticated runs see their own + template via RLS.
  const vocab = await loadTestVocabulary(
    supabase,
    resolvedVerticalId,
    detectedLocale,
  );

  // Expected-attribute catalog for the returns scorer.
  const expectedAttributes = await loadExpectedAttributes(
    supabase,
    resolvedVerticalId,
  );

  const probeEnabled = process.env.PROSPECTOS_BROWSER_PROBE_ENABLED === "1";
  const psiEnabled = process.env.PROSPECTOS_PSI_ENABLED !== "0";

  // 3 + 4 + 5 + CWV. Probe in parallel: site-wide HTTP, ASE PDP,
  // ASE site-signals, Core Web Vitals (PSI), and (when enabled) the
  // browser probe. Each leg is independent.
  const [siteCtx, pdpResult, siteSignalsResult, browserResult, cwvResult] = await Promise.all([
    probeSiteWide(rootUrl),
    fetchPdpSignals(pdpUrl),
    fetchSiteSignals({ url: rootUrl, categoryUrl }),
    probeEnabled
      ? runBrowserProbe({
          rootUrl,
          synonymPairs: vocab.synonymPairs,
          emptyStateQueries: vocab.emptyStateQueries,
        })
      : Promise.resolve(null as BrowserProbeResult | null),
    psiEnabled ? fetchCoreWebVitals(pdpUrl) : Promise.resolve(null),
  ]);

  const ctx: import("./types").RunContext = {
    site: siteCtx,
    pdp: { url: pdpUrl, signals: pdpResult.signals, fetchError: pdpResult.error },
    siteSignals: {
      signals: siteSignalsResult.signals,
      fetchError: siteSignalsResult.error,
    },
    browser: {
      enabled: probeEnabled,
      probe: browserResult,
    },
    cwv: { cwv: cwvResult },
    vertical: {
      vertical_id: resolvedVerticalId,
      vertical_code: null,
      locale: detectedLocale,
      expectedAttributes,
    },
  };

  // Persist the detected platform/engine on the prospect for future runs.
  // Network fingerprint (from browser probe) beats static-HTML guess when
  // both are present — XHR endpoints are ground truth.
  const networkEngine = browserResult?.engine_network_fingerprint ?? null;
  const finalEngine =
    networkEngine ?? siteSignalsResult.signals?.engine_detected ?? null;
  if (siteSignalsResult.signals || networkEngine) {
    await supabase
      .from("prospect")
      .update({
        platform_detected: siteSignalsResult.signals?.platform_detected ?? null,
        engine_detected: finalEngine,
      })
      .eq("prospect_id", prospectId);
  }

  // 5. Load active checks. For authenticated runs, RLS gives us
  // {own instance ∪ template instance 0} automatically. For service-role
  // (anonymous) runs we'd see every instance's checks, so we explicitly
  // scope to instance 0 — the canonical GroLabs rubric that powers the
  // landing-page diagnostic.
  let checksQuery = supabase
    .from("diagnostic_check")
    .select(
      "diagnostic_check_id, check_code, diagnostic_stage_id, weight, default_delta_rate",
    )
    .eq("is_active", true);
  if (instanceId === null) {
    checksQuery = checksQuery.eq("instance_id", 0);
  } else {
    checksQuery = checksQuery.in("instance_id", [0, instanceId]);
  }
  const { data: checksRaw, error: checksErr } = await checksQuery;

  if (checksErr || !checksRaw) {
    await markRunFailed(supabase, runId, checksErr?.message ?? "No checks loaded");
    return { error: checksErr?.message ?? "No checks loaded" };
  }
  const checks: CheckRow[] = checksRaw as CheckRow[];

  // Load per-vertical benchmarks + prospect economics for the revenue
  // formula. Benchmarks come from instance 0 (canonical) plus the user's
  // own instance when authenticated; resolveFactors picks the most
  // specific match per finding.
  const { data: benchmarksRaw } = resolvedVerticalId != null
    ? await loadBenchmarks(supabase, instanceId, resolvedVerticalId)
    : { data: [] as BenchmarkRow[] };
  const benchmarks: BenchmarkRow[] = (benchmarksRaw ?? []) as BenchmarkRow[];

  const { data: prospectEconRaw } = await supabase
    .from("prospect")
    .select("est_annual_traffic, est_aov_usd")
    .eq("prospect_id", prospectId)
    .maybeSingle();
  const prospectTraffic =
    typeof prospectEconRaw?.est_annual_traffic === "number"
      ? prospectEconRaw.est_annual_traffic
      : prospectEconRaw?.est_annual_traffic
        ? Number(prospectEconRaw.est_annual_traffic)
        : null;
  const prospectAov =
    typeof prospectEconRaw?.est_aov_usd === "number"
      ? prospectEconRaw.est_aov_usd
      : prospectEconRaw?.est_aov_usd
        ? Number(prospectEconRaw.est_aov_usd)
        : null;

  // 6. Score each + compute per-finding uplift + insert findings
  const findingsToInsert = checks.map((check) => {
    const result = scoreCheck(check.check_code, ctx);
    const factors = resolveFactors({
      benchmarks,
      checkId: check.diagnostic_check_id,
      stageId: check.diagnostic_stage_id,
      prospectAov,
      checkDefaultDeltaRate: check.default_delta_rate ?? null,
    });
    const uplift = computeFindingUplift({
      traffic: prospectTraffic,
      aov: factors.aov,
      baselineCr: factors.baselineCr,
      stageShare: factors.stageShare,
      deltaRate: factors.deltaRate,
      score: result.score,
      resultStatus: result.result_status,
    });
    return { check, result, uplift };
  });

  const findingRows = findingsToInsert.map(({ check, result, uplift }) => ({
    run_id: runId,
    instance_id: instanceId,
    diagnostic_check_id: check.diagnostic_check_id,
    // Wire each finding to the page_scan it primarily measured. Lets
    // the per-page history view show "this scan: 12 of 18 checks
    // ran" without joining through run_sample. Null when no page_scan
    // matches the check (rare — site-wide checks that have no
    // homepage scan).
    page_scan_id: scanIdForCheck(check.check_code),
    score: result.score,
    result_status: result.result_status,
    evidence: result.evidence,
    notes: result.notes ?? null,
    est_annual_uplift_usd: uplift.uplift_usd,
    est_confidence: uplift.confidence,
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
    // Scope fixes the same way we scoped checks (anon → instance 0 only).
    let fixesQuery = supabase
      .from("fix_recommendation")
      .select(
        "fix_recommendation_id, diagnostic_check_id, trigger_condition, sort_order",
      )
      .eq("is_active", true)
      .in("diagnostic_check_id", checkIds);
    if (instanceId === null) {
      fixesQuery = fixesQuery.eq("instance_id", 0);
    } else {
      fixesQuery = fixesQuery.in("instance_id", [0, instanceId]);
    }
    const { data: fixesRaw } = await fixesQuery;

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

  // Sum per-finding uplifts → run total. Confidence is the lowest tier
  // observed across the contributing findings (any 'low' demotes the run).
  let totalUplift: number | null = null;
  let hadAnyUplift = false;
  let confTier: "low" | "medium" | "high" = "high";
  for (const { uplift } of findingsToInsert) {
    if (uplift.uplift_usd == null) continue;
    hadAnyUplift = true;
    totalUplift = (totalUplift ?? 0) + uplift.uplift_usd;
    if (uplift.confidence === "low") confTier = "low";
    else if (uplift.confidence === "medium" && confTier === "high") confTier = "medium";
  }
  if (!hadAnyUplift) totalUplift = null;

  const revenueAssumptions = {
    traffic: prospectTraffic,
    aov: prospectAov,
    vertical_id: resolvedVerticalId,
    vertical_supplied: input.verticalId != null,
    vertical_detection: verticalDetection,
    locale_detected: detectedLocale,
    benchmarks_used: benchmarks.length,
    samples_auto_discovered: {
      pdp: !input.pdpUrl,
      category: !input.categoryUrl,
    },
  };

  const completedAt = new Date().toISOString();

  await supabase
    .from("diagnostic_run")
    .update({
      run_status: "completed",
      completed_at: completedAt,
      overall_score: overall,
      stage_scores: stageScores,
      maturity_tier: maturityTier(overall),
      est_annual_uplift_usd:
        totalUplift != null ? Math.round(totalUplift * 100) / 100 : null,
      est_confidence: totalUplift != null ? confTier : null,
      revenue_assumptions: revenueAssumptions,
    })
    .eq("run_id", runId);

  // Per-scan rollup: each page_scan gets its own overall_score derived
  // from the findings linked to it. Lets the per-page history table
  // render "scan @ <time> scored 72" without re-aggregating findings
  // every read.
  for (const ref of pageRefs) {
    const pageScanFindings = findingsToInsert.filter(({ check }) => {
      return scanIdForCheck(check.check_code) === ref.scanId;
    });
    const scanScores = pageScanFindings
      .map(({ result }) => result.score)
      .filter((s): s is number => s != null);
    const scanOverall =
      scanScores.length > 0
        ? Math.round(scanScores.reduce((a, b) => a + b, 0) / scanScores.length)
        : null;
    const scanUplift = pageScanFindings.reduce(
      (acc, { uplift }) => acc + (uplift.uplift_usd ?? 0),
      0,
    );

    await supabase
      .from("page_scan")
      .update({
        status: "completed",
        completed_at: completedAt,
        overall_score: scanOverall,
        est_annual_uplift_usd: scanUplift > 0 ? Math.round(scanUplift * 100) / 100 : null,
        // Capture the signals payload for this scan so re-scoring can
        // happen without re-fetching the page. PDP scan gets the
        // ASE PDP signals; homepage scan gets the ASE site
        // signals; category scan reuses site signals (faceting only).
        signals:
          ref.pageType === "pdp"
            ? (pdpResult.signals as unknown as Record<string, unknown>) ?? null
            : ref.pageType === "homepage"
              ? (siteSignalsResult.signals as unknown as Record<string, unknown>) ?? null
              : null,
      })
      .eq("scan_id", ref.scanId);
  }

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

async function loadBenchmarks(
  supabase: SupabaseClient,
  instanceId: number | null,
  verticalId: number,
): Promise<{ data: BenchmarkRow[] | null }> {
  let q = supabase
    .from("vertical_benchmark")
    .select(
      "vertical_id, diagnostic_stage_id, diagnostic_check_id, baseline_cr, stage_share, delta_rate, default_aov_usd",
    )
    .eq("vertical_id", verticalId);
  if (instanceId === null) {
    q = q.eq("instance_id", 0);
  } else {
    q = q.in("instance_id", [0, instanceId]);
  }
  const { data } = await q;
  return { data: (data ?? []) as BenchmarkRow[] };
}

async function loadTestVocabulary(
  supabase: SupabaseClient,
  verticalId: number | null,
  preferredLocale: string | null = null,
): Promise<{
  synonymPairs: { term_a: string; term_b: string; locale: string }[];
  emptyStateQueries: string[];
}> {
  let resolvedVerticalId = verticalId;
  if (resolvedVerticalId == null) {
    const { data: gen } = await supabase
      .from("vertical")
      .select("vertical_id")
      .eq("vertical_code", "generic")
      .maybeSingle();
    resolvedVerticalId = (gen?.vertical_id as number | undefined) ?? null;
  }
  if (resolvedVerticalId == null) {
    return { synonymPairs: [], emptyStateQueries: [] };
  }

  const [{ data: pairs }, { data: queries }] = await Promise.all([
    supabase
      .from("vertical_synonym_pair")
      .select("term_a, term_b, locale")
      .eq("is_active", true)
      .eq("vertical_id", resolvedVerticalId)
      .limit(50),
    supabase
      .from("vertical_test_query")
      .select("query_text, locale, intent")
      .eq("is_active", true)
      .eq("vertical_id", resolvedVerticalId)
      .eq("intent", "empty_state")
      .limit(20),
  ]);

  // Locale-aware preference: keep rows whose locale matches the detected
  // prospect locale when one is available. If nothing matches, fall back
  // to everything (better to test than to skip).
  const filterByLocale = <T extends { locale: string }>(rows: T[]): T[] => {
    if (!preferredLocale) return rows;
    const matched = rows.filter((r) => r.locale === preferredLocale);
    return matched.length > 0 ? matched : rows;
  };

  return {
    synonymPairs: filterByLocale(
      (pairs ?? []).map((p) => ({
        term_a: p.term_a as string,
        term_b: p.term_b as string,
        locale: p.locale as string,
      })),
    ).slice(0, 20),
    emptyStateQueries: filterByLocale(
      (queries ?? []).map((q) => ({
        query_text: q.query_text as string,
        locale: q.locale as string,
      })),
    )
      .map((q) => q.query_text)
      .slice(0, 5),
  };
}

async function loadExpectedAttributes(
  supabase: SupabaseClient,
  verticalId: number | null,
): Promise<ExpectedAttribute[]> {
  if (verticalId == null) return [];
  const { data } = await supabase
    .from("vertical_expected_attribute")
    .select("attribute_code, label, match_keywords, weight, locale")
    .eq("vertical_id", verticalId)
    .eq("is_active", true);
  return (data ?? []).map((r) => ({
    attribute_code: r.attribute_code as string,
    label: r.label as string,
    match_keywords: (r.match_keywords as string[]) ?? [],
    weight: typeof r.weight === "number" ? r.weight : Number(r.weight),
  }));
}

function detectLocaleFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Spanish keywords (presence ≥ 2 suggests 'es').
  const esSignals = [
    "envío",
    "envio",
    "carrito",
    "comprar",
    "agregar al carrito",
    "agotado",
    "talla",
    "ñ",
    "guía",
    "categoría",
    "iniciar sesión",
    "mi cuenta",
    "ofertas",
  ];
  let esHits = 0;
  for (const w of esSignals) if (lower.includes(w)) esHits += 1;
  if (esHits >= 2) return "es";
  // English fallback when no strong Spanish signal.
  return "en";
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
