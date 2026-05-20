import { describe, expect, it } from "vitest";

/**
 * Trivial smoke test: keeps `npm test` exiting 0 when no unit tests
 * have been written yet. Real unit tests go in their own files under
 * tests/unit/<feature>/ alongside this one.
 */
describe("smoke", () => {
  it("vitest is wired", () => {
    expect(1 + 1).toBe(2);
  });
});
