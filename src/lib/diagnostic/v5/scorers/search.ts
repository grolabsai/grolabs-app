/**
 * Internal-search category scorers (category_code = "internal_search").
 *
 * Evidence source: browser probe (Playwright via Browserless).
 * All scorers degrade gracefully to `na` when:
 *   - PROSPECTOS_BROWSER_PROBE_ENABLED is not set, or
 *   - the probe failed to connect / find a search box.
 *
 * Keyword strategy (Option A → B fallback):
 *   The run orchestrator (run.ts) derives the primary search term from the
 *   PDP's product_name (ASE signals). If unavailable it passes an empty
 *   testEntries array and the probe discovers keywords from the homepage.
 */

import { register, notImplemented } from "../registry";
import type { ScoreResult } from "../types";
import type { BrowserProbeResult } from "../../browser-probe";

// ── Shared helpers ────────────────────────────────────────────────────────────

const PASS = (evidence?: ScoreResult["evidence"]): ScoreResult => ({
  score: 100, status: "pass", evidence,
});
const PARTIAL = (score: number, evidence?: ScoreResult["evidence"]): ScoreResult => ({
  score, status: "partial", evidence,
});
const FAIL = (evidence?: ScoreResult["evidence"]): ScoreResult => ({
  score: 0, status: "fail", evidence,
});
const NA = (note: string): ScoreResult => ({ score: null, status: "na", note });

function probeGuard(
  probe: BrowserProbeResult | null | undefined,
): ScoreResult | null {
  if (!probe) return NA("browser_probe_disabled_or_failed");
  if (!probe.search_box_found) return NA("search_box_not_found");
  return null;
}

// ── search.box.present ────────────────────────────────────────────────────────

register("search.box.present", async (_check, ctx) => {
  const probe = ctx.browserProbeResult;
  if (!probe) return NA("browser_probe_disabled_or_failed");
  return probe.search_box_found
    ? PASS({ engine: ctx.searchEngine ?? "unknown" })
    : FAIL({ note: "no_search_input_found" });
});

// ── search.speed.latency ─────────────────────────────────────────────────────

register("search.speed.latency", async (_check, ctx) => {
  const probe = ctx.browserProbeResult;
  const guard = probeGuard(probe);
  if (guard) return guard;
  // Aggregate latency from canonical entry variant results
  const allLatencies = (probe!.entry_results ?? [])
    .flatMap((e) => e.variant_results.filter((v) => v.variant_type === "canonical"))
    .map((v) => v.latency_ms)
    .filter((ms): ms is number => ms !== null);
  if (allLatencies.length === 0) return NA("latency_not_measured");
  const ms = Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);
  if (ms < 300) return PASS({ latency_ms: ms });
  if (ms < 800) return PARTIAL(Math.round(100 - ((ms - 300) / 500) * 50), { latency_ms: ms });
  return FAIL({ latency_ms: ms });
});

// ── search.typo.tolerance ────────────────────────────────────────────────────

register("search.typo.tolerance", async (_check, ctx) => {
  const probe = ctx.browserProbeResult;
  const guard = probeGuard(probe);
  if (guard) return guard;

  // Option A: entry-based progressive typo variants (typo, typo_2, typo_3)
  // seeded from the first word of the PDP product name. We score on DEPTH —
  // how many severity levels the store handles — not just pass/fail.
  // This uses a single word so other query terms can't accidentally save it.
  const entryTypos = (probe!.entry_results ?? []).flatMap((e) =>
    e.variant_results.filter((v) => v.variant_type.startsWith("typo")),
  );
  if (entryTypos.length > 0) {
    // Sort by severity: typo < typo_2 < typo_3
    const sorted = [...entryTypos].sort((a, b) =>
      a.variant_type.localeCompare(b.variant_type),
    );
    // Count how many consecutive levels passed (stop at first failure)
    let depth = 0;
    for (const v of sorted) {
      if (v.confidence >= 60) depth++;
      else break; // stop — if level N fails, deeper levels don't count
    }
    const total = sorted.length;
    // depth/total → score: 3/3=100 (pass), 2/3=70 (partial), 1/3=40 (partial), 0=fail
    const score = total > 0 ? Math.round((depth / total) * 100) : 0;
    const evidence = {
      tested: sorted.map((v) => ({
        query: v.query_text,
        level: v.variant_type,
        found: v.confidence >= 60,
        confidence: v.confidence,
      })),
      depth,
      total,
      product_name: ctx.pdpProductName ?? undefined,
    };
    if (depth === total) return PASS(evidence);
    if (depth > 0)       return PARTIAL(score, evidence);
    return FAIL(evidence);
  }

  // Option B fallback: probe's auto-mutated typo tests (homepage discovery)
  const typos = probe!.typo_tests ?? [];
  if (typos.length === 0) return NA("no_typo_variants_to_test");
  const passed = typos.filter((t) => t.results_returned).length;
  const ratio = passed / typos.length;
  const score = Math.round(ratio * 100);
  const evidence = { typo_tests: typos, passed, total: typos.length };
  if (ratio >= 0.99) return PASS(evidence);
  if (ratio >= 0.5)  return PARTIAL(score, evidence);
  return FAIL(evidence);
});

// ── search.synonym.coverage ──────────────────────────────────────────────────

register("search.synonym.coverage", async (_check, ctx) => {
  const probe = ctx.browserProbeResult;
  const guard = probeGuard(probe);
  if (guard) return guard;
  const synonymTests = probe!.synonym_tests ?? [];
  if (synonymTests.length === 0) return NA("no_synonym_pairs_configured");
  let totalScore = 0;
  const details: { term_a: string; term_b: string; overlap_count: number }[] = [];
  for (const s of synonymTests) {
    const overlap = s.overlap_count ?? 0;
    totalScore += overlap;
    details.push({ term_a: s.term_a, term_b: s.term_b, overlap_count: overlap });
  }
  const score = Math.round(totalScore / synonymTests.length);
  if (score >= 80) return PASS({ synonym_tests: details });
  if (score >= 40) return PARTIAL(score, { synonym_tests: details });
  return FAIL({ synonym_tests: details });
});

// ── search.empty_state ───────────────────────────────────────────────────────

register("search.empty_state", async (_check, ctx) => {
  const probe = ctx.browserProbeResult;
  const guard = probeGuard(probe);
  if (guard) return guard;
  const t = probe!.empty_state_test;
  if (!t) return NA("empty_state_not_tested");
  const evidence = { query: t.query, graceful: t.graceful, has_fallback_content: t.has_fallback_content };
  if (t.graceful && t.has_fallback_content) return PASS(evidence);
  if (t.graceful || t.has_fallback_content) return PARTIAL(50, evidence);
  return FAIL(evidence);
});

// ── search.brand_relevance ───────────────────────────────────────────────────

register("search.brand_relevance", async (_check, ctx) => {
  const probe = ctx.browserProbeResult;
  const guard = probeGuard(probe);
  if (guard) return guard;
  const tests = probe!.brand_tests ?? [];
  if (tests.length === 0) return NA("no_brand_detected_on_homepage");
  const passed = tests.filter((t) => t.brand_in_top_results === true).length;
  const ratio = passed / tests.length;
  const evidence = { brand_tests: tests.map((t) => ({ brand: t.brand, found: t.brand_in_top_results, top_results: t.top_result_names })), passed, total: tests.length };
  if (ratio >= 0.99) return PASS(evidence);
  if (ratio >= 0.5)  return PARTIAL(Math.round(ratio * 100), evidence);
  return FAIL(evidence);
});

// ── Stubs — advanced signals not yet collected by the probe ──────────────────

register("search.autocomplete.present",   notImplemented);
register("search.autocomplete.quality",   notImplemented);
register("search.semantic.present",       notImplemented);
register("search.conversational.present", notImplemented);
register("search.image.present",          notImplemented);
register("search.recent.persistence",     notImplemented);

// Recommendations + facets (separate evidence: category page HTML)
register("reco.home.present",        notImplemented);
register("reco.home.quality",        notImplemented);
register("facet.present",            notImplemented);
register("facet.depth",              notImplemented);
register("nav.category.usability",   notImplemented);
register("nav.tags.present",         notImplemented);
register("nav.breadcrumb.present",   notImplemented);
