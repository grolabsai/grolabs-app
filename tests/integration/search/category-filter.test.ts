/**
 * Category-filter matrix.
 *
 * Exercises /api/v1/search with every meaningful combination of search-term
 * + product_cat filter against the synthetic FIXTURES defined in
 * ./fixtures.ts. Each test asserts on the exact set of product IDs the API
 * returns (order-independent unless the test name says otherwise).
 *
 * What's covered:
 *   - Keyword-only (no filter)
 *   - Keyword + matching category
 *   - Keyword + non-matching category (expected empty)
 *   - Multi-category products with mixed filter targets
 *   - Cross-instance isolation (instance pin defense)
 *   - Origin validation
 *
 * What's NOT covered here (separate suites):
 *   - Variant matcher result correctness (variant-matcher.test.ts).
 *   - Rate limiting (skipped — would slow the suite for low value).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/search/route";
import { NextRequest } from "next/server";
import {
  setupSearchFixtures,
  teardownSearchFixtures,
} from "./harness";
import {
  CAT_A,
  CAT_B,
  CAT_C,
  PRODUCT_IDS,
  TEST_INSTANCE_ID,
  TEST_ORIGIN,
} from "./fixtures";

beforeAll(async () => {
  await setupSearchFixtures();
}, 60_000);

afterAll(async () => {
  await teardownSearchFixtures();
}, 30_000);

type SearchBody = {
  instance_id?: number;
  query: string;
  filters?: string;
  limit?: number;
};

async function callSearch(
  body: SearchBody,
  opts: { origin?: string; instanceId?: number } = {},
): Promise<{ status: number; data: unknown }> {
  const finalBody = {
    instance_id: opts.instanceId ?? body.instance_id ?? TEST_INSTANCE_ID,
    ...body,
  };
  const req = new NextRequest("http://test.local/api/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: opts.origin ?? TEST_ORIGIN,
    },
    body: JSON.stringify(finalBody),
  });
  const res = await POST(req);
  const data = await res.json();
  return { status: res.status, data };
}

function hitIds(data: unknown): number[] {
  if (!data || typeof data !== "object" || !("hits" in data)) return [];
  const hits = (data as { hits: Array<{ document: { id: number } }> }).hits;
  return hits.map((h) => h.document.id).sort((a, b) => a - b);
}

describe("category filter — keyword present", () => {
  it("magicword + no filter → A1, A2, plus the variable magicword product", async () => {
    const { status, data } = await callSearch({ query: "magicword" });
    expect(status).toBe(200);
    expect(hitIds(data).sort()).toEqual(
      [PRODUCT_IDS.magicwordA1, PRODUCT_IDS.magicwordA2, PRODUCT_IDS.variableA].sort(),
    );
  });

  it("magicword + cat_A → same set, filter is a no-op since all magicword products live in CAT_A", async () => {
    const { status, data } = await callSearch({
      query: "magicword",
      filters: `category_ids = ${CAT_A}`,
    });
    expect(status).toBe(200);
    expect(hitIds(data).sort()).toEqual(
      [PRODUCT_IDS.magicwordA1, PRODUCT_IDS.magicwordA2, PRODUCT_IDS.variableA].sort(),
    );
  });

  it("magicword + cat_B → empty: no magicword products live in CAT_B", async () => {
    const { status, data } = await callSearch({
      query: "magicword",
      filters: `category_ids = ${CAT_B}`,
    });
    expect(status).toBe(200);
    expect(hitIds(data)).toEqual([]);
  });
});

describe("category filter — multi-category product behavior", () => {
  it("common + no filter → spans CAT_B + CAT_C (both items return)", async () => {
    const { status, data } = await callSearch({ query: "common" });
    expect(status).toBe(200);
    expect(hitIds(data)).toEqual(
      [PRODUCT_IDS.commonBC, PRODUCT_IDS.commonC].sort((a, b) => a - b),
    );
  });

  it("common + cat_B → only the product tagged with CAT_B", async () => {
    const { status, data } = await callSearch({
      query: "common",
      filters: `category_ids = ${CAT_B}`,
    });
    expect(status).toBe(200);
    expect(hitIds(data)).toEqual([PRODUCT_IDS.commonBC]);
  });

  it("common + cat_C → both products since both carry CAT_C in their array", async () => {
    const { status, data } = await callSearch({
      query: "common",
      filters: `category_ids = ${CAT_C}`,
    });
    expect(status).toBe(200);
    expect(hitIds(data)).toEqual(
      [PRODUCT_IDS.commonBC, PRODUCT_IDS.commonC].sort((a, b) => a - b),
    );
  });
});

describe("category filter — keyword absent in category", () => {
  it("otherword + no filter → only B1 (otherword is unique to CAT_B)", async () => {
    const { status, data } = await callSearch({ query: "otherword" });
    expect(status).toBe(200);
    expect(hitIds(data)).toEqual([PRODUCT_IDS.otherwordB1]);
  });

  it("otherword + cat_A → empty: no otherword products in CAT_A", async () => {
    const { status, data } = await callSearch({
      query: "otherword",
      filters: `category_ids = ${CAT_A}`,
    });
    expect(status).toBe(200);
    expect(hitIds(data)).toEqual([]);
  });
});

describe("instance isolation", () => {
  it("query against a different instance_id never returns our fixtures", async () => {
    // Use an instance that doesn't exist in the DB at all → the route
    // returns 403 (origin not authorized for an unknown instance).
    const { status, data } = await callSearch(
      { query: "magicword" },
      { instanceId: 88888 },
    );
    expect(status).toBe(403);
    // Defensive: even if the route somehow returned 200, the hits must
    // not contain any of our fixture ids.
    expect(hitIds(data)).toEqual([]);
  });
});

describe("origin validation", () => {
  it("missing Origin → 403", async () => {
    const req = new NextRequest("http://test.local/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: TEST_INSTANCE_ID, query: "magicword" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("unauthorized Origin → 403 (the storefront domain whitelist is enforced)", async () => {
    const { status } = await callSearch(
      { query: "magicword" },
      { origin: "https://not-our-domain.example.com" },
    );
    expect(status).toBe(403);
  });
});

describe("variant product surfaces a matched_variation", () => {
  it("variable_magicword keyword query returns a non-null matched_variation pointing at the in-stock variant", async () => {
    const { status, data } = await callSearch({ query: "variable magicword" });
    expect(status).toBe(200);
    const hits =
      (data as { hits: Array<{ document: { id: number }; matched_variation: { variation_id: number; in_stock: boolean } | null }> }).hits;
    const variable = hits.find((h) => h.document.id === PRODUCT_IDS.variableA);
    expect(variable, "variable fixture must be in results").toBeDefined();
    expect(variable!.matched_variation, "matched_variation must be populated for variable products").not.toBeNull();
    expect(variable!.matched_variation!.in_stock).toBe(true);
  });
});
