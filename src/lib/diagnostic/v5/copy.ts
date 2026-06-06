/**
 * Prospectos v5 — diagnostic_copy loading and report rendering.
 *
 * Loads localized report copy from `diagnostic_copy` (instance 0, anon-readable
 * per RLS) and renders a human-facing structured report from a ScoredRun.
 *
 * INVARIANT: check_codes NEVER appear in rendered output. They are internal
 * measurement plumbing only. The diagnostic_copy table is the communication
 * layer — all user-facing text comes from there.
 *
 * Locale fallback chain: requested locale → 'en' → omit.
 * Missing copy rows → fields omitted (not null, not the raw code).
 *
 * DB-as-truth: all labels/summaries/notes come from the DB, never hardcoded.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Evidence, ResultStatus, ScoredCategory, ScoredRun, ScoredStage } from "./types";

// ── Copy index ───────────────────────────────────────────────────────────────

export type CopyRow = {
  scope: "stage" | "category" | "check" | "band";
  ref_code: string;
  locale: string;
  result_band: string | null;
  label: string | null;
  summary: string | null;
  grading_note: string | null;
};

/** In-memory copy index keyed by (scope, ref_code, locale, result_band). */
export type CopyIndex = Map<string, CopyRow>;

function copyKey(
  scope: string,
  ref_code: string,
  locale: string,
  result_band?: string | null,
): string {
  return `${scope}:${ref_code}:${locale}:${result_band ?? ""}`;
}

/**
 * Load all diagnostic_copy rows for instance 0 in the requested locale plus
 * 'en' as fallback. One query, indexed in memory for O(1) lookup per check.
 */
export async function loadRunCopy(
  supabase: SupabaseClient,
  locale = "es",
): Promise<CopyIndex> {
  const locales = locale === "en" ? ["en"] : [locale, "en"];

  const { data, error } = await supabase
    .from("diagnostic_copy")
    .select("scope, ref_code, locale, result_band, label, summary, grading_note")
    .eq("instance_id", 0)
    .in("locale", locales);

  if (error) {
    console.warn(`loadRunCopy: failed to load diagnostic_copy: ${error.message}`);
    return new Map();
  }

  const index: CopyIndex = new Map();
  for (const row of (data ?? []) as CopyRow[]) {
    const key = copyKey(row.scope, row.ref_code, row.locale, row.result_band);
    // Primary locale wins over 'en' fallback when both exist.
    if (!index.has(key) || row.locale === locale) {
      index.set(key, row);
    }
  }
  return index;
}

/**
 * Look up copy with locale fallback: requested locale → 'en' → undefined.
 * Returns undefined when no copy exists — callers omit the field.
 */
export function lookupCopy(
  index: CopyIndex,
  scope: string,
  ref_code: string,
  locale: string,
  result_band?: string | null,
): CopyRow | undefined {
  const primary = index.get(copyKey(scope, ref_code, locale, result_band));
  if (primary) return primary;
  if (locale !== "en") return index.get(copyKey(scope, ref_code, "en", result_band));
  return undefined;
}

// ── Rendered report types ────────────────────────────────────────────────────

export type RenderedFix = {
  title: string;
  body_md?: string;
  effort?: string;
  impact?: string;
};

/** check_code is intentionally absent — never surfaced in rendered output. */
export type RenderedFinding = {
  score: number | null;
  status: ResultStatus;
  label?: string;
  summary?: string;
  grading_note?: string;
  evidence?: Evidence;
  fixes?: RenderedFix[];
};

export type RenderedCategory = {
  category_code: string;
  score: number | null;
  est_annual_uplift_usd?: number | null;
  label?: string;
  summary?: string;
  grading_note?: string;
  findings: RenderedFinding[];
};

export type RenderedStage = {
  stage_code: string;
  stage_name: string;
  score: number | null;
  est_annual_uplift_usd?: number | null;
  categories: RenderedCategory[];
};

export type RenderedReport = {
  profile: string;
  overall: number | null;
  stages: RenderedStage[];
  categories: RenderedCategory[];
};

/** Fixes keyed by diagnostic_check_id, loaded from fix_recommendation. */
export type FixesByCheckId = Map<number, RenderedFix[]>;

/** Category uplift values keyed by category_code. */
export type CategoryUpliftByCode = Map<string, number | null>;

// ── Report renderer ──────────────────────────────────────────────────────────

function renderCategory(
  sc: ScoredCategory,
  copy: CopyIndex,
  locale: string,
  fixesByCheckId: FixesByCheckId,
  categoryUpliftByCode: CategoryUpliftByCode,
): RenderedCategory {
  const catCopy = lookupCopy(copy, "category", sc.category.code, locale);
  const uplift = categoryUpliftByCode.get(sc.category.code);

  const findings: RenderedFinding[] = sc.checks.map((cs) => {
    // Check-level copy with fallback to category-level for summary/grading_note.
    const checkCopy = lookupCopy(copy, "check", cs.check.checkCode, locale);

    const finding: RenderedFinding = {
      score: cs.score,
      status: cs.status,
    };

    // label: check-level only (no category fallback — labels are check-specific)
    const label = checkCopy?.label ?? undefined;
    if (label) finding.label = label;

    // summary + grading_note: check-level, fall back to category-level
    const summary = checkCopy?.summary ?? catCopy?.summary ?? undefined;
    if (summary) finding.summary = summary;

    const grading_note = checkCopy?.grading_note ?? catCopy?.grading_note ?? undefined;
    if (grading_note) finding.grading_note = grading_note;

    if (cs.evidence && Object.keys(cs.evidence).length > 0) {
      finding.evidence = cs.evidence;
    }

    const fixes = fixesByCheckId.get(cs.check.diagnosticCheckId);
    if (fixes && fixes.length > 0) finding.fixes = fixes;

    return finding;
  });

  const cat: RenderedCategory = {
    category_code: sc.category.code,
    score: sc.score,
    findings,
  };
  if (uplift !== undefined) cat.est_annual_uplift_usd = uplift;
  if (catCopy?.label) cat.label = catCopy.label;
  if (catCopy?.summary) cat.summary = catCopy.summary;
  if (catCopy?.grading_note) cat.grading_note = catCopy.grading_note;

  return cat;
}

/**
 * Render a structured report from a scored run + copy index.
 *
 * check_codes are never included in the output — the diagnostic_copy rows
 * supply all user-facing text. Missing copy → fields omitted (not null, not
 * the internal code).
 */
export function renderRunReport(
  scored: ScoredRun,
  copy: CopyIndex,
  locale: string,
  opts: {
    profile: string;
    fixesByCheckId?: FixesByCheckId;
    categoryUpliftByCode?: CategoryUpliftByCode;
  },
): RenderedReport {
  const {
    profile,
    fixesByCheckId = new Map(),
    categoryUpliftByCode = new Map(),
  } = opts;

  const stages: RenderedStage[] = scored.stages.map((ss: ScoredStage) => {
    const stageCopy = lookupCopy(copy, "stage", ss.stage.code, locale);

    // Stage uplift: sum of non-null category uplifts within the stage.
    let stageUplift: number | null = null;
    for (const cat of ss.categories) {
      const u = categoryUpliftByCode.get(cat.category.code);
      if (u != null) stageUplift = (stageUplift ?? 0) + u;
    }

    const renderedCats = ss.categories.map((sc) =>
      renderCategory(sc, copy, locale, fixesByCheckId, categoryUpliftByCode),
    );

    const stage: RenderedStage = {
      stage_code: ss.stage.code,
      stage_name: stageCopy?.label ?? ss.stage.name,
      score: ss.score,
      categories: renderedCats,
    };
    if (stageUplift !== null) stage.est_annual_uplift_usd = stageUplift;

    return stage;
  });

  // Flat category list mirrors stage-nested for the API's top-level field.
  const categories = scored.categories.map((sc) =>
    renderCategory(sc, copy, locale, fixesByCheckId, categoryUpliftByCode),
  );

  return { profile, overall: scored.overall, stages, categories };
}
