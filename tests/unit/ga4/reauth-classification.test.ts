/**
 * The permanent-vs-transient split is the whole safety property of the GA4
 * reconnect flow, and it is the one part testable without Google credentials.
 *
 * Getting it wrong in either direction is a real bug:
 *   - too broad  → a Google outage pushes every merchant through a pointless
 *                  reconnect and masks the real incident;
 *   - too narrow → a genuinely dead token never surfaces and the dashboard
 *                  goes quietly stale, which is the bug this work exists to fix.
 */

import { describe, expect, it } from "vitest";
import { Ga4OAuthError, isPermanentGrantFailure } from "@/lib/integrations/ga4/client";

describe("isPermanentGrantFailure", () => {
  it("treats 400 invalid_grant as permanent — the one signal Google gives", () => {
    expect(isPermanentGrantFailure(400, "invalid_grant")).toBe(true);
  });

  it("treats server errors as transient, whatever the body says", () => {
    expect(isPermanentGrantFailure(500, "invalid_grant")).toBe(false);
    expect(isPermanentGrantFailure(503, undefined)).toBe(false);
  });

  it("treats rate limiting as transient", () => {
    expect(isPermanentGrantFailure(429, "rate_limit_exceeded")).toBe(false);
  });

  it("treats a network failure (status 0) as transient", () => {
    expect(isPermanentGrantFailure(0, undefined)).toBe(false);
  });

  it("does NOT treat our own misconfiguration as user-reauth", () => {
    // invalid_client means OUR client id/secret is wrong. Reconnecting would
    // not fix it, so it must not prompt the user.
    expect(isPermanentGrantFailure(400, "invalid_client")).toBe(false);
    expect(isPermanentGrantFailure(401, "unauthorized_client")).toBe(false);
  });

  it("does not fire on a 400 with no error field", () => {
    expect(isPermanentGrantFailure(400, undefined)).toBe(false);
  });
});

describe("Ga4OAuthError", () => {
  it("defaults needsReauth to false so unclassified errors never nag", () => {
    const err = new Ga4OAuthError("boom");
    expect(err.needsReauth).toBe(false);
    expect(err.googleError).toBeUndefined();
  });

  it("carries the classification and Google's structured error when given", () => {
    const err = new Ga4OAuthError("dead", undefined, {
      needsReauth: true,
      googleError: "invalid_grant",
    });
    expect(err.needsReauth).toBe(true);
    expect(err.googleError).toBe("invalid_grant");
  });

  it("still accepts the legacy (message, cause) shape used elsewhere", () => {
    const cause = new Error("socket hang up");
    const err = new Ga4OAuthError("Network error", cause);
    expect(err.cause).toBe(cause);
    expect(err.needsReauth).toBe(false);
  });
});
