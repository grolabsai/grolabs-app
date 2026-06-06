import { describe, expect, it } from "vitest";
import {
  loadRunCopy,
  lookupCopy,
  renderRunReport,
  type CopyRow,
} from "@/lib/diagnostic/v5/copy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoredRun } from "@/lib/diagnostic/v5/types";
import { makeCategory, makeCheck, makeStage } from "./fixtures";

// ── Supabase mock ────────────────────────────────────────────────────────────

function makeSupabaseWithCopy(rows: Partial<CopyRow>[]) {
  let capturedLocales: string[] = [];
  return {
    from(table: string) {
      if (table !== "diagnostic_copy") {
        return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      return {
        select() {
          return {
            eq(_col: string, _val: unknown) {
              return {
                in(_col2: string, locales: string[]) {
                  capturedLocales = locales;
                  const filtered = rows.filter(
                    (r) => locales.includes(r.locale ?? "es"),
                  );
                  return Promise.resolve({ data: filtered, error: null });
                },
              };
            },
          };
        },
      };
    },
    getCapturedLocales: () => capturedLocales,
  } as unknown as SupabaseClient & { getCapturedLocales: () => string[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function copyRow(
  scope: CopyRow["scope"],
  ref_code: string,
  locale: string,
  overrides: Partial<CopyRow> = {},
): CopyRow {
  return {
    scope,
    ref_code,
    locale,
    result_band: null,
    label: `${scope}:${ref_code}:${locale}:label`,
    summary: `${scope}:${ref_code}:${locale}:summary`,
    grading_note: `${scope}:${ref_code}:${locale}:grading`,
    ...overrides,
  };
}

function minimalScoredRun(categoryCode: string, checkCode: string): ScoredRun {
  const stage = makeStage("discovery", "Discovery");
  const category = makeCategory({ code: categoryCode, stage, weight: 100 });
  const check = makeCheck({ id: 1, code: checkCode, category, weight: 10 });
  const cs = { check, score: 0, status: "fail" as const };
  const sc = { category, score: 0, isDerived: false, checks: [cs] };
  const ss = { stage, score: 0, categories: [sc] };
  return { checks: [cs], categories: [sc], stages: [ss], overall: 0 };
}

// ── loadRunCopy ──────────────────────────────────────────────────────────────

describe("loadRunCopy", () => {
  it("requests both the primary locale and en when locale is not en", async () => {
    const mock = makeSupabaseWithCopy([]);
    await loadRunCopy(mock as unknown as SupabaseClient, "es");
    expect(mock.getCapturedLocales()).toContain("es");
    expect(mock.getCapturedLocales()).toContain("en");
  });

  it("requests only en when locale is en (no duplication)", async () => {
    const mock = makeSupabaseWithCopy([]);
    await loadRunCopy(mock as unknown as SupabaseClient, "en");
    expect(mock.getCapturedLocales()).toEqual(["en"]);
  });

  it("returns an empty index when the query errors", async () => {
    const bad = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: null, error: { message: "boom" } }),
            }),
          }),
        };
      },
    } as unknown as SupabaseClient;
    const index = await loadRunCopy(bad, "es");
    expect(index.size).toBe(0);
  });
});

// ── lookupCopy — locale fallback ─────────────────────────────────────────────

describe("lookupCopy — locale fallback", () => {
  it("returns es copy when available", async () => {
    const mock = makeSupabaseWithCopy([
      copyRow("category", "seo", "es"),
      copyRow("category", "seo", "en"),
    ]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const row = lookupCopy(index, "category", "seo", "es");
    expect(row?.locale).toBe("es");
    expect(row?.label).toContain(":es:");
  });

  it("falls back to en when the primary locale is absent", async () => {
    const mock = makeSupabaseWithCopy([
      copyRow("category", "seo", "en"),
    ]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const row = lookupCopy(index, "category", "seo", "es");
    expect(row?.locale).toBe("en");
  });

  it("returns undefined when neither locale has copy (never errors)", async () => {
    const mock = makeSupabaseWithCopy([]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const row = lookupCopy(index, "category", "nonexistent", "es");
    expect(row).toBeUndefined();
  });
});

// ── renderRunReport — invariants ─────────────────────────────────────────────

describe("renderRunReport — check_code never in rendered output", () => {
  it("does not include check_code in any finding", async () => {
    const checkCode = "seo.internal.check_code_must_not_appear";
    const mock = makeSupabaseWithCopy([]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", checkCode);

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    const reportStr = JSON.stringify(report);
    expect(reportStr).not.toContain(checkCode);
  });
});

describe("renderRunReport — copy lookup and fallback", () => {
  it("uses category-level copy for summary/grading_note when check-level copy is missing", async () => {
    const mock = makeSupabaseWithCopy([
      copyRow("category", "seo", "es", {
        label: "SEO",
        summary: "cat-summary",
        grading_note: "cat-grading",
      }),
      // No check-level copy row
    ]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.some.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    const finding = report.stages[0].categories[0].findings[0];
    expect(finding.summary).toBe("cat-summary");
    expect(finding.grading_note).toBe("cat-grading");
    // check_code is not in the finding
    expect("check_code" in finding).toBe(false);
    expect(Object.keys(finding)).not.toContain("check_code");
  });

  it("uses check-level copy when available (overrides category fallback)", async () => {
    const mock = makeSupabaseWithCopy([
      copyRow("category", "seo", "es", { label: "SEO", summary: "cat-summary", grading_note: "cat-grading" }),
      copyRow("check", "seo.some.check", "es", { label: "My Check", summary: "check-summary", grading_note: "check-grading" }),
    ]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.some.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    const finding = report.stages[0].categories[0].findings[0];
    expect(finding.label).toBe("My Check");
    expect(finding.summary).toBe("check-summary");
    expect(finding.grading_note).toBe("check-grading");
  });

  it("omits missing copy fields rather than surfacing null or the code", async () => {
    const mock = makeSupabaseWithCopy([]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.some.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    const finding = report.stages[0].categories[0].findings[0];
    expect("label" in finding).toBe(false);
    expect("summary" in finding).toBe(false);
    expect("grading_note" in finding).toBe(false);

    const cat = report.stages[0].categories[0];
    expect("label" in cat).toBe(false);
    expect("summary" in cat).toBe(false);
  });

  it("includes category-level label from copy when present", async () => {
    const mock = makeSupabaseWithCopy([
      copyRow("category", "seo", "es", { label: "SEO Score", summary: "Measures SEO", grading_note: "Full = everything present" }),
    ]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    const cat = report.stages[0].categories[0];
    expect(cat.label).toBe("SEO Score");
    expect(cat.category_code).toBe("seo");
    // category_code present, check_code absent
    expect("check_code" in (report.stages[0].categories[0].findings[0] ?? {})).toBe(false);
  });

  it("uses stage copy label for stage_name when available", async () => {
    const mock = makeSupabaseWithCopy([
      copyRow("stage", "discovery", "es", { label: "Visibilidad" }),
    ]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    expect(report.stages[0].stage_name).toBe("Visibilidad");
  });

  it("falls back to stage.name when no stage copy exists", async () => {
    const mock = makeSupabaseWithCopy([]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    expect(report.stages[0].stage_name).toBe("Discovery");
  });
});

describe("renderRunReport — profile + overall", () => {
  it("includes profile and overall in the rendered output", async () => {
    const mock = makeSupabaseWithCopy([]);
    const index = await loadRunCopy(mock as unknown as SupabaseClient, "es");
    const scored = minimalScoredRun("seo", "seo.check");

    const report = renderRunReport(scored, index, "es", { profile: "anonymous_landing_audit" });

    expect(report.profile).toBe("anonymous_landing_audit");
    expect(report.overall).toBe(0);
  });
});
