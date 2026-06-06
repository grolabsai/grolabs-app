/**
 * AEO category scorers (category_code = "aeo", stage = discovery).
 *
 * TODO(Prompt 5): replace each `notImplemented` stub with a real scorer.
 * Primary evidence: FETCH (llms.txt, robots.txt) + ASE_PDP (FAQ/answer schema).
 */

import { notImplemented, register } from "../registry";

register("aeo.llms_txt.present", notImplemented);
register("aeo.llms_txt.quality", notImplemented);
register("aeo.robots.ai_policy", notImplemented);
register("aeo.faq_schema.present", notImplemented);
register("aeo.answerable.structure", notImplemented);
