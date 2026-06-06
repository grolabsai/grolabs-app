import { describe, expect, it } from "vitest";
import { orderChecksByDependency } from "@/lib/diagnostic/v5/ordering";
import { makeCheck } from "./fixtures";

/**
 * Topological ordering of checks by `depends_on_check_id`. The engine needs a
 * parent scored before its dependents; these tests pin the ordering contract,
 * the cycle guard, and the "prerequisite outside this run" case.
 */
describe("orderChecksByDependency", () => {
  it("places a prerequisite before its dependent regardless of input order", () => {
    // Child (id 2) listed before parent (id 1).
    const checks = [
      makeCheck({ id: 2, code: "seo.jsonld.required_complete", dependsOn: 1 }),
      makeCheck({ id: 1, code: "seo.jsonld.present" }),
    ];
    const ordered = orderChecksByDependency(checks).map((c) => c.checkCode);
    expect(ordered).toEqual([
      "seo.jsonld.present",
      "seo.jsonld.required_complete",
    ]);
  });

  it("orders a multi-level chain root → leaf", () => {
    const checks = [
      makeCheck({ id: 3, code: "search.autocomplete.quality", dependsOn: 2 }),
      makeCheck({ id: 1, code: "search.box.present" }),
      makeCheck({ id: 2, code: "search.autocomplete.present", dependsOn: 1 }),
    ];
    const ordered = orderChecksByDependency(checks).map((c) => c.diagnosticCheckId);
    // 1 before 2 before 3.
    expect(ordered.indexOf(1)).toBeLessThan(ordered.indexOf(2));
    expect(ordered.indexOf(2)).toBeLessThan(ordered.indexOf(3));
  });

  it("preserves input order among independent checks (stable)", () => {
    const checks = [
      makeCheck({ id: 10, code: "a" }),
      makeCheck({ id: 20, code: "b" }),
      makeCheck({ id: 30, code: "c" }),
    ];
    expect(orderChecksByDependency(checks).map((c) => c.checkCode)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("treats a dependency pointing outside the loaded set as a root", () => {
    // Parent id 99 is not in the set → child is a root, no throw.
    const checks = [
      makeCheck({ id: 5, code: "orphan.child", dependsOn: 99 }),
      makeCheck({ id: 6, code: "independent" }),
    ];
    const ordered = orderChecksByDependency(checks).map((c) => c.checkCode);
    expect(ordered).toHaveLength(2);
    expect(ordered).toContain("orphan.child");
    expect(ordered).toContain("independent");
  });

  it("throws on a dependency cycle, naming the cyclic checks", () => {
    const checks = [
      makeCheck({ id: 1, code: "x", dependsOn: 2 }),
      makeCheck({ id: 2, code: "y", dependsOn: 1 }),
    ];
    expect(() => orderChecksByDependency(checks)).toThrow(/cycle/i);
    expect(() => orderChecksByDependency(checks)).toThrow(/x|y/);
  });

  it("returns an empty list for no checks", () => {
    expect(orderChecksByDependency([])).toEqual([]);
  });
});
