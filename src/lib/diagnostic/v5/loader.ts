/**
 * Prospectos v5 — atomic check loader.
 *
 * Resolves a diagnostic *profile* (e.g. `anonymous_landing_audit`) into the
 * full set of `AtomicCheck`s it enables, with every join the engine needs:
 * category + stage, page type, evidence sources, and the dependency edge.
 *
 * DB-as-truth (CLAUDE.md §5): the set of checks, their weights, and their
 * dependencies come ENTIRELY from the database. Nothing here hardcodes the 55
 * check codes or any weight — the registry (registry.ts) maps codes to scorers,
 * but the *rubric* is loaded, never embedded.
 *
 * BRIDGE: v5 checks are seeded `is_active = false` so the live legacy runner
 * (which selects `WHERE is_active = true`) ignores them. We therefore select by
 * profile membership (`diagnostic_profile_check`), NOT by `is_active`.
 *
 * Multi-tenancy (CLAUDE.md §2): instance 0 is the canonical GroLabs rubric and
 * is a REAL, queryable id — never treat it as falsy. `instanceId` may be null
 * (anonymous landing run); strict null checks throughout. The writer's instance
 * wins over instance 0 when both define the same profile (prompt_template
 * fallthrough). RLS + instance-0 read policies handle authorization; for
 * service-role (anonymous) callers we scope explicitly so we never read another
 * instance's profile.
 *
 * This module does NOT order, zero, or score — that is Prompt 3.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AtomicCheck,
  AtomicEvidenceSource,
  FindingClass,
  MetricKind,
  RevenueLever,
} from "./types";

export const DEFAULT_PROFILE_CODE = "anonymous_landing_audit";

export type LoadAtomicChecksOptions = {
  /** Profile to resolve. Defaults to the anonymous landing audit. */
  profileCode?: string;
  /**
   * Resolved instance for the run. `null` = anonymous → instance-0 rubric only.
   * `0` is the real template instance, not "no instance".
   */
  instanceId: number | null;
};

// PostgREST embed: profile_check → check → (category → stage, page_type,
// check_source → evidence_source). Every relationship is a declared FK, so
// PostgREST resolves these automatically. `depends_on_check_id` is selected as
// a plain column; we resolve its code in JS against the loaded set (no self-ref
// embed needed, and it keeps the parent visible even across profiles).
const CHECK_EMBED = `
  is_enabled,
  diagnostic_check:diagnostic_check_id (
    diagnostic_check_id,
    check_code,
    weight,
    metric_kind,
    capability_tier,
    finding_class,
    revenue_lever_kind,
    depends_on_check_id,
    scoring_rubric,
    diagnostic_category:diagnostic_category_id (
      category_code,
      name,
      is_derived,
      weight,
      diagnostic_stage:diagnostic_stage_id (
        stage_code,
        stage_name
      )
    ),
    page_type:page_type_id (
      page_code,
      discovery_hint
    ),
    diagnostic_check_source (
      is_primary,
      evidence_source:evidence_source_id (
        source_code,
        label
      )
    )
  )
` as const;

/** PostgREST may return a to-one embed as an object or a single-element array. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a profile's enabled checks into fully-joined `AtomicCheck`s.
 *
 * @throws if the profile cannot be found or the checks query errors — callers
 *   (the future engine) decide how to surface that.
 */
export async function loadAtomicChecks(
  supabase: SupabaseClient,
  { profileCode = DEFAULT_PROFILE_CODE, instanceId }: LoadAtomicChecksOptions,
): Promise<AtomicCheck[]> {
  // instance 0 is a real id; null = anonymous. Scope explicitly so a
  // service-role caller never resolves another instance's profile.
  const instanceScope =
    instanceId === null || instanceId === 0 ? [0] : [0, instanceId];

  // 1. Resolve the profile. Writer's instance wins over instance 0.
  const { data: profiles, error: profileErr } = await supabase
    .from("diagnostic_profile")
    .select("diagnostic_profile_id, instance_id")
    .eq("profile_code", profileCode)
    .in("instance_id", instanceScope);

  if (profileErr) {
    throw new Error(
      `loadAtomicChecks: profile lookup failed for "${profileCode}": ${profileErr.message}`,
    );
  }
  const rows = (profiles ?? []) as {
    diagnostic_profile_id: number;
    instance_id: number;
  }[];
  const profile =
    rows.find((p) => p.instance_id === instanceId) ??
    rows.find((p) => p.instance_id === 0);
  if (!profile) {
    throw new Error(
      `loadAtomicChecks: no profile "${profileCode}" for instance ${instanceId ?? "anonymous"}`,
    );
  }

  // 2. Load enabled checks with all joins.
  const { data: membership, error: checksErr } = await supabase
    .from("diagnostic_profile_check")
    .select(CHECK_EMBED)
    .eq("diagnostic_profile_id", profile.diagnostic_profile_id)
    .eq("is_enabled", true);

  if (checksErr) {
    throw new Error(
      `loadAtomicChecks: checks query failed: ${checksErr.message}`,
    );
  }

  // 3. Map raw rows → AtomicCheck (drop any with a missing/malformed join).
  const checks: AtomicCheck[] = [];
  for (const m of (membership ?? []) as unknown[]) {
    const check = one((m as { diagnostic_check?: unknown }).diagnostic_check) as
      | RawCheck
      | null;
    if (!check) continue;

    const category = one(check.diagnostic_category);
    const stage = category ? one(category.diagnostic_stage) : null;
    const pageType = one(check.page_type);
    if (!category || !stage || !pageType) continue;

    const checkId = toNumber(check.diagnostic_check_id);
    if (checkId === null || typeof check.check_code !== "string") continue;

    const sources: AtomicEvidenceSource[] = [];
    for (const s of asArray(check.diagnostic_check_source)) {
      const es = one(s.evidence_source);
      if (!es || typeof es.source_code !== "string") continue;
      sources.push({
        code: es.source_code,
        label: typeof es.label === "string" ? es.label : es.source_code,
        isPrimary: s.is_primary === true,
      });
    }

    checks.push({
      checkCode: check.check_code,
      diagnosticCheckId: checkId,
      category: {
        code: String(category.category_code),
        name: String(category.name),
        stage: {
          code: String(stage.stage_code),
          name: String(stage.stage_name),
        },
        isDerived: category.is_derived === true,
        weight: toNumber(category.weight) ?? 0,
      },
      pageType: {
        code: String(pageType.page_code),
        discoveryHint:
          typeof pageType.discovery_hint === "string"
            ? pageType.discovery_hint
            : null,
      },
      metricKind: (check.metric_kind ?? "binary") as MetricKind,
      weight: toNumber(check.weight) ?? 0,
      capabilityTier: toNumber(check.capability_tier),
      findingClass: (check.finding_class ?? null) as FindingClass | null,
      revenueLever: (check.revenue_lever_kind ?? null) as RevenueLever | null,
      dependsOnCheckId: toNumber(check.depends_on_check_id),
      dependsOnCheckCode: null, // resolved below against the loaded set
      scoringRubric:
        (check.scoring_rubric as Record<string, unknown> | null) ?? null,
      evidenceSources: sources,
    });
  }

  // 4. Resolve dependency codes within the loaded set (convenience for the
  // engine; the id remains authoritative if the parent is outside the set).
  const idToCode = new Map<number, string>(
    checks.map((c) => [c.diagnosticCheckId, c.checkCode]),
  );
  for (const c of checks) {
    if (c.dependsOnCheckId !== null) {
      c.dependsOnCheckCode = idToCode.get(c.dependsOnCheckId) ?? null;
    }
  }

  return checks;
}

function asArray<T>(v: T[] | T | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Loosely-typed shapes for the PostgREST embed result.
type RawEvidenceSource = { source_code?: unknown; label?: unknown };
type RawCheckSource = {
  is_primary?: unknown;
  evidence_source?: RawEvidenceSource | RawEvidenceSource[] | null;
};
type RawStage = { stage_code?: unknown; stage_name?: unknown };
type RawCategory = {
  category_code?: unknown;
  name?: unknown;
  is_derived?: unknown;
  weight?: unknown;
  diagnostic_stage?: RawStage | RawStage[] | null;
};
type RawPageType = { page_code?: unknown; discovery_hint?: unknown };
type RawCheck = {
  diagnostic_check_id?: unknown;
  check_code?: unknown;
  weight?: unknown;
  metric_kind?: unknown;
  capability_tier?: unknown;
  finding_class?: unknown;
  revenue_lever_kind?: unknown;
  depends_on_check_id?: unknown;
  scoring_rubric?: unknown;
  diagnostic_category?: RawCategory | RawCategory[] | null;
  page_type?: RawPageType | RawPageType[] | null;
  diagnostic_check_source?: RawCheckSource[] | RawCheckSource | null;
};
