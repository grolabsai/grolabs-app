import { describe, expect, it } from "vitest";
import { scoreCheck } from "@/lib/diagnostic/scorers";
import type { RunContext } from "@/lib/diagnostic/types";

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  const base: RunContext = {
    site: {
      rootUrl: "https://example.com",
      llmsTxt: { present: false, status: null, bodyExcerpt: null },
      robotsTxt: {
        present: false,
        status: null,
        bodyExcerpt: null,
        aiBotPolicy: "unmentioned",
      },
      sitemap: { present: false, status: null, urlCount: null },
    },
    pdp: { url: "https://example.com/p", signals: null, fetchError: null },
    siteSignals: { signals: null, fetchError: null },
    browser: { enabled: false, probe: null },
    cwv: { cwv: null },
    vertical: {
      vertical_id: null,
      vertical_code: null,
      locale: "en",
      expectedAttributes: [],
    },
  };
  return { ...base, ...overrides };
}

describe("scoreCheck: discovery.product_jsonld_complete", () => {
  it("returns error when PDP signals are missing", () => {
    const r = scoreCheck("discovery.product_jsonld_complete", makeCtx());
    expect(r.result_status).toBe("error");
  });

  it("fails when no Product schema present", () => {
    const ctx = makeCtx({
      pdp: {
        url: "https://example.com/p",
        fetchError: null,
        signals: pdpSignalsStub({ has_product_schema: false }),
      },
    });
    const r = scoreCheck("discovery.product_jsonld_complete", ctx);
    expect(r.result_status).toBe("fail");
    expect(r.score).toBe(0);
  });

  it("passes when all required + bonus fields present", () => {
    const ctx = makeCtx({
      pdp: {
        url: "https://example.com/p",
        fetchError: null,
        signals: pdpSignalsStub({
          has_product_schema: true,
          product_schema_fields: [
            "name",
            "image",
            "description",
            "brand",
            "offers",
            "sku",
            "gtin",
            "aggregateRating",
          ],
        }),
      },
    });
    const r = scoreCheck("discovery.product_jsonld_complete", ctx);
    expect(r.score).toBe(100);
    expect(r.result_status).toBe("pass");
  });
});

describe("scoreCheck: returns.attribute_completeness", () => {
  it("returns 'na' when no expected attributes seeded for the vertical", () => {
    const ctx = makeCtx({
      pdp: {
        url: "https://example.com/p",
        fetchError: null,
        signals: pdpSignalsStub({}),
      },
    });
    const r = scoreCheck("returns.attribute_completeness", ctx);
    expect(r.result_status).toBe("na");
  });

  it("scores 100 when all expected attributes match keywords on the PDP", () => {
    const ctx = makeCtx({
      pdp: {
        url: "https://example.com/p",
        fetchError: null,
        signals: pdpSignalsStub({
          description_text:
            "Comida para perro adulto talla raza pequeña. Ingredientes naturales. Peso 3 kg. Marca Acme.",
          product_schema_fields: ["name", "brand", "sku", "offers"],
        }),
      },
      vertical: {
        vertical_id: 1,
        vertical_code: "pet_retail",
        locale: "es",
        expectedAttributes: [
          { attribute_code: "weight", label: "Peso", match_keywords: ["kg", "peso"], weight: 1 },
          {
            attribute_code: "ingredients",
            label: "Ingredientes",
            match_keywords: ["ingredientes"],
            weight: 1,
          },
          {
            attribute_code: "life_stage",
            label: "Etapa",
            match_keywords: ["adulto", "puppy"],
            weight: 0.8,
          },
          { attribute_code: "brand", label: "Marca", match_keywords: ["marca"], weight: 0.5 },
        ],
      },
    });
    const r = scoreCheck("returns.attribute_completeness", ctx);
    expect(r.result_status).toBe("pass");
    expect(r.score).toBe(100);
  });

  it("partials when ~half match", () => {
    const ctx = makeCtx({
      pdp: {
        url: "https://example.com/p",
        fetchError: null,
        signals: pdpSignalsStub({
          description_text: "Comida para perro. Peso 3 kg.",
          product_schema_fields: ["name", "offers"],
        }),
      },
      vertical: {
        vertical_id: 1,
        vertical_code: "pet_retail",
        locale: "es",
        expectedAttributes: [
          { attribute_code: "weight", label: "Peso", match_keywords: ["kg", "peso"], weight: 1 },
          {
            attribute_code: "ingredients",
            label: "Ingredientes",
            match_keywords: ["ingredientes"],
            weight: 1,
          },
        ],
      },
    });
    const r = scoreCheck("returns.attribute_completeness", ctx);
    expect(r.result_status).toBe("partial");
    expect(r.score).toBe(50);
  });
});

describe("scoreCheck: discovery.llms_txt", () => {
  it("passes when llms.txt present + AI bots allowed", () => {
    const ctx = makeCtx({
      site: {
        rootUrl: "https://example.com",
        llmsTxt: { present: true, status: 200, bodyExcerpt: "# llms.txt..." },
        robotsTxt: { present: true, status: 200, bodyExcerpt: "User-agent: GPTBot\nAllow: /", aiBotPolicy: "allow" },
        sitemap: { present: false, status: null, urlCount: null },
      },
    });
    const r = scoreCheck("discovery.llms_txt", ctx);
    expect(r.result_status).toBe("pass");
  });

  it("fails when llms.txt missing AND robots blocks AI", () => {
    const ctx = makeCtx({
      site: {
        rootUrl: "https://example.com",
        llmsTxt: { present: false, status: 404, bodyExcerpt: null },
        robotsTxt: { present: true, status: 200, bodyExcerpt: "User-agent: GPTBot\nDisallow: /", aiBotPolicy: "block" },
        sitemap: { present: false, status: null, urlCount: null },
      },
    });
    const r = scoreCheck("discovery.llms_txt", ctx);
    expect(r.result_status).toBe("fail");
  });
});

function pdpSignalsStub(o: Partial<import("@/lib/glpim").PdpSignals>) {
  return {
    url: "https://example.com/p",
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
    ...o,
  };
}
