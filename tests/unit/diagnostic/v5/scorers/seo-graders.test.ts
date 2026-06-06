import { describe, expect, it } from "vitest";
import {
  gradeJsonldPresent,
  gradeJsonldRequiredComplete,
  gradeJsonldBonus,
  gradeCanonical,
  parseOgTags,
  gradeOgTag,
  gradeSitemapValid,
} from "@/lib/diagnostic/v5/scorers/seo";
import { pdp } from "./pdp-fixture";

describe("seo.jsonld.present grader", () => {
  it("passes (100) when Product schema is present", () => {
    const r = gradeJsonldPresent(pdp({ has_jsonld: true, has_product_schema: true }));
    expect(r.score).toBe(100);
    expect(r.status).toBe("pass");
  });
  it("fails (0) when Product schema is absent", () => {
    const r = gradeJsonldPresent(pdp({ has_jsonld: true, has_product_schema: false }));
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});

describe("seo.jsonld.required_complete grader (graded)", () => {
  it("gives full credit when every required field is present", () => {
    const r = gradeJsonldRequiredComplete(
      pdp({ product_schema_fields: ["name", "image", "offers", "description", "brand"] }),
    );
    expect(r.score).toBe(100);
    expect(r.status).toBe("pass");
  });
  it("gives partial credit for a subset", () => {
    const r = gradeJsonldRequiredComplete(pdp({ product_schema_fields: ["name", "image"] }));
    expect(r.score).toBe(50); // 2 of 4 required
    expect(r.status).toBe("partial");
    expect((r.evidence as { missing: string[] }).missing).toEqual(["offers", "description"]);
  });
  it("fails when none of the required fields are present", () => {
    const r = gradeJsonldRequiredComplete(pdp({ product_schema_fields: ["color"] }));
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});

describe("seo.jsonld.bonus grader (graded)", () => {
  it("partial credit for some bonus fields", () => {
    const r = gradeJsonldBonus(pdp({ product_schema_fields: ["brand", "sku", "aggregateRating"] }));
    expect(r.score).toBe(50); // 3 of 6
    expect(r.status).toBe("partial");
  });
  it("zero when no bonus fields", () => {
    const r = gradeJsonldBonus(pdp({ product_schema_fields: ["name"] }));
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
  it("matches prefixed variants like gtin13", () => {
    const r = gradeJsonldBonus(pdp({ product_schema_fields: ["gtin13"] }));
    expect((r.evidence as { present: string[] }).present).toContain("gtin");
  });
});

describe("seo.canonical.present grader", () => {
  it("passes when a canonical URL is declared", () => {
    const r = gradeCanonical(pdp({ canonical_url: "https://shop.example/p/1" }));
    expect(r.status).toBe("pass");
  });
  it("fails when canonical is blank", () => {
    const r = gradeCanonical(pdp({ canonical_url: "   " }));
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});

describe("OpenGraph parsing + grading", () => {
  it("parses og tags regardless of attribute order and name/property", () => {
    const html =
      `<meta property="og:title" content="Cool Shoe">` +
      `<meta content="A great shoe" property="og:description">` +
      `<meta name="og:image" content="https://img/x.jpg"/>`;
    const tags = parseOgTags(html);
    expect(tags["og:title"]).toBe("Cool Shoe");
    expect(tags["og:description"]).toBe("A great shoe");
    expect(tags["og:image"]).toBe("https://img/x.jpg");
  });
  it("passes a present og tag and fails an absent one", () => {
    const html = `<meta property="og:title" content="Cool Shoe">`;
    expect(gradeOgTag(html, "og:title").status).toBe("pass");
    expect(gradeOgTag(html, "og:image").status).toBe("fail");
    expect(gradeOgTag(html, "og:image").score).toBe(0);
  });
  it("treats an empty content tag as absent", () => {
    const html = `<meta property="og:title" content="">`;
    expect(gradeOgTag(html, "og:title").status).toBe("fail");
  });
});

describe("seo.sitemap.valid grader (graded)", () => {
  const NOW = Date.parse("2026-06-06T00:00:00Z");

  it("full credit for a well-formed sitemap with a fresh lastmod", () => {
    const body =
      `<?xml version="1.0"?><urlset><url><loc>https://shop.example/a</loc>` +
      `<lastmod>2026-06-01</lastmod></url></urlset>`;
    const r = gradeSitemapValid(body, NOW);
    expect(r.score).toBe(100);
    expect(r.status).toBe("pass");
  });
  it("partial credit when entries exist but no lastmod", () => {
    const body = `<urlset><url><loc>https://shop.example/a</loc></url></urlset>`;
    const r = gradeSitemapValid(body, NOW);
    expect(r.score).toBe(70); // 40 well-formed + 30 entries, no freshness
    expect(r.status).toBe("partial");
  });
  it("partial credit when lastmod is stale (outside the window)", () => {
    const body =
      `<urlset><url><loc>x</loc><lastmod>2023-01-01</lastmod></url></urlset>`;
    const r = gradeSitemapValid(body, NOW);
    expect(r.score).toBe(70);
    expect((r.evidence as { fresh: boolean }).fresh).toBe(false);
  });
  it("fails for non-XML garbage", () => {
    const r = gradeSitemapValid("<html>not a sitemap</html>", NOW);
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});
