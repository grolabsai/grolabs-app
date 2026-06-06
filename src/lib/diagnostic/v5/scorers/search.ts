/**
 * Internal-search category scorers (category_code = "internal_search",
 * stage = on_site_nav). Covers the search box, autocomplete, semantic/
 * conversational/image search, recommendations, faceting, and nav.
 *
 * TODO(Prompt 5): replace each `notImplemented` stub with a real scorer.
 * Primary evidence: BROWSER (probe-driven search behavior) + ASE_SITE/ASE_PDP.
 */

import { notImplemented, register } from "../registry";

// Search box + relevance (HOME / SEARCH_RESULTS)
register("search.box.present", notImplemented);
register("search.speed.latency", notImplemented);
register("search.typo.tolerance", notImplemented);
register("search.synonym.coverage", notImplemented);
register("search.autocomplete.present", notImplemented);
register("search.autocomplete.quality", notImplemented);
register("search.semantic.present", notImplemented);
register("search.conversational.present", notImplemented);
register("search.image.present", notImplemented);
register("search.recent.persistence", notImplemented);
register("search.empty_state", notImplemented);
register("search.brand_relevance", notImplemented);

// Recommendations (HOME)
register("reco.home.present", notImplemented);
register("reco.home.quality", notImplemented);

// Faceting + navigation (SEARCH_RESULTS / CATEGORY / PDP)
register("facet.present", notImplemented);
register("facet.depth", notImplemented);
register("nav.category.usability", notImplemented);
register("nav.tags.present", notImplemented);
register("nav.breadcrumb.present", notImplemented);
