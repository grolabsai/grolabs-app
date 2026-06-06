/**
 * PDP scorers — covers both categories on the Decision stage:
 *   - pdp_quality      (images, variants, description, reviews, stock, x/up-sell)
 *   - data_completeness (structured attribute table + expected-attribute coverage)
 *
 * TODO(Prompt 5): replace each `notImplemented` stub with a real scorer.
 * Primary evidence: ASE_PDP (static-HTML signal extraction on the entry PDP).
 */

import { notImplemented, register } from "../registry";

// pdp_quality
register("pdp.images.present", notImplemented);
register("pdp.images.count", notImplemented);
register("pdp.images.alt_quality", notImplemented);
register("pdp.variants.present", notImplemented);
register("pdp.variants.clarity", notImplemented);
register("pdp.description.present", notImplemented);
register("pdp.description.quality", notImplemented);
register("pdp.reviews.present", notImplemented);
register("pdp.stock.clarity", notImplemented);
register("pdp.crosssell.present", notImplemented);
register("pdp.upsell.present", notImplemented);

// data_completeness
register("pdp.attributes.present", notImplemented);
register("pdp.attributes.completeness", notImplemented);
