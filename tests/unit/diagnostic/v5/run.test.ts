/**
 * runV5Diagnostic integration test.
 *
 * Mocks supabase (all table interactions), ASE (via discoveryDeps), and fetch
 * (homepage/robots/sitemap probes). Asserts a full run:
 *   - produces run_category_score rows for each category
 *   - produces a finding row per check
 *   - produces a rendered report with category labels from the 3 seeded es copy rows
 */

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runV5Diagnostic } from "@/lib/diagnostic/v5/run";
import type { DiscoveryDeps } from "@/lib/diagnostic/v5/discovery";

// ── Supabase mock builder ────────────────────────────────────────────────────

type TableStore = {
  finding: unknown[];
  run_category_score: unknown[];
  run_sample: unknown[];
  prospect_page: unknown[];
  page_scan: unknown[];
};

function buildMockSupabase({
  profileId = 1,
  runId = "run-v5-test",
  checks = MOCK_CHECKS,
  copyRows = MOCK_COPY_ROWS,
}: {
  profileId?: number;
  runId?: string;
  checks?: typeof MOCK_CHECKS;
  copyRows?: typeof MOCK_COPY_ROWS;
} = {}): { supabase: SupabaseClient; store: TableStore } {
  const store: TableStore = {
    finding: [],
    run_category_score: [],
    run_sample: [],
    prospect_page: [],
    page_scan: [],
  };

  const ctx = { profileId, runId, checks, copyRows };

  const client = {
    from(table: string) {
      return makeBuilder(table, store, ctx);
    },
    rpc() {
      return Promise.resolve({ data: true, error: null });
    },
  } as unknown as SupabaseClient;

  return { supabase: client, store };
}

/**
 * Flexible PostgREST mock. Each `from(table)` returns a builder that:
 * - is thenable (awaiting the chain directly triggers the query)
 * - supports `.maybeSingle()`, `.single()`, `.insert()`, `.upsert()`, `.update()`
 * - routes to a per-table resolver function
 */
function makeBuilder(
  table: string,
  store: TableStore,
  ctx: { profileId: number; runId: string; checks: typeof MOCK_CHECKS; copyRows: typeof MOCK_COPY_ROWS },
) {
  const resolve = (): Promise<{ data: unknown; error: null }> => {
    const t = table;
    const { profileId, checks, copyRows } = ctx;

    if (t === "prospect") return Promise.resolve({ data: null, error: null });

    if (t === "diagnostic_profile") {
      // loadAtomicChecks does .in("instance_id", [...]) — return an array
      return Promise.resolve({
        data: [{ diagnostic_profile_id: profileId, instance_id: 0 }],
        error: null,
      });
    }

    if (t === "diagnostic_profile_check") {
      return Promise.resolve({ data: checks, error: null });
    }

    if (t === "diagnostic_category") {
      return Promise.resolve({
        data: [
          { diagnostic_category_id: 100, category_code: "seo" },
          { diagnostic_category_id: 101, category_code: "aeo" },
        ],
        error: null,
      });
    }

    if (t === "diagnostic_copy") {
      return Promise.resolve({ data: copyRows, error: null });
    }

    if (t === "fix_recommendation") {
      return Promise.resolve({ data: [], error: null });
    }

    return Promise.resolve({ data: null, error: null });
  };

  // The builder is itself a thenable (PostgREST pattern)
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => resolve(),
    single: () => resolve(),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected),
    insert: (rows: unknown | unknown[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      const tableName = table as keyof TableStore;
      if (tableName in store) (store[tableName] as unknown[]).push(...arr);

      if (table === "diagnostic_run") {
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { run_id: ctx.runId }, error: null }),
          }),
        };
      }
      if (table === "prospect") {
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { prospect_id: 42 }, error: null }),
          }),
        };
      }
      return Promise.resolve({ data: arr, error: null });
    },
    upsert: (rows: unknown[]) => {
      const tableName = table as keyof TableStore;
      if (tableName in store) (store[tableName] as unknown[]).push(...rows);
      return Promise.resolve({ data: rows, error: null });
    },
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
  };
  return builder;
}

// ── Mock check data (PostgREST-embedded shape that loadAtomicChecks reads) ───

const MOCK_CHECKS = [
  {
    is_enabled: true,
    diagnostic_check: {
      diagnostic_check_id: 1,
      check_code: "seo.jsonld.present",
      weight: 10,
      metric_kind: "binary",
      capability_tier: 1,
      finding_class: "revenue_leak",
      revenue_lever_kind: "traffic",
      depends_on_check_id: null,
      scoring_rubric: null,
      diagnostic_category: {
        category_code: "seo",
        name: "SEO",
        is_derived: false,
        weight: 50,
        diagnostic_stage: { stage_code: "discovery", stage_name: "Discovery" },
      },
      page_type: { page_code: "PDP", discovery_hint: "entry URL" },
      diagnostic_check_source: [],
    },
  },
  {
    is_enabled: true,
    diagnostic_check: {
      diagnostic_check_id: 2,
      check_code: "aeo.llms_txt.present",
      weight: 8,
      metric_kind: "binary",
      capability_tier: 1,
      finding_class: "ux_issue",
      revenue_lever_kind: "conversion",
      depends_on_check_id: null,
      scoring_rubric: null,
      diagnostic_category: {
        category_code: "aeo",
        name: "AEO",
        is_derived: false,
        weight: 50,
        diagnostic_stage: { stage_code: "discovery", stage_name: "Discovery" },
      },
      page_type: { page_code: "SITE_WIDE", discovery_hint: "site root" },
      diagnostic_check_source: [],
    },
  },
];

// ── 3 seeded es copy rows (matches the prompt's "3 seeded es copy rows") ─────

const MOCK_COPY_ROWS = [
  {
    scope: "category",
    ref_code: "seo",
    locale: "es",
    result_band: null,
    label: "Optimización SEO",
    summary: "Mide la visibilidad orgánica de tu tienda.",
    grading_note: "100 = todos los señales presentes.",
  },
  {
    scope: "category",
    ref_code: "aeo",
    locale: "es",
    result_band: null,
    label: "Optimización AEO",
    summary: "Mide la presencia en resultados de IA.",
    grading_note: "100 = llms.txt + schema completo.",
  },
  {
    scope: "stage",
    ref_code: "discovery",
    locale: "es",
    result_band: null,
    label: "Descubrimiento",
    summary: "Capacidad de ser encontrado.",
    grading_note: null,
  },
];

// ── Discovery deps mock (no real network) ────────────────────────────────────

const MOCK_DISCOVERY_DEPS: Partial<DiscoveryDeps> = {
  fetchImpl: async (_url: URL | RequestInfo) =>
    new Response("<html><body></body></html>", { status: 200 }),
  discoverSamples: async (_rootUrl: string) => ({
    pdpUrl: "https://shop.example/product/1",
    categoryUrl: "https://shop.example/category/hats",
    homepageText: "",
    homepageHints: {},
    categoryReason: "homepage_link",
    pdpReason: "auto",
    logoUrl: null,
    logoSource: null,
  }),
  probeSiteWide: async () => null,
  scanSiteSignals: async () => null,
  browserEngineFingerprint: null,
};

// ── Integration test ─────────────────────────────────────────────────────────

describe("runV5Diagnostic — integration", () => {
  it("produces findings + category scores + rendered report with copy labels", async () => {
    const { supabase, store } = buildMockSupabase();

    const result = await runV5Diagnostic(
      {
        url: "https://shop.example/product/demo",
        instanceId: null,
        locale: "es",
      },
      { supabase, discoveryDeps: MOCK_DISCOVERY_DEPS },
    );

    // Result shape
    if (!("ok" in result)) {
      console.error("runV5Diagnostic returned error:", (result as { error: string }).error);
    }
    expect("ok" in result && result.ok).toBe(true);
    if (!("ok" in result) || !result.ok) return;

    // One finding per check (2 mock checks)
    expect(result.findingsInserted).toBe(2);
    expect(store.finding).toHaveLength(2);

    // Two categories → two run_category_score rows
    expect(result.categoryScoresUpserted).toBe(2);
    expect(store.run_category_score).toHaveLength(2);

    // Rendered report structure
    const { report } = result;
    expect(report.profile).toBe("anonymous_landing_audit");

    // Category labels come from the seeded copy rows
    const seoCategory = report.categories.find((c) => c.category_code === "seo");
    expect(seoCategory?.label).toBe("Optimización SEO");
    expect(seoCategory?.summary).toBe("Mide la visibilidad orgánica de tu tienda.");

    const aeoCategory = report.categories.find((c) => c.category_code === "aeo");
    expect(aeoCategory?.label).toBe("Optimización AEO");

    // Stage name comes from stage copy
    const discoveryStage = report.stages.find((s) => s.stage_code === "discovery");
    expect(discoveryStage?.stage_name).toBe("Descubrimiento");

    // check_codes must NOT appear anywhere in the rendered output
    const reportStr = JSON.stringify(report);
    expect(reportStr).not.toContain("seo.jsonld.present");
    expect(reportStr).not.toContain("aeo.llms_txt.present");
  });

  it("returns an error result (not throwing) when profile cannot be resolved", async () => {
    const store: TableStore = {
      finding: [],
      run_category_score: [],
      run_sample: [],
      prospect_page: [],
      page_scan: [],
    };
    const ctx = { profileId: 1, runId: "run-v5-error", checks: MOCK_CHECKS, copyRows: MOCK_COPY_ROWS };

    // Supabase that returns empty data for diagnostic_profile (profile not found)
    const noProfileSupabase = {
      from(table: string) {
        if (table === "diagnostic_profile") {
          const b: Record<string, unknown> = {
            select: () => b,
            eq: () => b,
            is: () => b,
            in: () => b,
            order: () => b,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              // Returns empty array = no profiles found
              Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
          };
          return b;
        }
        return makeBuilder(table, store, ctx);
      },
    } as unknown as SupabaseClient;

    const result = await runV5Diagnostic(
      { url: "https://shop.example/p/1", instanceId: null },
      { supabase: noProfileSupabase, discoveryDeps: MOCK_DISCOVERY_DEPS },
    );

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Profile not found|no profile/i);
    }
  });

  it("finding rows have instance_id=null for anonymous run", async () => {
    const { supabase, store } = buildMockSupabase();

    const result = await runV5Diagnostic(
      { url: "https://shop.example/p/1", instanceId: null },
      { supabase, discoveryDeps: MOCK_DISCOVERY_DEPS },
    );

    if (!("ok" in result) || !result.ok) return;

    for (const row of store.finding as Record<string, unknown>[]) {
      expect(row.instance_id).toBeNull();
    }
  });
});
