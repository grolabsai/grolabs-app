import { test, expect } from "@playwright/test";
import { TEST_INSTANCE_ID } from "../lib/db";

/**
 * Token endpoints (test matrix G): mint a scoped Meilisearch tenant token,
 * use it against the Meilisearch host, and check the deny + expiry contract.
 * Pure API spec — no browser page, just Playwright's request fixture.
 *
 * Trust model under test: instance_id is public; the Origin header is the
 * secret handshake (must be a registered storefront domain). All failures
 * return one undifferentiated 403 body — no enumeration.
 */

const ORIGIN = "https://grolabs.io";
const API = "https://app.grolabs.ai";

test.describe("search token", () => {
  test("mints a scoped token usable against Meilisearch", async ({ request }) => {
    const res = await request.post(`${API}/api/v1/search/token`, {
      headers: { Origin: ORIGIN },
      data: { instance_id: TEST_INSTANCE_ID },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.meilisearch_host).toMatch(/^https:\/\//);
    expect(body.index_uid).toBe(`inst_${TEST_INSTANCE_ID}`);
    // Expiry contract: in the future, but bounded (a token that outlives the
    // session by days would defeat the point of minting per-visitor).
    const now = Math.floor(Date.now() / 1000);
    expect(body.expires_at).toBeGreaterThan(now);
    expect(body.expires_at).toBeLessThan(now + 60 * 60 * 24 * 8);

    // Use the token: search the instance index directly on Meilisearch.
    const search = await request.post(
      `${body.meilisearch_host.replace(/\/+$/, "")}/indexes/${body.index_uid}/search`,
      {
        headers: { Authorization: `Bearer ${body.token}` },
        data: { q: "dog", limit: 1 },
      },
    );
    expect(search.status()).toBe(200);
    const hits = await search.json();
    expect(Array.isArray(hits.hits)).toBe(true);
    if (hits.hits.length > 0) {
      // Tenant-token scoping: every hit must belong to the test instance.
      expect(hits.hits[0].instance_id).toBe(TEST_INSTANCE_ID);
    }
  });

  test("unregistered origin gets the undifferentiated 403", async ({ request }) => {
    const res = await request.post(`${API}/api/v1/search/token`, {
      headers: { Origin: "https://evil.example" },
      data: { instance_id: TEST_INSTANCE_ID },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("instance_not_found_or_origin_not_authorized");
  });
});

test.describe("events token", () => {
  test("mints an events token for the registered origin", async ({ request }) => {
    const res = await request.post(`${API}/api/v1/events/token`, {
      headers: { Origin: ORIGIN },
      data: { instance_id: TEST_INSTANCE_ID },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("unknown instance gets the same 403 body (no enumeration)", async ({ request }) => {
    const res = await request.post(`${API}/api/v1/events/token`, {
      headers: { Origin: ORIGIN },
      data: { instance_id: 424242 },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("instance_not_found_or_origin_not_authorized");
  });
});
