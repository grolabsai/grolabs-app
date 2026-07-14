import { describe, expect, it } from "vitest";
import {
  gradeLlmsTxtPresent,
  gradeLlmsTxtQuality,
  gradeRobotsAiPolicy,
  gradeFaqSchema,
  gradeAnswerable,
} from "@/lib/diagnostic/v5/scorers/aeo";
import { pdp } from "./pdp-fixture";

describe("aeo.llms_txt.present grader", () => {
  it("passes for non-empty content", () => {
    expect(gradeLlmsTxtPresent("# Shop\nhello").status).toBe("pass");
  });
  it("fails for whitespace-only content", () => {
    const r = gradeLlmsTxtPresent("   \n  ");
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});

describe("aeo.llms_txt.quality grader (graded)", () => {
  it("full credit when headings, links, substance and context are present", () => {
    const body =
      `# About Our Store\n\n` +
      `See our [catalog](https://shop.example/catalog).\n\n` +
      `${"word ".repeat(60)}\n` +
      `We sell great products in every category.`;
    const r = gradeLlmsTxtQuality(body);
    expect(r.score).toBe(100);
    expect(r.status).toBe("pass");
  });
  it("partial credit when only a heading is present", () => {
    const r = gradeLlmsTxtQuality("# Title");
    expect(r.score).toBe(25); // heading only; short, no link, no context word
    expect(r.status).toBe("partial");
  });
  it("zero for empty content", () => {
    const r = gradeLlmsTxtQuality("");
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});

describe("aeo.robots.ai_policy grader (graded)", () => {
  it("full credit for an explicit allow policy", () => {
    const r = gradeRobotsAiPolicy("User-agent: GPTBot\nAllow: /");
    expect(r.score).toBe(100);
    expect(r.status).toBe("pass");
    expect((r.evidence as { ai_bot_policy: string }).ai_bot_policy).toBe("allow");
  });
  it("zero for an explicit block policy", () => {
    const r = gradeRobotsAiPolicy("User-agent: GPTBot\nDisallow: /");
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
  // Unmentioned/absent scores 0 since commit 1589f37: a store that never
  // thought about AI crawlers has done nothing — no neutral credit.
  it("fails when AI bots are unmentioned", () => {
    const r = gradeRobotsAiPolicy("User-agent: *\nDisallow: /cart");
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
  it("fails (score 0) when robots.txt is absent (null)", () => {
    const r = gradeRobotsAiPolicy(null);
    expect(r.score).toBe(0);
    expect((r.evidence as { robots_present: boolean }).robots_present).toBe(false);
  });
});

describe("aeo.faq_schema.present grader", () => {
  it("passes when FAQ schema is present", () => {
    expect(gradeFaqSchema(pdp({ has_faqpage_schema: true })).status).toBe("pass");
  });
  it("fails when FAQ schema is absent", () => {
    const r = gradeFaqSchema(pdp({ has_faqpage_schema: false, has_faq: true }));
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});

describe("aeo.answerable.structure grader (graded)", () => {
  it("full credit with Q&A, FAQ schema, and a long description", () => {
    const r = gradeAnswerable(
      pdp({ has_faq: true, has_faqpage_schema: true, description_word_count: 200 }),
    );
    expect(r.score).toBe(100);
    expect(r.status).toBe("pass");
  });
  it("partial credit from description length alone", () => {
    const r = gradeAnswerable(
      pdp({ has_faq: false, has_faqpage_schema: false, description_word_count: 75 }),
    );
    expect(r.score).toBe(20); // round(75/150*40)
    expect(r.status).toBe("partial");
  });
  it("zero when nothing answerable is present", () => {
    const r = gradeAnswerable(pdp({ description_word_count: 0 }));
    expect(r.score).toBe(0);
    expect(r.status).toBe("fail");
  });
});
