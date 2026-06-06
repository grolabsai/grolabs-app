/**
 * API route behaviour tests for POST /api/v1/diagnostic/runs.
 *
 * Tests routing logic only — the unit tests for each runner are in their own
 * files. These tests verify:
 *   - rate-limit hit → 429 before any scoring
 *   - "version": "v5" routes to the v5 runner
 *   - absent version routes to the legacy runner only
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.hoisted ensures these mock functions are available before any imports are
// processed (even with vitest's hoisting of vi.mock()).
const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  startAnonymousDiagnostic: vi.fn(),
  runV5Diagnostic: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

vi.mock("@/lib/diagnostic/runner", () => ({
  startAnonymousDiagnostic: mocks.startAnonymousDiagnostic,
}));

vi.mock("@/lib/diagnostic/v5", () => ({
  runV5Diagnostic: mocks.runV5Diagnostic,
}));

import { POST } from "@/app/api/v1/diagnostic/runs/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v1/diagnostic/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const LEGACY_OK = { ok: true as const, runId: "run-legacy-id", prospectId: 1 };
const V5_OK = {
  ok: true as const,
  runId: "run-v5-id",
  report: { profile: "anonymous_landing_audit", overall: 55, stages: [], categories: [] },
  findingsInserted: 2,
  categoryScoresUpserted: 2,
};

beforeEach(() => {
  vi.resetAllMocks();
  setEnv({
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    PROSPECTOS_V5_ENABLED: undefined,
  });
});

// ── Rate-limit tests ─────────────────────────────────────────────────────────

describe("rate limiting", () => {
  it("returns 429 immediately when rate-limit is hit, before calling any runner", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: false, error: null });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: mockRpc });

    const res = await POST(makeRequest({ url: "https://shop.example/p/1" }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");

    // Neither runner should have been called
    expect(mocks.startAnonymousDiagnostic).not.toHaveBeenCalled();
    expect(mocks.runV5Diagnostic).not.toHaveBeenCalled();
  });

  it("returns 500 when the rate-limit RPC itself errors", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "RPC error" } });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: mockRpc });

    const res = await POST(makeRequest({ url: "https://shop.example/p/1" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("rate_limit_check_failed");
  });
});

// ── v5 routing ───────────────────────────────────────────────────────────────

describe("v5 routing", () => {
  beforeEach(() => {
    const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: mockRpc });
    mocks.startAnonymousDiagnostic.mockResolvedValue(LEGACY_OK);
    mocks.runV5Diagnostic.mockResolvedValue(V5_OK);
  });

  it("routes to v5 runner when body contains version=v5", async () => {
    const res = await POST(makeRequest({ url: "https://shop.example/p/1", version: "v5" }));

    expect(mocks.runV5Diagnostic).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toHaveProperty("v5");
    expect(body.v5.profile).toBe("anonymous_landing_audit");
  });

  it("routes to v5 runner when PROSPECTOS_V5_ENABLED=1 is set", async () => {
    setEnv({ PROSPECTOS_V5_ENABLED: "1" });

    const res = await POST(makeRequest({ url: "https://shop.example/p/1" }));

    expect(mocks.runV5Diagnostic).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toHaveProperty("v5");
  });

  it("does NOT call v5 runner when version param is absent and flag is off", async () => {
    const res = await POST(makeRequest({ url: "https://shop.example/p/1" }));

    expect(mocks.runV5Diagnostic).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty("v5");
  });

  it("always calls the legacy runner (bridge: both active)", async () => {
    // Even with version=v5, legacy still runs.
    await POST(makeRequest({ url: "https://shop.example/p/1", version: "v5" }));

    expect(mocks.startAnonymousDiagnostic).toHaveBeenCalledOnce();
    expect(mocks.runV5Diagnostic).toHaveBeenCalledOnce();
  });

  it("returns legacy run_id even when v5 also runs", async () => {
    const res = await POST(makeRequest({ url: "https://shop.example/p/1", version: "v5" }));
    const body = await res.json();

    expect(body.run_id).toBe("run-legacy-id");
    expect(body.v5.run_id).toBe("run-v5-id");
  });

  it("includes v5_error in response (but still 201) when v5 runner errors", async () => {
    mocks.runV5Diagnostic.mockResolvedValue({ error: "Profile not found: anonymous_landing_audit" });

    const res = await POST(makeRequest({ url: "https://shop.example/p/1", version: "v5" }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run_id).toBe("run-legacy-id");
    expect(body.v5_error).toMatch(/Profile not found/);
    expect(body).not.toHaveProperty("v5");
  });
});

// ── Input validation ─────────────────────────────────────────────────────────

describe("input validation", () => {
  it("returns 400 when url is missing", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: mockRpc });

    const res = await POST(makeRequest({ display_name: "no url" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/v1/diagnostic/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
