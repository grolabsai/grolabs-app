/**
 * AEO category scorers (category_code = "aeo", stage = discovery).
 *
 * Real scorers (Prompt 5). Primary evidence is DB-as-truth (the seed's
 * `diagnostic_check_source`):
 *   - FETCH   : aeo.llms_txt.* , aeo.robots.ai_policy → RRE HTTP fetch (SITE_WIDE)
 *   - ASE_PDP : aeo.faq_schema.present , aeo.answerable.structure → ASE pdp-signals
 *
 * Note the seed maps `aeo.faq_schema.present` to the SITE_WIDE page_type (so the
 * engine gates it on site reachability) but its PRIMARY evidence source is
 * ASE_PDP — so it reads the PDP signals, like answerable.structure. We honor the
 * evidence source, defensively returning `na` if the PDP itself is undiscovered.
 *
 * Grading thresholds live IN THIS FILE for now — TODO(scoring_rubric): move the
 * quality components / policy bands into the DB `scoring_rubric` once authored.
 *
 * Reuses `detectAiBotPolicy` (site-checks.ts) for the robots AI-bot policy.
 */

import { register } from "../registry";
import type { ScoreResult } from "../types";
import type { PdpSignals } from "@/lib/ase";
import { detectAiBotPolicy } from "../../site-checks";
import { pdpSignalsFor, siteFileFor } from "./evidence";

// ── Shared helpers (mirror seo.ts conventions) ───────────────────────────────

const PASS = (evidence?: ScoreResult["evidence"]): ScoreResult => ({
  score: 100,
  status: "pass",
  evidence,
});
const FAIL = (evidence?: ScoreResult["evidence"]): ScoreResult => ({
  score: 0,
  status: "fail",
  evidence,
});
const NA = (note: string): ScoreResult => ({ score: null, status: "na", note });

function graded(score: number, evidence?: ScoreResult["evidence"]): ScoreResult {
  const s = Math.round(score);
  const status = s >= 100 ? "pass" : s <= 0 ? "fail" : "partial";
  return { score: s, status, evidence };
}

// ── Pure graders (exported for unit tests) ───────────────────────────────────

/** aeo.llms_txt.present — a non-empty /llms.txt exists. */
export function gradeLlmsTxtPresent(body: string): ScoreResult {
  const present = body.trim().length > 0;
  const evidence = { byte_length: body.length };
  return present ? PASS(evidence) : FAIL(evidence);
}

/**
 * aeo.llms_txt.quality — graded over four components: markdown headings, links,
 * substance (word count), and store/context signal. (Depends on present.)
 */
export function gradeLlmsTxtQuality(body: string): ScoreResult {
  const headingCount = body.match(/^#{1,6}\s+\S/gm)?.length ?? 0;
  const linkCount = body.match(/\[[^\]]+\]\([^)]+\)/g)?.length ?? 0;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const hasContext =
    /\b(product|catalog|catalogue|shop|store|category|collection|about|sitemap|docs?|documentation|guide|policy)\b/i.test(
      body,
    );

  const score =
    (headingCount >= 1 ? 25 : 0) +
    (linkCount >= 1 ? 30 : 0) +
    (wordCount >= 50 ? 25 : 0) +
    (hasContext ? 20 : 0);

  return graded(score, {
    heading_count: headingCount,
    link_count: linkCount,
    word_count: wordCount,
    has_context: hasContext,
    excerpt: body.slice(0, 300),
  });
}

/**
 * aeo.robots.ai_policy — graded from the AI-bot stance in robots.txt:
 *   explicit allow → 100 (pass); unmentioned / no robots → 50 (partial,
 *   neutral: not blocked but not explicitly welcomed); explicit block → 0 (fail).
 * `body` is null when robots.txt is absent (404) — treated as unmentioned.
 */
export function gradeRobotsAiPolicy(body: string | null): ScoreResult {
  const policy = detectAiBotPolicy(body);
  const score = policy === "allow" ? 100 : policy === "block" ? 0 : 50;
  return graded(score, { ai_bot_policy: policy, robots_present: body !== null });
}

/** aeo.faq_schema.present — FAQPage / Q&A schema present on the PDP. */
export function gradeFaqSchema(signals: PdpSignals): ScoreResult {
  const present = !!signals.has_faqpage_schema;
  const evidence = {
    has_faqpage_schema: !!signals.has_faqpage_schema,
    has_faq: !!signals.has_faq,
    schema_types: signals.all_schema_types ?? [],
  };
  return present ? PASS(evidence) : FAIL(evidence);
}

/** Word count that earns full description credit — TODO(scoring_rubric): to DB. */
export const ANSWERABLE_FULL_DESC_WORDS = 150;

/**
 * aeo.answerable.structure — graded: visible Q&A content (35), FAQ schema (25),
 * and a substantial description (up to 40, scaled to ANSWERABLE_FULL_DESC_WORDS).
 */
export function gradeAnswerable(signals: PdpSignals): ScoreResult {
  const hasFaq = !!signals.has_faq;
  const hasSchema = !!signals.has_faqpage_schema;
  const words = signals.description_word_count ?? 0;
  const descCredit = Math.min(40, Math.round((words / ANSWERABLE_FULL_DESC_WORDS) * 40));

  const score = (hasFaq ? 35 : 0) + (hasSchema ? 25 : 0) + descCredit;
  return graded(score, {
    has_faq: hasFaq,
    has_faqpage_schema: hasSchema,
    description_word_count: words,
    desc_credit: descCredit,
  });
}

// ── Scorer registrations ─────────────────────────────────────────────────────

// llms.txt (FETCH, SITE_WIDE).
register("aeo.llms_txt.present", async (_check, ctx) => {
  const file = await siteFileFor(ctx, "/llms.txt");
  if (file.ok) return gradeLlmsTxtPresent(file.body);
  if (file.status === "missing") return FAIL({ note: file.note });
  return NA(file.note);
});

register("aeo.llms_txt.quality", async (_check, ctx) => {
  const file = await siteFileFor(ctx, "/llms.txt");
  if (file.ok) return gradeLlmsTxtQuality(file.body);
  // Parent (llms_txt.present) gates this in-engine; be defensive anyway.
  if (file.status === "missing") return FAIL({ note: file.note });
  return NA(file.note);
});

// robots.txt AI policy (FETCH, SITE_WIDE).
register("aeo.robots.ai_policy", async (_check, ctx) => {
  const file = await siteFileFor(ctx, "/robots.txt");
  if (file.ok) return gradeRobotsAiPolicy(file.body);
  if (file.status === "missing") return gradeRobotsAiPolicy(null); // no robots → unmentioned
  return NA(file.note);
});

// FAQ schema + answerable content (ASE_PDP, PDP).
register("aeo.faq_schema.present", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (!e.ok) return NA(e.note);
  return gradeFaqSchema(e.signals);
});

register("aeo.answerable.structure", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (!e.ok) return NA(e.note);
  return gradeAnswerable(e.signals);
});
