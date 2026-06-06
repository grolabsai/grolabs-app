/**
 * SEO category scorers (category_code = "seo", stage = discovery).
 *
 * TODO(Prompt 5): replace each `notImplemented` stub with a real scorer.
 * Primary evidence: ASE_PDP (JSON-LD, canonical) + FETCH (sitemap, OG tags).
 */

import { notImplemented, register } from "../registry";

register("seo.jsonld.present", notImplemented);
register("seo.jsonld.required_complete", notImplemented);
register("seo.jsonld.bonus", notImplemented);
register("seo.sitemap.present", notImplemented);
register("seo.sitemap.valid", notImplemented);
register("seo.og.title", notImplemented);
register("seo.og.description", notImplemented);
register("seo.og.image", notImplemented);
register("seo.canonical.present", notImplemented);
