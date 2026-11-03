import { describe, it, expect } from "vitest";
import {
  assignIntent,
  classifyReformulation,
  editDistance,
  intentSignature,
  INTENT_WINDOW_MS,
  type RecentQuery,
} from "@/lib/analytics/intent";

/**
 * These assertions are written from the DEFINITIONS
 * (docs/design/conversion-measurement-foundations.md §3), not from the
 * implementation. A failure here means the code and the grammar disagree —
 * which is the state this suite was written to end (see
 * docs/state/event-semantics-trace.md F-1).
 */

describe("classifyReformulation — the four defined types", () => {
  // narrowing: adds words. Signal = results were too broad. Remedy = faceting.
  it.each([
    ["snowboard", "complete snowboard"],
    ["wax", "ski wax"],
    ["boot", "red boot for snow"],
  ])("narrowing: %s -> %s", (a, b) => {
    expect(classifyReformulation(a, b)).toBe("narrowing");
  });

  // broadening: removes words. The same comparison, inverted.
  it.each([
    ["complete snowboard", "snowboard"],
    ["ski wax", "wax"],
  ])("broadening: %s -> %s", (a, b) => {
    expect(classifyReformulation(a, b)).toBe("broadening");
  });

  // correcting: a typo repaired. Remedy = typo tolerance, NOT faceting —
  // which is exactly why this must never be classified as narrowing.
  it.each([
    ["snwoboard", "snowboard"],   // adjacent transposition, the commonest typo
    ["snowbaord", "snowboard"],   // transposition again
    ["goggels", "goggles"],
    ["snowbord", "snowboard"],    // one omission
  ])("correcting: %s -> %s", (a, b) => {
    expect(classifyReformulation(a, b)).toBe("correcting");
  });

  // lateral: descriptors swapped around a shared subject. Each lateral chain
  // ending in success is a synonym candidate.
  it.each([
    ["ski wax", "snowboard wax"],
    ["snow boot", "winter boot"],
  ])("lateral: %s -> %s", (a, b) => {
    expect(classifyReformulation(a, b)).toBe("lateral");
  });

  it("unrelated when nothing is shared and nothing is close", () => {
    expect(classifyReformulation("snowboard", "gift card")).toBe("unrelated");
  });
});

describe("classifyReformulation — not reformulations at all", () => {
  // These grouped under the old signature equality too. They must keep
  // grouping, and must NOT be reported as rewrites.
  it.each([
    ["snowboard", "snowboards"],        // plural
    ["running shoe", "shoe running"],   // word order
    ["cafe racer", "café racer"],       // accents
    ["the snowboard", "snowboard"],     // stopword only
  ])("same: %s -> %s", (a, b) => {
    expect(classifyReformulation(a, b)).toBe("same");
  });

  it("an all-stopword query is unrelated to anything", () => {
    expect(classifyReformulation("snowboard", "the of for")).toBe("unrelated");
  });
});

describe("typo budget follows Meilisearch's own thresholds", () => {
  it("forgives one error from 5 characters", () => {
    expect(classifyReformulation("boots", "bootz")).toBe("correcting");
  });

  it("does not invent a typo in a short word", () => {
    // 3 characters: Meilisearch would not match these either, so neither do we.
    expect(classifyReformulation("ski wax", "ski wix")).toBe("lateral");
  });

  it("counts an adjacent transposition as one error, not two", () => {
    expect(editDistance("snwoboard", "snowboard", 1)).toBe(1);
  });

  it("bails out early once the bound is exceeded", () => {
    expect(editDistance("snowboard", "gift card", 2)).toBe(3);
  });
});

describe("assignIntent — one demand, one id", () => {
  const AT = "2026-11-02T10:00:00.000Z";
  const plus = (ms: number) => new Date(Date.parse(AT) + ms).toISOString();

  it("opens an intent when there is no history", () => {
    const a = assignIntent([], "snowboard", AT);
    expect(a.reformulationType).toBeNull();
    expect(a.previousQuery).toBeNull();
    expect(a.intentGroupId).toMatch(/^intent_/);
  });

  it("keeps a whole reformulation chain under one id, naming each step", () => {
    const log: RecentQuery[] = [];
    const chain = ["snwoboard", "snowboard", "complete snowboard"];
    const types: (string | null)[] = [];
    let id: string | null = null;

    chain.forEach((q, i) => {
      const a = assignIntent(log.slice(0, 10), q, plus(i * 10_000));
      if (id === null) id = a.intentGroupId;
      types.push(a.reformulationType);
      log.unshift({ query: q, intentGroupId: a.intentGroupId, at: plus(i * 10_000) });
    });

    // The whole demand is one intent — this is the assertion that used to fail.
    expect(new Set(log.map((r) => r.intentGroupId)).size).toBe(1);
    expect(types).toEqual([null, "correcting", "narrowing"]);
  });

  it("starts a new intent for a genuinely different demand", () => {
    const log: RecentQuery[] = [
      { query: "snowboard", intentGroupId: "intent_a", at: AT },
    ];
    const a = assignIntent(log, "gift card", plus(5_000));
    expect(a.intentGroupId).not.toBe("intent_a");
    expect(a.reformulationType).toBeNull();
  });

  it("records WHICH query the type describes", () => {
    const log: RecentQuery[] = [
      { query: "snowboard", intentGroupId: "intent_a", at: AT },
      { query: "snwoboard", intentGroupId: "intent_a", at: plus(-10_000) },
    ];
    const a = assignIntent(log, "complete snowboard", plus(5_000));
    expect(a.previousQuery).toBe("snowboard");
    expect(a.reformulationType).toBe("narrowing");
  });

  it("will not join an intent older than the window", () => {
    const log: RecentQuery[] = [
      { query: "snowboard", intentGroupId: "intent_old", at: AT },
    ];
    const within = assignIntent(log, "snowboards", plus(INTENT_WINDOW_MS - 1_000));
    expect(within.intentGroupId).toBe("intent_old");

    const beyond = assignIntent(log, "snowboards", plus(INTENT_WINDOW_MS + 1_000));
    expect(beyond.intentGroupId).not.toBe("intent_old");
    expect(beyond.reformulationType).toBeNull();
  });

  it("joins the most recent related query, not the first", () => {
    const log: RecentQuery[] = [
      { query: "ski wax", intentGroupId: "intent_wax", at: plus(20_000) },
      { query: "snowboard", intentGroupId: "intent_board", at: AT },
    ];
    const a = assignIntent(log, "snowboard wax", plus(25_000));
    expect(a.intentGroupId).toBe("intent_wax");
    expect(a.previousQuery).toBe("ski wax");
  });
});

describe("intentSignature stays the cheap identity test", () => {
  it("normalises case, accents, punctuation, order and plurals", () => {
    expect(intentSignature("Running Shoes!")).toBe(intentSignature("shoe running"));
    expect(intentSignature("café")).toBe(intentSignature("cafe"));
  });

  it("is empty for a query with no content words", () => {
    expect(intentSignature("the of for")).toBe("");
  });
});
