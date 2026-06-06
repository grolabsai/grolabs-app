import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAtomicChecks } from "@/lib/diagnostic/v5/loader";

/**
 * Unit tests for the v5 atomic-check loader. We mock the supabase client with a
 * tiny chainable builder: `from(table)` returns a thenable that records
 * `.eq()/.in()` filters and resolves to canned data keyed by table name.
 *
 * DB-as-truth: the loader hardcodes no check codes or weights — these tests
 * feed it raw PostgREST-shaped rows and assert the joined `AtomicCheck` shape,
 * the dependency surfacing, and the instance-0 / writer-instance resolution.
 */

type Rows = Record<string, unknown>;

function makeSupabase(opts: {
  profiles: Rows[];
  membership: Rows[];
  profileError?: { message: string };
  membershipError?: { message: string };
  onProfileFilters?: (f: { col: string; val: unknown }[]) => void;
}): SupabaseClient {
  function builder(table: string) {
    const filters: { col: string; val: unknown }[] = [];
    const result =
      table === "diagnostic_profile"
        ? { data: opts.profiles, error: opts.profileError ?? null }
        : { data: opts.membership, error: opts.membershipError ?? null };
    const chain = {
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return chain;
      },
      in(col: string, val: unknown) {
        filters.push({ col, val });
        return chain;
      },
      then(resolve: (v: typeof result) => unknown) {
        if (table === "diagnostic_profile") opts.onProfileFilters?.(filters);
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

/** A single PostgREST-shaped membership row for one check. */
function membershipRow(overrides: {
  checkId: number;
  checkCode: string;
  categoryCode?: string;
  stageCode?: string;
  pageCode?: string;
  metric?: string;
  weight?: number;
  dependsOn?: number | null;
  isDerived?: boolean;
  sources?: { code: string; label: string; primary: boolean }[];
}): Rows {
  return {
    is_enabled: true,
    diagnostic_check: {
      diagnostic_check_id: overrides.checkId,
      check_code: overrides.checkCode,
      weight: overrides.weight ?? 8,
      metric_kind: overrides.metric ?? "binary",
      capability_tier: 1,
      finding_class: "revenue_leak",
      revenue_lever_kind: "traffic",
      depends_on_check_id: overrides.dependsOn ?? null,
      scoring_rubric: null,
      diagnostic_category: {
        category_code: overrides.categoryCode ?? "seo",
        name: "SEO",
        is_derived: overrides.isDerived ?? false,
        weight: 45,
        diagnostic_stage: {
          stage_code: overrides.stageCode ?? "discovery",
          stage_name: "Discovery",
        },
      },
      page_type: {
        page_code: overrides.pageCode ?? "PDP",
        discovery_hint: "the submitted URL",
      },
      diagnostic_check_source: (overrides.sources ?? [
        { code: "ASE_PDP", label: "ASE /tools/pdp-signals", primary: true },
      ]).map((s) => ({
        is_primary: s.primary,
        evidence_source: { source_code: s.code, label: s.label },
      })),
    },
  };
}

describe("loadAtomicChecks", () => {
  it("resolves a profile's checks with joined metadata", async () => {
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [
        membershipRow({
          checkId: 100,
          checkCode: "seo.jsonld.present",
          metric: "binary",
          weight: 8,
          sources: [
            { code: "ASE_PDP", label: "ASE /tools/pdp-signals", primary: true },
            { code: "FETCH", label: "RRE HTTP fetch", primary: false },
          ],
        }),
      ],
    });

    const checks = await loadAtomicChecks(supabase, { instanceId: null });

    expect(checks).toHaveLength(1);
    const c = checks[0];
    expect(c.checkCode).toBe("seo.jsonld.present");
    expect(c.diagnosticCheckId).toBe(100);
    expect(c.metricKind).toBe("binary");
    expect(c.weight).toBe(8);
    expect(c.capabilityTier).toBe(1);
    expect(c.findingClass).toBe("revenue_leak");
    expect(c.revenueLever).toBe("traffic");
    expect(c.category).toMatchObject({
      code: "seo",
      name: "SEO",
      isDerived: false,
      weight: 45,
      stage: { code: "discovery", name: "Discovery" },
    });
    expect(c.pageType).toEqual({
      code: "PDP",
      discoveryHint: "the submitted URL",
    });
    expect(c.evidenceSources).toEqual([
      { code: "ASE_PDP", label: "ASE /tools/pdp-signals", isPrimary: true },
      { code: "FETCH", label: "RRE HTTP fetch", isPrimary: false },
    ]);
  });

  it("surfaces depends_on as both id and resolved code within the set", async () => {
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [
        membershipRow({ checkId: 100, checkCode: "seo.jsonld.present" }),
        membershipRow({
          checkId: 101,
          checkCode: "seo.jsonld.required_complete",
          metric: "graded",
          dependsOn: 100,
        }),
      ],
    });

    const checks = await loadAtomicChecks(supabase, { instanceId: 0 });
    const parent = checks.find((c) => c.checkCode === "seo.jsonld.present")!;
    const child = checks.find(
      (c) => c.checkCode === "seo.jsonld.required_complete",
    )!;

    expect(parent.dependsOnCheckId).toBeNull();
    expect(parent.dependsOnCheckCode).toBeNull();
    expect(child.dependsOnCheckId).toBe(100);
    expect(child.dependsOnCheckCode).toBe("seo.jsonld.present");
  });

  it("leaves dependsOnCheckCode null when the parent is outside the set", async () => {
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [
        membershipRow({
          checkId: 101,
          checkCode: "seo.jsonld.required_complete",
          dependsOn: 999, // not loaded
        }),
      ],
    });

    const [child] = await loadAtomicChecks(supabase, { instanceId: 0 });
    expect(child.dependsOnCheckId).toBe(999);
    expect(child.dependsOnCheckCode).toBeNull();
  });

  it("surfaces a derived category (returns_risk)", async () => {
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [
        membershipRow({
          checkId: 200,
          checkCode: "pdp.attributes.completeness",
          categoryCode: "returns_risk",
          stageCode: "returns",
          isDerived: true,
        }),
      ],
    });
    const [c] = await loadAtomicChecks(supabase, { instanceId: 0 });
    expect(c.category.isDerived).toBe(true);
    expect(c.category.code).toBe("returns_risk");
  });

  it("scopes anonymous runs to instance 0 only", async () => {
    let seenFilters: { col: string; val: unknown }[] = [];
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [],
      onProfileFilters: (f) => {
        seenFilters = f;
      },
    });
    await loadAtomicChecks(supabase, { instanceId: null });
    const inFilter = seenFilters.find((f) => f.col === "instance_id");
    expect(inFilter?.val).toEqual([0]);
  });

  it("scopes authenticated runs to [0, instanceId]", async () => {
    let seenFilters: { col: string; val: unknown }[] = [];
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [],
      onProfileFilters: (f) => {
        seenFilters = f;
      },
    });
    await loadAtomicChecks(supabase, { instanceId: 42 });
    const inFilter = seenFilters.find((f) => f.col === "instance_id");
    expect(inFilter?.val).toEqual([0, 42]);
  });

  it("prefers the writer's instance profile over instance 0", async () => {
    const supabase = makeSupabase({
      profiles: [
        { diagnostic_profile_id: 1, instance_id: 0 },
        { diagnostic_profile_id: 2, instance_id: 42 },
      ],
      membership: [],
    });
    // No assertion on which membership is loaded (both empty); the test proves
    // resolution does not throw and picks instance 42's profile. We re-run with
    // a spy on the membership filter to confirm the chosen profile id.
    let chosenProfileId: unknown;
    const spy = {
      from(table: string) {
        const filters: { col: string; val: unknown }[] = [];
        const result =
          table === "diagnostic_profile"
            ? {
                data: [
                  { diagnostic_profile_id: 1, instance_id: 0 },
                  { diagnostic_profile_id: 2, instance_id: 42 },
                ],
                error: null,
              }
            : { data: [], error: null };
        const chain = {
          select: () => chain,
          eq(col: string, val: unknown) {
            if (table === "diagnostic_profile_check" && col === "diagnostic_profile_id")
              chosenProfileId = val;
            filters.push({ col, val });
            return chain;
          },
          in: () => chain,
          then: (r: (v: typeof result) => unknown) => Promise.resolve(result).then(r),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    await loadAtomicChecks(spy, { instanceId: 42 });
    expect(chosenProfileId).toBe(2);
    // sanity: original supabase also resolves without throwing
    await expect(
      loadAtomicChecks(supabase, { instanceId: 42 }),
    ).resolves.toEqual([]);
  });

  it("throws when no profile matches", async () => {
    const supabase = makeSupabase({ profiles: [], membership: [] });
    await expect(
      loadAtomicChecks(supabase, { instanceId: 0 }),
    ).rejects.toThrow(/no profile/);
  });

  it("throws when the profile lookup errors", async () => {
    const supabase = makeSupabase({
      profiles: [],
      membership: [],
      profileError: { message: "boom" },
    });
    await expect(
      loadAtomicChecks(supabase, { instanceId: 0 }),
    ).rejects.toThrow(/boom/);
  });

  it("drops rows with a missing required join", async () => {
    const good = membershipRow({ checkId: 100, checkCode: "seo.jsonld.present" });
    const badNoPage = membershipRow({
      checkId: 101,
      checkCode: "seo.canonical.present",
    });
    // strip the page_type join from the bad row
    (badNoPage.diagnostic_check as Record<string, unknown>).page_type = null;
    const supabase = makeSupabase({
      profiles: [{ diagnostic_profile_id: 7, instance_id: 0 }],
      membership: [good, badNoPage],
    });
    const checks = await loadAtomicChecks(supabase, { instanceId: 0 });
    expect(checks.map((c) => c.checkCode)).toEqual(["seo.jsonld.present"]);
  });
});
