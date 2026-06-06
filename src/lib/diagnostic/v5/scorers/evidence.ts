/**
 * Prospectos v5 — per-run evidence layer for real (FETCH + ASE_PDP) scorers.
 *
 * The seo.* / aeo.* scorers are pure functions of two raw evidence kinds:
 *   - ASE_PDP   — ASE `/tools/pdp-signals` for the PDP (JSON-LD, canonical,
 *                 FAQ schema, answerable content).
 *   - FETCH     — an RRE HTTP fetch of a SITE_WIDE artifact (sitemap.xml,
 *                 llms.txt, robots.txt) or the SITE_WIDE page HTML (OG tags).
 *
 * Which page each kind targets is DB-as-truth (the seed's
 * `diagnostic_check_source` primary source). This module turns the discovered
 * `V5RunContext.pages` into a concrete target URL and performs the IO ONCE per
 * run per artifact — memoized on the run's `ctx` object via a `WeakMap`, so the
 * six PDP-signal consumers share a single ASE call and the four SITE_WIDE
 * consumers don't re-fetch. The memo is keyed on the ctx identity, so it is
 * naturally per-run and garbage-collected when the run ends — no cross-run leak
 * and no change to the `Scorer` signature or the engine.
 *
 * Robustness: every path resolves to a typed result, never throws. A page that
 * discovery marked `found:false` (or that isn't in `pages` at all) yields a
 * `na` result the scorer surfaces as status `'na'`; a network error / timeout /
 * unset ASE yields `error` (also surfaced as `'na'` — "not measured"); a real
 * non-2xx (e.g. a 404 on /sitemap.xml) yields `missing`, which presence checks
 * treat as a genuine `fail` (0), not `na`.
 *
 * Multi-tenancy (CLAUDE.md §2): `ctx.instanceId` may be `0` (real template) or
 * `null` (anonymous) — irrelevant here; this layer reads only URLs.
 *
 * Reuses the existing `fetchWithTimeout` (site-checks.ts) and `scanPdpSignals`
 * (ase.ts) — no duplicated fetch/ASE plumbing.
 */

import { fetchWithTimeout } from "../../site-checks";
import { scanPdpSignals, type PdpSignals } from "@/lib/ase";
import type { V5RunContext } from "../types";

// ── Result shapes ────────────────────────────────────────────────────────────

/** ASE pdp-signals evidence for the PDP. */
export type PdpEvidence =
  | { ok: true; signals: PdpSignals; url: string }
  /** PDP not discovered (found:false / absent) — excluded, not failed. */
  | { ok: false; status: "na"; note: string }
  /** ASE call failed / ASE_API_URL unset — not measured. */
  | { ok: false; status: "error"; note: string };

/** A fetched SITE_WIDE artifact (a file or the page HTML). */
export type FileEvidence =
  | { ok: true; body: string; httpStatus: number; url: string }
  /** SITE_WIDE page not discovered — excluded, not failed. */
  | { ok: false; status: "na"; note: string }
  /** Reached the server, got a non-2xx (e.g. 404) — the artifact is absent. */
  | { ok: false; status: "missing"; httpStatus: number | null; note: string; url: string }
  /** Network error / timeout — not measured. */
  | { ok: false; status: "error"; note: string; url: string };

// ── Page-URL resolution from discovery ───────────────────────────────────────

/** Strip a URL to scheme + host (the SITE_WIDE / HOME root). */
function rootOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/**
 * Resolve the PDP target URL. When discovery ran (`ctx.pages` present) we honor
 * it: a `found:false`/absent PDP is `na`. Without discovery we fall back to the
 * submitted entry URL (matches the engine's "no page-gating" default).
 */
function resolvePdpUrl(ctx: V5RunContext): { url: string } | { na: string } {
  if (ctx.pages) {
    const p = ctx.pages.PDP;
    // Use the discovered PDP URL when confirmed; otherwise fall back to ctx.url
    // (the user submitted it as a PDP URL directly). Individual fetchers and
    // the ASE call handle their own errors — don't prematurely return na here.
    if (p?.found && p.url) return { url: p.url };
    return { url: ctx.url };
  }
  return { url: ctx.url };
}

/**
 * Resolve the SITE_WIDE root URL (for artifacts + page HTML). Honors discovery
 * when present; otherwise derives the root from the entry URL.
 */
function resolveSiteUrl(ctx: V5RunContext): { url: string } | { na: string } {
  if (ctx.pages) {
    const p = ctx.pages.SITE_WIDE;
    // Use the discovered SITE_WIDE URL when confirmed; otherwise fall back to
    // rootOf(ctx.url). Discovery may have been blocked by bot-protection or
    // rate-limiting — the individual artifact fetches (sitemap.xml, robots.txt,
    // etc.) often succeed even when the homepage fetch doesn't.
    if (p?.found) return { url: p.url ?? rootOf(ctx.url) };
    return { url: rootOf(ctx.url) };
  }
  return { url: rootOf(ctx.url) };
}

// ── Per-run memo (keyed on the ctx object identity) ──────────────────────────

type RunCache = {
  pdp?: Promise<PdpEvidence>;
  files: Map<string, Promise<FileEvidence>>;
};

const caches = new WeakMap<V5RunContext, RunCache>();

function cacheFor(ctx: V5RunContext): RunCache {
  let c = caches.get(ctx);
  if (!c) {
    c = { files: new Map() };
    caches.set(ctx, c);
  }
  return c;
}

// ── ASE_PDP evidence ─────────────────────────────────────────────────────────

async function loadPdpEvidence(ctx: V5RunContext): Promise<PdpEvidence> {
  const target = resolvePdpUrl(ctx);
  if ("na" in target) return { ok: false, status: "na", note: target.na };
  try {
    const signals = await scanPdpSignals(target.url);
    return { ok: true, signals, url: target.url };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "error", note: `ase_pdp_failed:${message}` };
  }
}

/** ASE pdp-signals for this run's PDP, fetched at most once per run. */
export function pdpSignalsFor(ctx: V5RunContext): Promise<PdpEvidence> {
  const cache = cacheFor(ctx);
  if (!cache.pdp) cache.pdp = loadPdpEvidence(ctx);
  return cache.pdp;
}

// ── FETCH evidence ───────────────────────────────────────────────────────────

async function loadFile(targetUrl: string): Promise<FileEvidence> {
  const res = await fetchWithTimeout(targetUrl);
  if (res.status === null) {
    return { ok: false, status: "error", note: "network_error_or_timeout", url: targetUrl };
  }
  if (res.ok) {
    return { ok: true, body: res.body ?? "", httpStatus: res.status, url: targetUrl };
  }
  return {
    ok: false,
    status: "missing",
    httpStatus: res.status,
    note: `http_${res.status}`,
    url: targetUrl,
  };
}

/**
 * Fetch a SITE_WIDE artifact at `path` (e.g. `/sitemap.xml`, `/llms.txt`,
 * `/robots.txt`), resolved against the discovered SITE_WIDE root and memoized.
 */
export function siteFileFor(ctx: V5RunContext, path: string): Promise<FileEvidence> {
  const site = resolveSiteUrl(ctx);
  if ("na" in site) {
    return Promise.resolve({ ok: false, status: "na", note: site.na });
  }
  let targetUrl: string;
  try {
    targetUrl = new URL(path, site.url.endsWith("/") ? site.url : `${site.url}/`).toString();
  } catch {
    return Promise.resolve({
      ok: false,
      status: "error",
      note: "bad_target_url",
      url: site.url,
    });
  }

  const cache = cacheFor(ctx);
  const existing = cache.files.get(targetUrl);
  if (existing) return existing;
  const p = loadFile(targetUrl);
  cache.files.set(targetUrl, p);
  return p;
}

/** Fetch the SITE_WIDE page HTML itself (for OG meta tags), memoized. */
export function siteHtmlFor(ctx: V5RunContext): Promise<FileEvidence> {
  const site = resolveSiteUrl(ctx);
  if ("na" in site) {
    return Promise.resolve({ ok: false, status: "na", note: site.na });
  }
  const cache = cacheFor(ctx);
  const key = `__html__:${site.url}`;
  const existing = cache.files.get(key);
  if (existing) return existing;
  const p = loadFile(site.url);
  cache.files.set(key, p);
  return p;
}
