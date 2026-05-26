/**
 * Vertical auto-classification for the Prospectos diagnostic.
 *
 * Two layers, cheap-first:
 *
 * 1. Keyword scorer (free, deterministic). Counts how many of each
 *    vertical's detection_keywords appear in the homepage text and
 *    picks the top scorer if it leads by a comfortable margin.
 *
 * 2. Claude Haiku tie-breaker (~$0.0001/call). Only fires when keyword
 *    scoring is inconclusive (no winner OR top two tied within 25%).
 *    Sends a compact snippet (title, h1s, h2s, JSON-LD product types)
 *    and asks for a single vertical_code from the known taxonomy.
 *
 * Returns the chosen vertical_id (or null when nothing is confident
 * enough — caller falls back to 'generic'). The decision is persisted
 * on prospect.vertical_id so subsequent runs skip the classifier.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Vertical = {
  vertical_id: number;
  vertical_code: string;
  vertical_name: string;
  detection_keywords: string[];
};

export type ClassificationResult = {
  vertical_id: number | null;
  vertical_code: string | null;
  method: "keyword" | "llm" | "none";
  scores: Record<string, number>;
  confidence: "low" | "medium" | "high";
};

const KEYWORD_LEAD_MARGIN = 1.25; // top must beat #2 by at least 25%
const KEYWORD_MIN_HITS = 3; // need at least N hits to trust the keyword pass

export async function classifyVertical(opts: {
  homepageText: string;
  homepageHints?: {
    title?: string;
    h1?: string[];
    h2?: string[];
    productTypes?: string[];
  };
  supabase: SupabaseClient;
}): Promise<ClassificationResult> {
  const { homepageText, homepageHints, supabase } = opts;

  const { data: verticals } = await supabase
    .from("vertical")
    .select("vertical_id, vertical_code, vertical_name, detection_keywords");

  const list = (verticals ?? []) as Vertical[];
  if (list.length === 0) {
    return { vertical_id: null, vertical_code: null, method: "none", scores: {}, confidence: "low" };
  }

  // ── Layer 1: keyword scoring ────────────────────────────────────────────
  const haystack = homepageText.toLowerCase();
  const scores: Record<string, number> = {};

  for (const v of list) {
    if (v.vertical_code === "generic") continue;
    let hits = 0;
    for (const kw of v.detection_keywords ?? []) {
      const needle = kw.toLowerCase().trim();
      if (!needle) continue;
      // Word-boundary match (allow accent-insensitive in a basic way).
      const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, "i");
      if (re.test(haystack)) hits += 1;
    }
    scores[v.vertical_code] = hits;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, second] = sorted;
  const topScore = top?.[1] ?? 0;
  const secondScore = second?.[1] ?? 0;

  const keywordWinner =
    topScore >= KEYWORD_MIN_HITS &&
    (secondScore === 0 || topScore / Math.max(1, secondScore) >= KEYWORD_LEAD_MARGIN)
      ? top[0]
      : null;

  if (keywordWinner) {
    const v = list.find((x) => x.vertical_code === keywordWinner);
    return {
      vertical_id: v?.vertical_id ?? null,
      vertical_code: keywordWinner,
      method: "keyword",
      scores,
      confidence: topScore >= 8 ? "high" : "medium",
    };
  }

  // ── Layer 2: Claude Haiku tie-breaker ────────────────────────────────────
  // Only fires when the keyword pass is inconclusive. Skipped if the
  // Anthropic key isn't configured (we don't want to fail the run for it).
  if (!process.env.ANTHROPIC_API_KEY) {
    return { vertical_id: null, vertical_code: null, method: "none", scores, confidence: "low" };
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();

    const candidateList = list
      .filter((v) => v.vertical_code !== "generic")
      .map((v) => `- ${v.vertical_code}: ${v.vertical_name}`)
      .join("\n");

    const snippet = buildSnippet(homepageHints, homepageText);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 32,
      system:
        "You classify ecommerce storefronts by industry vertical from a small homepage snippet. Reply with exactly one of the provided vertical_code values, lowercase, no quotes, no commentary.",
      messages: [
        {
          role: "user",
          content: `Available verticals:\n${candidateList}\n\nHomepage snippet:\n"""\n${snippet}\n"""\n\nIf the snippet does not clearly match any vertical, reply with: unknown`,
        },
      ],
    });

    const raw =
      message.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim()
        .toLowerCase() ?? "";

    if (raw === "unknown" || !raw) {
      return { vertical_id: null, vertical_code: null, method: "llm", scores, confidence: "low" };
    }

    const match = list.find((v) => v.vertical_code === raw);
    if (!match) {
      return { vertical_id: null, vertical_code: null, method: "llm", scores, confidence: "low" };
    }
    return {
      vertical_id: match.vertical_id,
      vertical_code: match.vertical_code,
      method: "llm",
      scores,
      confidence: "medium",
    };
  } catch (e) {
    console.warn("[classify-vertical] Haiku call failed:", e);
    return { vertical_id: null, vertical_code: null, method: "none", scores, confidence: "low" };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnippet(
  hints: { title?: string; h1?: string[]; h2?: string[]; productTypes?: string[] } | undefined,
  fallbackText: string,
): string {
  const lines: string[] = [];
  if (hints?.title) lines.push(`Title: ${hints.title}`);
  if (hints?.h1?.length) lines.push(`H1: ${hints.h1.slice(0, 3).join(" | ")}`);
  if (hints?.h2?.length) lines.push(`H2: ${hints.h2.slice(0, 5).join(" | ")}`);
  if (hints?.productTypes?.length)
    lines.push(`Product types in JSON-LD: ${hints.productTypes.slice(0, 6).join(", ")}`);
  if (lines.length === 0) {
    // Fall back to first 800 chars of body text.
    lines.push(fallbackText.slice(0, 800));
  }
  return lines.join("\n");
}
