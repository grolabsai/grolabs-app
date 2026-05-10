/**
 * The single place in Scout's codebase that talks to Google's OAuth and GA4
 * APIs. Per docs/policy/ga4-integration.md §4 and §5.
 *
 * Mirrors the meilisearch-client pattern: typed errors, never logs
 * credentials, callable from server-only code.
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID            — OAuth client ID (server-only)
 *   GOOGLE_CLIENT_SECRET        — OAuth client secret (server-only)
 *   GOOGLE_OAUTH_REDIRECT_URI   — optional override; otherwise derived from request
 *
 * Endpoints used:
 *   - https://accounts.google.com/o/oauth2/v2/auth        (consent URL builder)
 *   - https://oauth2.googleapis.com/token                  (code exchange + refresh)
 *   - https://analyticsdata.googleapis.com/v1beta/...     (Data API runReport)
 *   - https://analyticsdata.googleapis.com/v1beta/...:runRealtimeReport
 */

import { GA4_OAUTH_SCOPES } from "./constants";

// ── Config ───────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Ga4ConfigError(`${name} is not set in the environment.`);
  }
  return v;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class Ga4ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Ga4ConfigError";
  }
}

export class Ga4OAuthError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "Ga4OAuthError";
    this.cause = cause;
  }
}

export class Ga4ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "Ga4ApiError";
    this.status = status;
    this.body = body;
  }
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/**
 * Build the Google consent URL. `state` is opaque to Google but echoed back
 * to our callback — we use it to bind the flow to the calling user/instance.
 */
export function buildAuthUrl(args: {
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: GA4_OAUTH_SCOPES.join(" "),
    access_type: "offline", // refresh_token in the response
    prompt: "consent", // force re-prompt so we always get a refresh_token
    state: args.state,
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

interface TokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * The first time a user grants, Google returns refresh_token; subsequent
 * grants for the same client/user only return refresh_token if prompt=consent.
 */
export async function exchangeCodeForTokens(args: {
  code: string;
  redirectUri: string;
}): Promise<TokenExchangeResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new Ga4OAuthError("Network error exchanging code for tokens", err);
  }

  const json = (await res.json().catch(() => null)) as
    | (TokenExchangeResponse & { error?: string; error_description?: string })
    | null;

  if (!res.ok || !json || !json.access_token) {
    throw new Ga4OAuthError(
      `Token exchange failed (${res.status}): ${json?.error_description ?? json?.error ?? "unknown"}`,
    );
  }
  return json;
}

/**
 * Decode the email claim from a Google id_token (JWT). We don't validate the
 * signature here because the token came directly from Google's HTTPS endpoint
 * over our authenticated server-to-server exchange — that's the trust anchor.
 */
export function emailFromIdToken(idToken: string): string | null {
  try {
    const [, payload] = idToken.split(".");
    if (!payload) return null;
    // Base64url → base64
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(decoded) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * Refresh an access token using a stored refresh_token. Called by the polling
 * job and by the realtime endpoint just-in-time.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<AccessTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new Ga4OAuthError("Network error refreshing access token", err);
  }

  const json = (await res.json().catch(() => null)) as
    | (AccessTokenResponse & { error?: string; error_description?: string })
    | null;

  if (!res.ok || !json || !json.access_token) {
    throw new Ga4OAuthError(
      `Refresh failed (${res.status}): ${json?.error_description ?? json?.error ?? "unknown"}`,
    );
  }
  return json;
}

// ── GA4 Data API ─────────────────────────────────────────────────────────────

export interface RunReportRequest {
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dateRanges: { startDate: string; endDate: string }[];
  // 0-based offset
  offset?: number;
  limit?: number;
  orderBys?: Array<
    | { metric: { metricName: string }; desc?: boolean }
    | { dimension: { dimensionName: string }; desc?: boolean }
  >;
  keepEmptyRows?: boolean;
}

export interface RunReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export interface RunReportResponse {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: RunReportRow[];
  rowCount?: number;
}

async function callDataApi<T>(args: {
  propertyId: string;
  accessToken: string;
  path: string; // e.g. ":runReport" or ":runRealtimeReport"
  body: unknown;
}): Promise<T> {
  const url = `${DATA_API_BASE}/properties/${args.propertyId}${args.path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.body),
    });
  } catch (err) {
    throw new Ga4ApiError("Network error calling GA4 Data API", 0, err);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Ga4ApiError(`GA4 Data API ${res.status}`, res.status, json);
  }
  return json as T;
}

export async function runReport(args: {
  propertyId: string;
  accessToken: string;
  request: RunReportRequest;
}): Promise<RunReportResponse> {
  return callDataApi<RunReportResponse>({
    propertyId: args.propertyId,
    accessToken: args.accessToken,
    path: ":runReport",
    body: args.request,
  });
}

export interface RunRealtimeReportRequest {
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  minuteRanges?: { startMinutesAgo: number; endMinutesAgo: number; name?: string }[];
  limit?: number;
}

export async function runRealtimeReport(args: {
  propertyId: string;
  accessToken: string;
  request: RunRealtimeReportRequest;
}): Promise<RunReportResponse> {
  return callDataApi<RunReportResponse>({
    propertyId: args.propertyId,
    accessToken: args.accessToken,
    path: ":runRealtimeReport",
    body: args.request,
  });
}

// ── Helpers callers will reach for ───────────────────────────────────────────

/**
 * Read the refresh token from Vault and exchange it for a fresh access token.
 * Returns null if the instance has no GA4 connection.
 */
export async function getAccessTokenForInstance(
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
  },
  instanceId: number,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("ga4_get_refresh_token", {
    p_instance_id: instanceId,
  });
  if (error || !data || typeof data !== "string") return null;
  const t = await refreshAccessToken(data);
  return t.access_token;
}

/**
 * Resolve the OAuth redirect URI. Order of precedence:
 *   1. GOOGLE_OAUTH_REDIRECT_URI explicit env (preferred for prod)
 *   2. Derived from the request origin (covers preview + localhost)
 */
export function resolveRedirectUri(requestOrigin: string): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${requestOrigin}/api/v1/integrations/ga4/callback`
  );
}
