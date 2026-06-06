/**
 * Prospectos v5 — profile-driven run orchestrator.
 *
 * runV5Diagnostic: wires the full v5 stack end-to-end:
 *   a. Upsert prospect row
 *   b. Resolve anonymous_landing_audit profile (instance 0)
 *   c. Create diagnostic_run with profile_id
 *   d. loadAtomicChecks — 55-check rubric from DB
 *   e. discoverPages — availablePages + searchEngine
 *   f. persistDiscoveredPages — write run_sample / prospect_page / page_scan
 *   g. scoreRun — engine returns per-check results + category/stage rollups
 *   h. persistScoredRun — findings + run_category_score upserts
 *   i. loadRunCopy + renderRunReport — structured human-facing report
 *   j. Mark run completed
 *
 * BRIDGE / additive: runs in parallel to the legacy runner; the legacy path is
 * unchanged. Rate-limiting (anonymous path) is the API route's responsibility —
 * record_diagnostic_request is called BEFORE runV5Diagnostic.
 *
 * Multi-tenancy (CLAUDE.md §2): instanceId may be null (anonymous) or 0 (the
 * template instance) — both are REAL values; strict null checks throughout.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAtomicChecks, DEFAULT_PROFILE_CODE } from "./loader";
import { scoreRun } from "./engine";
import { getScorer } from "./registry";
import { persistScoredRun } from "./persist";
import { discoverPages, pageTypesFromChecks, persistDiscoveredPages } from "./discovery";
import {
  loadRunCopy,
  renderRunReport,
  type RenderedReport,
  type FixesByCheckId,
} from "./copy";
import type { AtomicCheck } from "./types";
import type { DiscoveryDeps } from "./discovery";
// Side effect: ensures scorer registry is populated before any run.
import "./scorers";

export type RunV5DiagnosticInput = {
  url: string;
  pdpUrl?: string | null;
  categoryUrl?: string | null;
  prospectName?: string | null;
  verticalId?: number | null;
  contactEmail?: string | null;
  /** Resolved instance: null = anonymous, 0 = template. Both are real values. */
  instanceId: number | null;
  profileCode?: string;
  locale?: string;
};

export type RunV5DiagnosticDeps = {
  supabase: SupabaseClient;
  /** Partial override for discovery collaborators (unit testing / stubs). */
  discoveryDeps?: Partial<DiscoveryDeps>;
};

export type RunV5DiagnosticOk = {
  ok: true;
  runId: string;
  report: RenderedReport;
  findingsInserted: number;
  categoryScoresUpserted: number;
};

export type RunV5DiagnosticResult = RunV5DiagnosticOk | { error: string };

// ── Internal helpers ─────────────────────────────────────────────────────────

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

async function resolveProfile(
  supabase: SupabaseClient,
  profileCode: string,
): Promise<{ profileId: number } | { error: string }> {
  const { data, error } = await supabase
    .from("diagnostic_profile")
    .select("diagnostic_profile_id")
    .eq("profile_code", profileCode)
    .eq("instance_id", 0)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: `Profile not found: ${profileCode}` };
  return { profileId: data.diagnostic_profile_id as number };
}

async function loadCategoryIdMap(
  supabase: SupabaseClient,
  checks: AtomicCheck[],
): Promise<Map<string, number>> {
  const codes = [...new Set(checks.map((c) => c.category.code))];
  if (codes.length === 0) return new Map();

  const { data } = await supabase
    .from("diagnostic_category")
    .select("diagnostic_category_id, category_code")
    .eq("instance_id", 0)
    .in("category_code", codes);

  const map = new Map<string, number>();
  for (const row of (data ?? []) as {
    diagnostic_category_id: number;
    category_code: string;
  }[]) {
    map.set(row.category_code, row.diagnostic_category_id);
  }
  return map;
}

async function loadFixes(
  supabase: SupabaseClient,
  checkIds: number[],
): Promise<FixesByCheckId> {
  if (checkIds.length === 0) return new Map();

  const { data } = await supabase
    .from("fix_recommendation")
    .select("diagnostic_check_id, fix_title, fix_body_md, effort, impact")
    .in("diagnostic_check_id", checkIds)
    .order("sort_order");

  const map: FixesByCheckId = new Map();
  for (const row of (data ?? []) as {
    diagnostic_check_id: number;
    fix_title: string;
    fix_body_md: string | null;
    effort: string | null;
    impact: string | null;
  }[]) {
    const fixes = map.get(row.diagnostic_check_id) ?? [];
    fixes.push({
      title: row.fix_title,
      body_md: row.fix_body_md ?? undefined,
      effort: row.effort ?? undefined,
      impact: row.impact ?? undefined,
    });
    map.set(row.diagnostic_check_id, fixes);
  }
  return map;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run the v5 diagnostic end-to-end. Rate-limiting must be applied by the
 * caller before invoking this function (the API route does this).
 */
export async function runV5Diagnostic(
  input: RunV5DiagnosticInput,
  { supabase, discoveryDeps = {} }: RunV5DiagnosticDeps,
): Promise<RunV5DiagnosticResult> {
  const {
    instanceId,
    profileCode = DEFAULT_PROFILE_CODE,
    locale = "es",
  } = input;

  const rootUrl = normalizeUrl(input.url);
  const entryUrl = input.pdpUrl ? normalizeUrl(input.pdpUrl) : rootUrl;

  // a. Upsert prospect
  const prospectResult = await upsertProspect(
    supabase,
    instanceId,
    rootUrl,
    input.prospectName?.trim() ?? null,
    input.verticalId ?? null,
    input.contactEmail?.trim() ?? null,
  );
  if ("error" in prospectResult) return { error: prospectResult.error };
  const { prospect_id: prospectId } = prospectResult;

  // b. Resolve profile
  const profileResult = await resolveProfile(supabase, profileCode);
  if ("error" in profileResult) return { error: profileResult.error };
  const { profileId } = profileResult;

  // c. Create diagnostic_run with profile_id
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runErr } = await supabase
    .from("diagnostic_run")
    .insert({
      prospect_id: prospectId,
      instance_id: instanceId,
      profile_id: profileId,
      run_source: instanceId === null ? "landing_page" : "scout_admin",
      run_status: "running",
      started_at: startedAt,
    })
    .select("run_id")
    .single();

  if (runErr ?? !runRow) {
    return { error: runErr?.message ?? "Failed to create diagnostic_run" };
  }
  const runId = runRow.run_id as string;

  try {
    // d. Load atomic checks
    const checks = await loadAtomicChecks(supabase, { profileCode, instanceId });

    // e. Discover pages (PDP-first navigation)
    const pageTypes = pageTypesFromChecks(checks);
    const discovery = await discoverPages(
      { entryUrl, instanceId, pageTypes },
      discoveryDeps,
    );

    // f. Persist discovered pages (best-effort — failure doesn't abort the run)
    await persistDiscoveredPages(
      supabase,
      { runId, prospectId, instanceId, startedAt },
      discovery,
    ).catch((e) =>
      console.warn(
        `runV5Diagnostic: persistDiscoveredPages: ${e instanceof Error ? e.message : e}`,
      ),
    );

    // g. Score the run (pure, no IO)
    const ctx = {
      url: entryUrl,
      instanceId,
      pages: discovery.pages,
      searchEngine: discovery.searchEngine,
    };
    const scored = await scoreRun({
      checks,
      dispatch: getScorer,
      ctx,
      availablePages: discovery.availablePages,
    });

    // h. Persist findings + run_category_score
    const categoryIdByCode = await loadCategoryIdMap(supabase, checks);
    const persistResult = await persistScoredRun({
      supabase,
      runId,
      instanceId,
      scored,
      categoryIdByCode,
    });

    // i. Load copy + fixes, then render the structured report
    const checkIds = checks.map((c) => c.diagnosticCheckId);
    const [copy, fixes] = await Promise.all([
      loadRunCopy(supabase, locale),
      loadFixes(supabase, checkIds),
    ]);

    // v5 anonymous runs have no prospect economics → uplift is null for all categories.
    const categoryUpliftByCode = new Map<string, number | null>(
      scored.categories.map((sc) => [sc.category.code, null]),
    );

    const report = renderRunReport(scored, copy, locale, {
      profile: profileCode,
      fixesByCheckId: fixes,
      categoryUpliftByCode,
    });

    // j. Mark run completed
    await supabase
      .from("diagnostic_run")
      .update({
        run_status: "completed",
        completed_at: new Date().toISOString(),
        overall_score: scored.overall,
      })
      .eq("run_id", runId);

    return {
      ok: true,
      runId,
      report,
      findingsInserted: persistResult.findingsInserted,
      categoryScoresUpserted: persistResult.categoryScoresUpserted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort failure mark — swallow secondary errors so we return the original.
    try {
      await supabase
        .from("diagnostic_run")
        .update({ run_status: "failed", error_message: message })
        .eq("run_id", runId);
    } catch {
      // best-effort only
    }
    return { error: message };
  }
}
