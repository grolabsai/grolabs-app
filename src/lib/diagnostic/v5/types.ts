/**
 * Prospectos v5 — atomic-rubric types.
 *
 * BRIDGE mode (additive): this module runs in parallel to the legacy
 * `src/lib/diagnostic/runner.ts` + `scorers.ts` path and shares nothing with
 * it. The v5 rubric is defined entirely in the database (the atomic-rubric
 * tables seeded at instance 0 — see migrations 20260605000005/000006); these
 * types describe the *resolved* shape the loader produces from those tables
 * and the contract a per-check scorer must satisfy.
 *
 * Nothing here scores, orders, navigates, or probes — that is Prompts 3–6.
 * This file is the plumbing the loader (loader.ts) and the scorer registry
 * (registry.ts) agree on.
 *
 * DB-as-truth: every value on `AtomicCheck` comes from a row, never from a
 * hardcoded constant. `check_code` is internal measurement plumbing and must
 * never reach report copy — user-facing text lives in `diagnostic_copy`.
 */

/** `diagnostic_check.metric_kind` — how the raw measurement maps to a score. */
export type MetricKind = "binary" | "graded" | "derived";

/** `finding_class` enum — orthogonal to severity (the 3-class taxonomy). */
export type FindingClass = "revenue_leak" | "ux_issue" | "value_prop";

/** `revenue_lever` enum — which lever a finding moves. */
export type RevenueLever = "traffic" | "conversion" | "aov" | "returns";

/**
 * Outcome of scoring one check. Aligns with the `finding_status` enum, which
 * gained `'blocked'` in migration 20260605000005 (dependency-gated zero: a
 * prerequisite was unmet, so the dependent is scored 0 — fix the prereq
 * first). `'na'` means "not applicable / not measured" (no scorer, or the
 * page the check lives on was never discovered).
 */
export type ResultStatus = "pass" | "partial" | "fail" | "blocked" | "na";

/** Arbitrary structured evidence captured by a scorer for the report/debug. */
export type Evidence = Record<string, unknown>;

/** Result of running a scorer against a check + run context. */
export type ScoreResult = {
  /** 0–100, or null when the check was not scored (na / error). */
  score: number | null;
  status: ResultStatus;
  evidence?: Evidence;
  note?: string;
};

/** The stage a category rolls up into (`diagnostic_stage`). */
export type AtomicStage = {
  code: string;
  name: string;
};

/**
 * The scored layer under a stage (`diagnostic_category`). `isDerived` flags a
 * category whose score is computed from *other* checks' findings (returns_risk)
 * rather than from its own checks — Prompt 3's engine reads this to know it must
 * roll the category up from `diagnostic_category_contribution`, not from
 * member checks.
 */
export type AtomicCategory = {
  code: string;
  name: string;
  stage: AtomicStage;
  /** returns_risk: score derived from other checks' findings. */
  isDerived: boolean;
  /** Category share of its stage (numeric weight from the DB). */
  weight: number;
};

/** The page a check is measured on (`page_type`). */
export type AtomicPageType = {
  code: string;
  /** How the navigator (Prompt 4) locates this page from the entry PDP. */
  discoveryHint: string | null;
};

/** One evidence source a check draws on (`diagnostic_check_source`). */
export type AtomicEvidenceSource = {
  code: string;
  label: string;
  isPrimary: boolean;
};

/**
 * A fully-resolved atomic check — one `diagnostic_check` row joined to its
 * category, stage, page type, evidence sources, and dependency. This is the
 * unit the engine orders and the registry scores.
 */
export type AtomicCheck = {
  checkCode: string;
  diagnosticCheckId: number;
  category: AtomicCategory;
  pageType: AtomicPageType;
  metricKind: MetricKind;
  /** This check's own weight within its category. */
  weight: number;
  capabilityTier: number | null;
  findingClass: FindingClass | null;
  revenueLever: RevenueLever | null;
  /**
   * `depends_on_check_id`: a prerequisite check. If the prerequisite fails,
   * Prompt 3's engine scores this dependent as `'blocked'` (0). Null = no
   * dependency. The id is authoritative; `dependsOnCheckCode` is a convenience
   * resolved against the same loaded set (null if the parent is not in it).
   */
  dependsOnCheckId: number | null;
  dependsOnCheckCode: string | null;
  /**
   * `scoring_rubric` JSONB (credit components). Currently unseeded (null) and
   * unused here — real scorers in Prompts 4–5 will consume it.
   */
  scoringRubric: Record<string, unknown> | null;
  evidenceSources: AtomicEvidenceSource[];
};

/**
 * Run context handed to every scorer. Intentionally minimal for now — Prompt 4
 * (navigation/discovery) and Prompt 5 (real probing) will populate `pages`
 * with per-page evidence. Stub scorers ignore it entirely. The shape of probe
 * evidence is deliberately left open (`unknown`) so later prompts can refine it
 * without breaking this contract.
 */
export type V5RunContext = {
  /** The submitted entry URL (PDP-first navigation starts here). */
  readonly url: string;
  /** Resolved instance for the run; null = anonymous (instance-0 rubric). */
  readonly instanceId: number | null;
  /** Per-page probe evidence keyed by `page_type.code`. Empty until Prompt 4. */
  readonly pages?: Readonly<Record<string, unknown>>;
};

/** A per-check scorer: measures one check against the run context. */
export type Scorer = (
  check: AtomicCheck,
  ctx: V5RunContext,
) => Promise<ScoreResult>;
