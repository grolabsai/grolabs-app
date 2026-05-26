/**
 * Scorer registry — one function per check_code that we know how to score
 * from the static-HTML signals available in v1.
 *
 * Checks present in the catalog but missing from this registry are written
 * as findings with result_status='na' — the runner still records them so
 * the report shows what was skipped and why.
 *
 * Browser-based checks (typo tolerance, faceting, engine ID, CWV) are
 * intentionally absent; they'll arrive with the Playwright service.
 */

import type { CheckScorer, RunContext } from "./types";

const PRODUCT_REQUIRED_FIELDS = [
  "name",
  "image",
  "description",
  "brand",
  "offers",
] as const;

const PRODUCT_BONUS_FIELDS = ["sku", "gtin", "aggregateRating"] as const;

// ── Discovery ───────────────────────────────────────────────────────────────

const scoreProductJsonld: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return {
      result_status: "error",
      score: null,
      evidence: { fetch_error: pdp.fetchError },
    };
  }
  const s = pdp.signals;
  if (!s.has_product_schema) {
    return {
      result_status: "fail",
      score: 0,
      evidence: {
        has_jsonld: s.has_jsonld,
        all_schema_types: s.all_schema_types,
      },
      notes: "No Product JSON-LD on the PDP.",
    };
  }
  const fields = new Set(s.product_schema_fields.map((f) => f.toLowerCase()));
  const requiredHits = PRODUCT_REQUIRED_FIELDS.filter((f) => fields.has(f)).length;
  const bonusHits = PRODUCT_BONUS_FIELDS.filter((f) => fields.has(f)).length;
  const required = PRODUCT_REQUIRED_FIELDS.length; // 5
  const bonus = PRODUCT_BONUS_FIELDS.length; // 3
  // Required carries 80 of the 100; bonus the remaining 20.
  const score = Math.round(
    (requiredHits / required) * 80 + (bonusHits / bonus) * 20,
  );
  const status =
    score >= 90 ? "pass" : score >= 60 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      product_schema_fields: s.product_schema_fields,
      missing_required: PRODUCT_REQUIRED_FIELDS.filter((f) => !fields.has(f)),
      missing_bonus: PRODUCT_BONUS_FIELDS.filter((f) => !fields.has(f)),
    },
  };
};

const scoreLlmsTxt: CheckScorer = ({ site }) => {
  const present = site.llmsTxt.present;
  const policy = site.robotsTxt.aiBotPolicy;
  let score = 0;
  if (present) score += 60;
  if (policy === "allow") score += 40;
  else if (policy === "unmentioned") score += 10;
  // 'block' adds 0
  let status: "pass" | "fail" | "partial" = "fail";
  if (score >= 90) status = "pass";
  else if (score >= 40) status = "partial";
  return {
    result_status: status,
    score,
    evidence: {
      llms_txt_present: present,
      llms_txt_status: site.llmsTxt.status,
      ai_bot_policy: policy,
    },
  };
};

const scoreSitemapCanonical: CheckScorer = ({ site, pdp }) => {
  const sitemapOk = site.sitemap.present;
  const canonical =
    pdp.signals?.canonical_url && pdp.signals.canonical_url.length > 0;
  let score = 0;
  if (sitemapOk) score += 50;
  if (canonical) score += 50;
  let status: "pass" | "fail" | "partial" = "fail";
  if (score >= 100) status = "pass";
  else if (score >= 50) status = "partial";
  return {
    result_status: status,
    score,
    evidence: {
      sitemap_present: sitemapOk,
      sitemap_url_count: site.sitemap.urlCount,
      pdp_canonical_set: !!canonical,
      pdp_canonical_url: pdp.signals?.canonical_url ?? null,
    },
  };
};

const scoreOgCards: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  const s = pdp.signals;
  const og = s.opengraph;
  const required = ["og:title", "og:description", "og:image"];
  const hits = required.filter((k) => og[k] && og[k].length > 0);
  const score = Math.round((hits.length / required.length) * 100);
  const status =
    hits.length === required.length
      ? "pass"
      : hits.length > 0
        ? "partial"
        : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      og_keys_present: hits,
      og_keys_missing: required.filter((k) => !og[k]),
    },
  };
};

// ── PDP ─────────────────────────────────────────────────────────────────────

const scorePdpImages: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  const s = pdp.signals;
  // Heuristic: count alone isn't enough — alt text quality matters too.
  // 4+ images = base 60; +10 for each 2 descriptive alts, capped at 100.
  const imgScore = s.image_count >= 4 ? 60 : Math.round((s.image_count / 4) * 60);
  const altScore = Math.min(40, Math.floor(s.descriptive_alt_count / 2) * 10);
  const score = Math.min(100, imgScore + altScore);
  const status = score >= 80 ? "pass" : score >= 40 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      image_count: s.image_count,
      descriptive_alt_count: s.descriptive_alt_count,
    },
  };
};

const scorePdpAttributeTable: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  const s = pdp.signals;
  // Proxy signal: rich Product schema fields + word count are our best
  // static-HTML approximation of "structured attributes vs prose". The
  // real test needs DOM inspection for a key/value table; that arrives
  // with the Playwright probe.
  const fields = new Set(s.product_schema_fields.map((f) => f.toLowerCase()));
  const hasAdditional = fields.has("additionalproperty") || fields.has("propertyvalue");
  const richDescription = s.description_word_count >= 60;
  let score = 0;
  if (hasAdditional) score += 70;
  else if (richDescription) score += 30;
  if (fields.has("brand")) score += 10;
  if (fields.has("sku")) score += 10;
  if (fields.has("gtin")) score += 10;
  score = Math.min(100, score);
  const status = score >= 70 ? "pass" : score >= 30 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      has_additionalproperty: hasAdditional,
      description_word_count: s.description_word_count,
      product_schema_fields: s.product_schema_fields,
    },
    notes: hasAdditional
      ? null
      : "Static-HTML heuristic only — confirm with a DOM probe whether attributes appear as a key/value table on the rendered page.",
  };
};

const scorePdpReviews: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  const fields = new Set(
    pdp.signals.product_schema_fields.map((f) => f.toLowerCase()),
  );
  const hasAgg = fields.has("aggregaterating");
  const hasReview = fields.has("review");
  let score = 0;
  if (hasAgg) score += 70;
  if (hasReview) score += 30;
  const status = score >= 70 ? "pass" : score >= 30 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      aggregaterating_in_schema: hasAgg,
      review_in_schema: hasReview,
    },
  };
};

// ── PDP — extended signals (variants, cross-sell, stock/delivery) ──────────

const scorePdpVariantClarity: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  const s = pdp.signals;
  if (s.has_variant_selectors === undefined) {
    // Older GLPIM deploy without the extended-signals field.
    return {
      result_status: "na",
      score: null,
      evidence: { reason: "extended_signals_missing" },
      notes:
        "GLPIM /tools/pdp-signals did not return variant_selector_count — upgrade to the v2 endpoint.",
    };
  }
  const count = s.variant_selector_count ?? 0;
  const swatches = s.variant_swatch_count ?? 0;
  if (count === 0) {
    // No variants present isn't necessarily bad — single-SKU product.
    return {
      result_status: "na",
      score: null,
      evidence: { variant_selector_count: 0 },
      notes: "PDP appears to have no variants; check is not applicable.",
    };
  }
  // Has variants — score on clarity: any swatch = much better than plain selects.
  let score = 50; // baseline: variants exist
  if (swatches > 0) score += 40;
  if (count >= 2) score += 10; // multiple axes
  score = Math.min(100, score);
  const status = score >= 80 ? "pass" : score >= 50 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      variant_selector_count: count,
      variant_swatch_count: swatches,
    },
  };
};

const scorePdpCrossSell: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  if (pdp.signals.has_cross_sell === undefined) {
    return {
      result_status: "na",
      score: null,
      evidence: { reason: "extended_signals_missing" },
    };
  }
  const present = pdp.signals.has_cross_sell;
  return {
    result_status: present ? "pass" : "fail",
    score: present ? 100 : 0,
    evidence: { has_cross_sell: present },
  };
};

const scorePdpStockDelivery: CheckScorer = ({ pdp }) => {
  if (!pdp.signals) {
    return { result_status: "error", score: null, evidence: { fetch_error: pdp.fetchError } };
  }
  if (
    pdp.signals.has_stock_indicator === undefined ||
    pdp.signals.has_delivery_indicator === undefined
  ) {
    return {
      result_status: "na",
      score: null,
      evidence: { reason: "extended_signals_missing" },
    };
  }
  const stock = pdp.signals.has_stock_indicator;
  const delivery = pdp.signals.has_delivery_indicator;
  let score = 0;
  if (stock) score += 60;
  if (delivery) score += 40;
  const status = score >= 100 ? "pass" : score >= 40 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      has_stock_indicator: stock,
      has_delivery_indicator: delivery,
      stock_availability: pdp.signals.stock_availability ?? null,
    },
  };
};

// ── On-site nav — engine ID + faceting (from site-signals) ─────────────────

const scoreSearchEngineId: CheckScorer = ({ siteSignals }) => {
  if (!siteSignals.signals) {
    return {
      result_status: "error",
      score: null,
      evidence: { fetch_error: siteSignals.fetchError },
    };
  }
  const s = siteSignals.signals;
  const engine = s.engine_detected;
  // This check is context — not pass/fail. Record what we found.
  return {
    result_status: engine ? "pass" : "partial",
    score: engine ? 100 : 50,
    evidence: {
      engine_detected: engine,
      platform_detected: s.platform_detected,
      has_search_box: s.has_search_box,
      category_engine_detected: s.category_engine_detected ?? null,
    },
    notes: engine
      ? `Search engine identified as ${engine}.`
      : "No third-party search engine fingerprint detected — likely native platform search.",
  };
};

const scoreFaceting: CheckScorer = ({ siteSignals }) => {
  if (!siteSignals.signals) {
    return {
      result_status: "error",
      score: null,
      evidence: { fetch_error: siteSignals.fetchError },
    };
  }
  const s = siteSignals.signals;
  if (s.facet_count == null) {
    return {
      result_status: "na",
      score: null,
      evidence: { reason: "no_category_url_sampled" },
      notes: "Provide a category URL on the run form to score faceting.",
    };
  }
  const count = s.facet_count;
  const hasCounts = !!s.has_counts;
  // 4+ facets is a healthy listing; 1-3 partial; 0 fail.
  let score = 0;
  if (count >= 4) score = 70;
  else if (count >= 1) score = Math.round((count / 4) * 70);
  if (hasCounts) score += 30;
  score = Math.min(100, score);
  const status = score >= 80 ? "pass" : score >= 30 ? "partial" : "fail";
  return {
    result_status: status,
    score,
    evidence: {
      facet_count: count,
      has_counts: hasCounts,
      facet_labels: s.facet_labels.slice(0, 8),
    },
  };
};

// ── Registry ────────────────────────────────────────────────────────────────

export const SCORERS: Record<string, CheckScorer> = {
  "discovery.product_jsonld_complete": scoreProductJsonld,
  "discovery.llms_txt": scoreLlmsTxt,
  "discovery.sitemap_canonical": scoreSitemapCanonical,
  "discovery.og_cards": scoreOgCards,
  "pdp.image_count_quality": scorePdpImages,
  "pdp.attribute_table": scorePdpAttributeTable,
  "pdp.reviews": scorePdpReviews,
  "pdp.variant_clarity": scorePdpVariantClarity,
  "pdp.cross_sell": scorePdpCrossSell,
  "pdp.stock_delivery": scorePdpStockDelivery,
  "on_site_nav.search_engine_id": scoreSearchEngineId,
  "on_site_nav.faceting": scoreFaceting,
};

export function scoreCheck(
  checkCode: string,
  ctx: RunContext,
): import("./types").ScoringResult {
  const scorer = SCORERS[checkCode];
  if (!scorer) {
    return {
      result_status: "na",
      score: null,
      evidence: { reason: "no_scorer_registered" },
      notes: "No scorer implementation for this check yet.",
    };
  }
  try {
    return scorer(ctx);
  } catch (e) {
    return {
      result_status: "error",
      score: null,
      evidence: { exception: String(e) },
    };
  }
}
