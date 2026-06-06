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
import { pdpSignalsFor, pdpHtmlFor, siteFileFor } from "./evidence";

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

/**
 * aeo.llms_txt.present — a real /llms.txt exists.
 *
 * WordPress and similar CMSes serve their 404 "page not found" HTML with
 * HTTP 200 (soft 404). We guard against this by requiring the body to look
 * like plain text / markdown, not HTML. An llms.txt should NOT start with
 * `<!DOCTYPE` or `<html` — if it does, it's a CMS 404 page, not the file.
 */
export function gradeLlmsTxtPresent(body: string): ScoreResult {
  const trimmed = body.trim();
  if (trimmed.length === 0) return FAIL({ byte_length: 0, note: "empty_file" });
  // Soft-404 detection: body looks like HTML (CMS 404 page served with HTTP 200)
  if (/^<!doctype\s/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return FAIL({ byte_length: trimmed.length, note: "soft_404_html_response" });
  }
  return PASS({ byte_length: trimmed.length });
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
 *   explicit allow → 100 (pass)
 *   explicit block → 0 (fail)
 *   unmentioned    → 0 (fail) — no AI policy = not optimised for AI discoverability
 *
 * "Unmentioned" used to score 50 (partial / neutral) but that gives false
 * credit to stores that simply haven't thought about AI crawlers. A store
 * that hasn't added an AI policy has done nothing — it should not score above 0.
 * `body` is null when robots.txt is absent — treated as unmentioned (fail).
 */
export function gradeRobotsAiPolicy(body: string | null): ScoreResult {
  const policy = detectAiBotPolicy(body);
  const score = policy === "allow" ? 100 : 0; // block OR unmentioned → 0
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

// FAQ schema + answerable content.
// Primary: ASE pdp-signals. Fallback: parse raw PDP HTML directly (avoids
// false-NA when the ASE is unreachable or the site blocks its User-Agent).

/** Extract FAQ schema presence directly from raw HTML (no ASE needed). */
function gradeFaqSchemaFromHtml(html: string): ScoreResult {
  // FAQPage / QAPage JSON-LD
  const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/i.test(html)
    || /"@type"\s*:\s*"QAPage"/i.test(html);
  // Inline FAQ content heuristic: question/answer markup patterns
  const hasFaqContent = html.includes('itemtype="https://schema.org/Question"')
    || /<(details|summary|div)[^>]*(?:faq|question|accordion)[^>]*>/i.test(html);
  const evidence = {
    has_faqpage_schema: hasFaqSchema,
    has_faq_content: hasFaqContent,
    source: "html_parse",
  };
  return hasFaqSchema ? PASS(evidence) : FAIL(evidence);
}

/** Extract answerable signals from raw HTML when ASE is unavailable. */
function gradeAnswerableFromHtml(html: string): ScoreResult {
  const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/i.test(html);
  const hasFaqContent = html.includes('itemtype="https://schema.org/Question"')
    || /<(details|summary)[^>]*>/i.test(html);
  // Word count heuristic: rough body text length
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const wordCount = bodyText.trim().split(/\s+/).length;
  const descCredit = Math.min(40, Math.round((wordCount / ANSWERABLE_FULL_DESC_WORDS) * 40));
  const score = (hasFaqContent ? 35 : 0) + (hasFaqSchema ? 25 : 0) + descCredit;
  return graded(score, {
    has_faq: hasFaqContent,
    has_faqpage_schema: hasFaqSchema,
    word_count_estimate: wordCount,
    desc_credit: descCredit,
    source: "html_parse",
  });
}

register("aeo.faq_schema.present", async (_check, ctx) => {
  // Try ASE first (richer signals)
  const e = await pdpSignalsFor(ctx);
  if (e.ok) return gradeFaqSchema(e.signals);
  // Fallback: parse PDP HTML directly
  const html = await pdpHtmlFor(ctx);
  if (html.ok) return gradeFaqSchemaFromHtml(html.body);
  return NA(`ase: ${e.note} | html: ${html.note}`);
});

register("aeo.answerable.structure", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (e.ok) return gradeAnswerable(e.signals);
  const html = await pdpHtmlFor(ctx);
  if (html.ok) return gradeAnswerableFromHtml(html.body);
  return NA(`ase: ${e.note} | html: ${html.note}`);
});
