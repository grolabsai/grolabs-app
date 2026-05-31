/**
 * Site-wide HTTP probes for the Prospectos diagnostic.
 *
 * These are the checks that don't need ASE or a browser — just an HTTP
 * fetch and some light parsing. Used by the runner before per-PDP probes.
 */

import type { SiteWideContext } from "./types";

const USER_AGENT = "Mozilla/5.0 (compatible; SiteAuditBot/1.0)";
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number | null; body: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { ...(init?.headers ?? {}), "User-Agent": USER_AGENT },
      redirect: "follow",
      cache: "no-store",
    });
    let body: string | null = null;
    try {
      body = await res.text();
    } catch {
      /* binary or unreadable; leave null */
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRootUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

function detectAiBotPolicy(
  robotsBody: string | null,
): "allow" | "block" | "unmentioned" {
  if (!robotsBody) return "unmentioned";
  const aiBots = [
    "GPTBot",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Google-Extended",
    "anthropic-ai",
    "CCBot",
  ];
  const lower = robotsBody.toLowerCase();
  const mentioned = aiBots.some((b) => lower.includes(b.toLowerCase()));
  if (!mentioned) return "unmentioned";

  // Crude detection: if any of the AI bots is followed by a "Disallow: /"
  // (or "Disallow:/") block within ~200 chars, call it "block". Otherwise
  // "allow" (an explicit AI policy that doesn't ban them).
  for (const bot of aiBots) {
    const idx = lower.indexOf(bot.toLowerCase());
    if (idx < 0) continue;
    const slice = lower.slice(idx, idx + 240);
    if (/disallow:\s*\/(\s|$)/m.test(slice)) {
      return "block";
    }
  }
  return "allow";
}

function countSitemapUrls(body: string | null): number | null {
  if (!body) return null;
  const matches = body.match(/<url>/gi);
  if (matches) return matches.length;
  // sitemap index
  const idx = body.match(/<sitemap>/gi);
  if (idx) return idx.length;
  return null;
}

export async function probeSiteWide(rootUrlInput: string): Promise<SiteWideContext> {
  const root = normalizeRootUrl(rootUrlInput);

  const [llms, robots, sitemap] = await Promise.all([
    fetchWithTimeout(`${root}/llms.txt`),
    fetchWithTimeout(`${root}/robots.txt`),
    fetchWithTimeout(`${root}/sitemap.xml`),
  ]);

  return {
    rootUrl: root,
    llmsTxt: {
      present: llms.ok,
      status: llms.status,
      bodyExcerpt: llms.body ? llms.body.slice(0, 400) : null,
    },
    robotsTxt: {
      present: robots.ok,
      status: robots.status,
      bodyExcerpt: robots.body ? robots.body.slice(0, 1000) : null,
      aiBotPolicy: detectAiBotPolicy(robots.body),
    },
    sitemap: {
      present: sitemap.ok,
      status: sitemap.status,
      urlCount: countSitemapUrls(sitemap.body),
    },
  };
}
