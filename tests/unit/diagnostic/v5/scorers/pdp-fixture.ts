/**
 * Minimal `PdpSignals` builder for the seo/aeo grader + scorer tests. NOT a
 * `.test.ts` file, so the unit glob ignores it.
 */
import type { PdpSignals } from "@/lib/ase";

export function pdp(over: Partial<PdpSignals> = {}): PdpSignals {
  return {
    url: "https://shop.example/products/cool-shoe",
    page_title: "",
    meta_description: "",
    canonical_url: "",
    product_name: null,
    has_jsonld: false,
    has_product_schema: false,
    product_schema_fields: [],
    has_faqpage_schema: false,
    has_breadcrumb_schema: false,
    opengraph: {},
    has_opengraph: false,
    image_count: 0,
    descriptive_alt_count: 0,
    has_faq: false,
    description_text: "",
    description_word_count: 0,
    all_schema_types: [],
    ...over,
  };
}
