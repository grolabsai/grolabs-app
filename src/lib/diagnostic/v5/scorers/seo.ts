/**
 * SEO category scorers (category_code = "seo", stage = discovery).
 *
 * Real scorers (Prompt 5). Primary evidence is DB-as-truth (the seed's
 * `diagnostic_check_source`):
 *   - ASE_PDP : seo.jsonld.* , seo.canonical.present  → ASE /tools/pdp-signals
 *   - FETCH   : seo.sitemap.* , seo.og.*              → RRE HTTP fetch (SITE_WIDE)
 *
 * Grading thresholds live IN THIS FILE for now. The per-check `scoring_rubric`
 * JSONB is unseeded (TBD per policy) — TODO(scoring_rubric): move the field
 * lists / freshness window / OG keys into the DB once that column is authored;
 * do NOT invent DB rubric rows here.
 *
 * Every scorer is a thin wrapper: resolve evidence (memoized in ./evidence),
 * then delegate to a pure, exported grader so the grading logic is unit-tested
 * without any IO. Missing page / fetch error / ASE error → `na` (never throws).
 */

import { register } from "../registry";
import type { ScoreResult } from "../types";
import type { PdpSignals } from "@/lib/ase";
import {
  pdpSignalsFor,
  siteFileFor,
  siteHtmlFor,
  type FileEvidence,
} from "./evidence";

// ── Shared helpers ───────────────────────────────────────────────────────────

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

/** Map a graded 0–100 to a status with pass/partial/fail bands. */
function graded(score: number, evidence?: ScoreResult["evidence"]): ScoreResult {
  const s = Math.round(score);
  const status = s >= 100 ? "pass" : s <= 0 ? "fail" : "partial";
  return { score: s, status, evidence };
}

/** Normalize a JSON-LD field name for tolerant matching. */
function normField(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when `token` is present among `fields` (exact or prefix, normalized). */
function hasField(fields: readonly string[], token: string): boolean {
  const t = normField(token);
  return fields.some((f) => {
    const nf = normField(f);
    return nf === t || nf.startsWith(t);
  });
}

/**
 * Presence-from-fetch mapping shared by sitemap.present:
 *   2xx → pass(100); non-2xx (artifact absent) → fail(0); page undiscovered or
 *   network error → na (not measured).
 */
function presenceFromFile(
  file: FileEvidence,
  evidenceExtra?: Record<string, unknown>,
): ScoreResult {
  if (file.ok) return PASS({ url: file.url, http_status: file.httpStatus, ...evidenceExtra });
  if (file.status === "missing") {
    return FAIL({ url: file.url, http_status: file.httpStatus, ...evidenceExtra });
  }
  return NA(file.note);
}

// ── Pure graders (exported for unit tests) ───────────────────────────────────

/** Required top-level Product JSON-LD fields for a complete rich result. */
export const REQUIRED_JSONLD_FIELDS = ["name", "image", "offers", "description"] as const;
/** Bonus fields that strengthen the rich result beyond the required set. */
export const BONUS_JSONLD_FIELDS = [
  "brand",
  "sku",
  "gtin",
  "mpn",
  "aggregateRating",
  "review",
] as const;

/** seo.jsonld.present — Product schema present at all. */
export function gradeJsonldPresent(signals: PdpSignals): ScoreResult {
  const present = !!signals.has_product_schema;
  const evidence = {
    has_jsonld: !!signals.has_jsonld,
    has_product_schema: !!signals.has_product_schema,
    schema_types: signals.all_schema_types ?? [],
  };
  return present ? PASS(evidence) : FAIL(evidence);
}

/** seo.jsonld.required_complete — coverage of the required field set. */
export function gradeJsonldRequiredComplete(signals: PdpSignals): ScoreResult {
  const fields = signals.product_schema_fields ?? [];
  const present = REQUIRED_JSONLD_FIELDS.filter((f) => hasField(fields, f));
  const missing = REQUIRED_JSONLD_FIELDS.filter((f) => !hasField(fields, f));
  const score = (present.length / REQUIRED_JSONLD_FIELDS.length) * 100;
  return graded(score, { present, missing, fields });
}

/** seo.jsonld.bonus — coverage of bonus fields (partial credit, never blocks). */
export function gradeJsonldBonus(signals: PdpSignals): ScoreResult {
  const fields = signals.product_schema_fields ?? [];
  const present = BONUS_JSONLD_FIELDS.filter((f) => hasField(fields, f));
  const score = (present.length / BONUS_JSONLD_FIELDS.length) * 100;
  return graded(score, { present, fields });
}

/** seo.canonical.present — a canonical URL is declared. */
export function gradeCanonical(signals: PdpSignals): ScoreResult {
  const canonical = (signals.canonical_url ?? "").trim();
  const present = canonical.length > 0;
  const evidence = { canonical_url: canonical || null };
  return present ? PASS(evidence) : FAIL(evidence);
}

/**
 * Parse OpenGraph (and Twitter-style `name="og:*"`) meta tags from page HTML,
 * tolerant of attribute order. Returns a lowercased `og:*` → content map.
 */
export function parseOgTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0];
    const key = t.match(/(?:property|name)\s*=\s*["'](og:[^"']+)["']/i)?.[1] ?? null;
    if (!key) continue;
    const content = t.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const k = key.toLowerCase();
    // First non-empty wins (some pages emit a blank placeholder then a real one).
    if (!out[k] || (out[k] === "" && content !== "")) out[k] = content;
  }
  return out;
}

/** seo.og.{title,description,image} — a specific OG tag is present + non-empty. */
export function gradeOgTag(html: string, ogKey: string): ScoreResult {
  const tags = parseOgTags(html);
  const value = (tags[ogKey.toLowerCase()] ?? "").trim();
  const present = value.length > 0;
  const evidence = { og_key: ogKey, value: value || null, found_keys: Object.keys(tags) };
  return present ? PASS(evidence) : FAIL(evidence);
}

/** Freshness window for sitemap `<lastmod>` — TODO(scoring_rubric): to DB. */
export const SITEMAP_FRESH_WINDOW_DAYS = 365;

/**
 * seo.sitemap.valid — graded over three components (well-formed root, has URL
 * entries, has a fresh `<lastmod>`). `now` is injectable for deterministic tests.
 */
export function gradeSitemapValid(body: string, now: number = Date.now()): ScoreResult {
  const wellFormed = /<(?:urlset|sitemapindex)\b/i.test(body);
  const entryCount =
    (body.match(/<loc\b/gi)?.length ?? 0) ||
    (body.match(/<url\b/gi)?.length ?? 0) ||
    (body.match(/<sitemap\b/gi)?.length ?? 0);
  const hasEntries = entryCount > 0;

  // Freshness: newest <lastmod> within the window.
  let newestMs: number | null = null;
  for (const m of body.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/gi)) {
    const ts = Date.parse(m[1]);
    if (!Number.isNaN(ts) && (newestMs === null || ts > newestMs)) newestMs = ts;
  }
  const ageDays = newestMs === null ? null : (now - newestMs) / 86_400_000;
  const fresh = ageDays !== null && ageDays <= SITEMAP_FRESH_WINDOW_DAYS && ageDays >= -1;

  const score = (wellFormed ? 40 : 0) + (hasEntries ? 30 : 0) + (fresh ? 30 : 0);
  return graded(score, {
    well_formed: wellFormed,
    entry_count: entryCount,
    has_lastmod: newestMs !== null,
    newest_lastmod_age_days: ageDays === null ? null : Math.round(ageDays),
    fresh,
  });
}

// ── Scorer registrations ─────────────────────────────────────────────────────

// JSON-LD + canonical (ASE_PDP, PDP).
register("seo.jsonld.present", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (!e.ok) return NA(e.note);
  return gradeJsonldPresent(e.signals);
});

register("seo.jsonld.required_complete", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (!e.ok) return NA(e.note);
  return gradeJsonldRequiredComplete(e.signals);
});

register("seo.jsonld.bonus", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (!e.ok) return NA(e.note);
  return gradeJsonldBonus(e.signals);
});

register("seo.canonical.present", async (_check, ctx) => {
  const e = await pdpSignalsFor(ctx);
  if (!e.ok) return NA(e.note);
  return gradeCanonical(e.signals);
});

// Sitemap (FETCH, SITE_WIDE).
register("seo.sitemap.present", async (_check, ctx) => {
  const file = await siteFileFor(ctx, "/sitemap.xml");
  return presenceFromFile(file);
});

register("seo.sitemap.valid", async (_check, ctx) => {
  const file = await siteFileFor(ctx, "/sitemap.xml");
  if (!file.ok) {
    // Parent (sitemap.present) gates this in-engine; be defensive anyway.
    return file.status === "missing" ? FAIL({ note: file.note }) : NA(file.note);
  }
  return gradeSitemapValid(file.body);
});

// OpenGraph (FETCH, SITE_WIDE page HTML).
function registerOg(checkCode: string, ogKey: string): void {
  register(checkCode, async (_check, ctx) => {
    const html = await siteHtmlFor(ctx);
    if (!html.ok) return NA(html.note); // can't read the page → not measured
    return gradeOgTag(html.body, ogKey);
  });
}
registerOg("seo.og.title", "og:title");
registerOg("seo.og.description", "og:description");
registerOg("seo.og.image", "og:image");
