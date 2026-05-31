"use client";

import { Fragment } from "react";

import { colorForAttribute } from "@/lib/import/attribute-colors";
import { highlightSpans } from "@/lib/import/highlight-source";
import type {
  ProposedAttributeCell,
  ProposedAxisCell,
} from "@/lib/import/types";

/**
 * Render a variant's source product name with the substrings that
 * produced each extracted axis/attribute value highlighted in the same
 * color as their target cell. Lets the reviewer see at a glance what
 * the agent pulled out of the source string.
 */
export function SourceName({
  text,
  axes,
  attributes,
  optionLabelById,
  tooltip,
}: {
  text: string;
  axes: ProposedAxisCell[];
  attributes: ProposedAttributeCell[];
  optionLabelById: Map<number, string>;
  tooltip?: string;
}) {
  const spans = highlightSpans(text, axes, attributes, optionLabelById);

  // Build a list of (chunk, color?) pairs covering the whole string.
  const pieces: Array<{ text: string; accent: { bg: string; fg: string } | null }> = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) pieces.push({ text: text.slice(cursor, s.start), accent: null });
    pieces.push({
      text: text.slice(s.start, s.end),
      accent: colorForAttribute(s.attributeId),
    });
    cursor = s.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), accent: null });

  return (
    <div
      style={{
        marginTop: 4,
        fontSize: 11,
        fontStyle: "italic",
        color: "var(--gl-text-tertiary)",
        lineHeight: 1.3,
        fontFamily:
          "ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
      title={tooltip}
    >
      {pieces.map((p, i) =>
        p.accent ? (
          <span
            key={i}
            style={{
              background: p.accent.bg,
              color: p.accent.fg,
              padding: "1px 4px",
              borderRadius: 3,
              fontStyle: "normal",
              fontWeight: 500,
            }}
          >
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </div>
  );
}
