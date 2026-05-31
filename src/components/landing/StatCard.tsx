/**
 * StatCard — Engineered Luxury stat-callout card.
 *
 * Ported from the Claude Design handoff (`docs/design/stat-card-2-3x-search-conversion.html`).
 * The card's hero feature is the hand-drawn marker highlighter: an
 * inline SVG that runs a yellow rectangle through an
 * feTurbulence + feDisplacementMap filter so the edges read as a
 * real brush stroke instead of a clean CSS box.
 *
 * Composition:
 *   <StatCard
 *     figure="2–3×"
 *     eyebrow="Search conversion uplift with catalog & search optimization"
 *   >
 *     Users who search convert 2–3× more often than those who don&rsquo;t&mdash;
 *     <Highlight>if they find what they want.</Highlight>
 *   </StatCard>
 *
 * The body slot takes any ReactNode so consumers can drop in multiple
 * <Highlight> spans, links, or formatted runs without the component
 * having to know the shape of the copy in advance.
 *
 * NOTE: The marker SVG uses %23 (URL-encoded #) for the yellow hex
 * value because background-image data URLs interpret # as fragment
 * boundary. Keep that encoding if you swap the color.
 */

import type { ReactNode } from "react";

const MARKER_SVG = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 40' preserveAspectRatio='none'><defs><filter id='r' x='-5%25' y='-25%25' width='110%25' height='150%25'><feTurbulence type='fractalNoise' baseFrequency='0.045 0.13' numOctaves='2' seed='4'/><feDisplacementMap in='SourceGraphic' scale='5'/></filter></defs><rect x='3' y='6' width='194' height='28' fill='%23fae194' filter='url(%23r)' opacity='0.95'/></svg>`;

export function StatCard({
  figure,
  eyebrow,
  children,
}: {
  /** Big hero figure — rendered in Permanent Marker. e.g. "2–3×". */
  figure: ReactNode;
  /** Small caps eyebrow above the body. */
  eyebrow: ReactNode;
  /** Body copy with optional <Highlight> spans inside. */
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--gl-bg-deeper)",
        border: "1px solid var(--gl-border)",
        borderRadius: 14,
        padding: "40px 44px",
        maxWidth: 720,
        width: "100%",
        fontFamily: "var(--gl-font)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--gl-font-brand)",
          fontSize: 56,
          color: "var(--gl-text)",
          lineHeight: 1,
          letterSpacing: "0.005em",
          marginBottom: 22,
        }}
      >
        {figure}
      </div>
      <div
        style={{
          fontFamily: "var(--gl-font-mono)",
          fontSize: 13,
          color: "var(--gl-accent)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          lineHeight: 1.4,
          marginBottom: 22,
        }}
      >
        {eyebrow}
      </div>
      <p
        style={{
          fontFamily: "var(--gl-font)",
          fontSize: 22,
          lineHeight: 1.5,
          margin: 0,
          color: "var(--gl-text-strong)",
        }}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * <Highlight>…</Highlight> — wrap a phrase to apply the hand-drawn
 * marker. Color flips to black on the yellow swipe.
 *
 * box-decoration-break: clone makes the highlight re-paint on every
 * line a multi-line span breaks across, so the marker shape looks
 * intentional per line rather than as one stretched box.
 */
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        backgroundImage: `url("${MARKER_SVG}")`,
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 110%",
        backgroundPosition: "center 52%",
        color: "#000000",
        padding: "2px 10px 3px 10px",
        fontWeight: 500,
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      }}
    >
      {children}
    </span>
  );
}
