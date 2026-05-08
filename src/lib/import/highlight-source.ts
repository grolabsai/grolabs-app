/**
 * Find which substring of a source product name produced each extracted
 * axis/attribute value, so the UI can paint that span in the same color
 * as the cell it landed in.
 *
 * Best-effort heuristic: the agent doesn't tell us the literal trigger
 * span. We search the source name for the extracted value (quantity,
 * list option label, free text) and treat the match as the trigger.
 * Booleans are unhighlightable because the agent inferred them from
 * context (e.g. "Prescription Diet" → medicado=true) without echoing
 * the trigger phrase. Conflicts between attributes are resolved by
 * taking the longest match first; the matched range is then locked
 * out so two attributes never claim the same characters.
 */

import type { ProposedAttributeCell, ProposedAxisCell } from "@/lib/import/types";

export type HighlightSpan = {
  start: number;
  end: number;
  /** Attribute id whose value produced this span — drives color lookup. */
  attributeId: number | string;
};

type Candidate = {
  attributeId: number | string;
  /** Lowercased substrings to look for, in priority order. */
  needles: string[];
};

export function highlightSpans(
  sourceName: string,
  axes: ProposedAxisCell[],
  attributes: ProposedAttributeCell[],
  optionLabelById: Map<number, string>,
): HighlightSpan[] {
  if (!sourceName) return [];
  const candidates = buildCandidates(axes, attributes, optionLabelById);
  const haystack = sourceName.toLowerCase();
  const claimed: HighlightSpan[] = [];

  // Try the longest needle first so "large breed" wins over "large".
  candidates.sort((a, b) => maxLen(b.needles) - maxLen(a.needles));

  for (const c of candidates) {
    for (const n of c.needles) {
      if (!n) continue;
      const idx = findUnclaimed(haystack, n, claimed);
      if (idx !== -1) {
        claimed.push({ start: idx, end: idx + n.length, attributeId: c.attributeId });
        break;
      }
    }
  }
  claimed.sort((a, b) => a.start - b.start);
  return claimed;
}

function buildCandidates(
  axes: ProposedAxisCell[],
  attributes: ProposedAttributeCell[],
  optionLabelById: Map<number, string>,
): Candidate[] {
  const out: Candidate[] = [];

  for (const ax of axes) {
    const needles: string[] = [];
    // Prefer the agent's literal source span when present — it's
    // authoritative and handles cases where the value text doesn't
    // string-match the source ("Adulto" matched from "Adult").
    if (ax.extractedFrom) needles.push(ax.extractedFrom.toLowerCase());
    if (ax.dataType === "quantity" && ax.valueNumber !== null) {
      const num = formatNumber(ax.valueNumber);
      const unit = (ax.unitCode ?? "").toLowerCase();
      if (unit) {
        needles.push(`${num} ${unit}`);
        needles.push(`${num}${unit}`);
      }
      needles.push(num);
    } else if (ax.valueText) {
      needles.push(ax.valueText.toLowerCase());
    } else if (ax.valueId !== null && ax.valueId !== undefined) {
      const numId = typeof ax.valueId === "number" ? ax.valueId : Number(ax.valueId);
      const label = optionLabelById.get(numId);
      if (label) needles.push(label.toLowerCase());
    }
    if (needles.length > 0) {
      out.push({ attributeId: ax.attributeId, needles });
    }
  }

  for (const at of attributes) {
    const needles: string[] = [];
    if (at.extractedFrom) needles.push(at.extractedFrom.toLowerCase());
    if (at.valueText && !isBooleanish(at.valueText)) {
      needles.push(at.valueText.toLowerCase());
    } else if (at.valueId !== null && at.valueId !== undefined) {
      const numId = typeof at.valueId === "number" ? at.valueId : Number(at.valueId);
      const label = optionLabelById.get(numId);
      if (label) needles.push(label.toLowerCase());
    }
    // Booleans without an extractedFrom hint stay un-highlighted (the
    // agent inferred them with no quotable trigger phrase).
    if (needles.length > 0) {
      out.push({ attributeId: at.attributeId, needles });
    }
  }
  return out;
}

function maxLen(needles: string[]): number {
  let m = 0;
  for (const n of needles) if (n.length > m) m = n.length;
  return m;
}

function findUnclaimed(
  haystack: string,
  needle: string,
  claimed: HighlightSpan[],
): number {
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    const end = idx + needle.length;
    const overlaps = claimed.some((c) => !(end <= c.start || idx >= c.end));
    if (!overlaps) return idx;
    from = idx + 1;
  }
  return -1;
}

function isBooleanish(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === "true" || v === "false" || v === "yes" || v === "no" || v === "sí";
}

function formatNumber(n: number): string {
  // Match how product names commonly write quantities: integers without
  // trailing .0; decimals kept (8.5, 17.6).
  return Number.isInteger(n) ? String(n) : String(n);
}
