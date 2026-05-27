/**
 * Renders the user-defined "Search tests" results for a diagnostic
 * run — one block per test entry, expanded with each variant's
 * query, result count, top 3 result names, screenshot, and judgment.
 *
 * Shared between run detail, page detail, and the public report so
 * the same evidence renders identically across surfaces.
 */
import { EvidenceScreenshot } from "@/components/diagnostic/EvidenceScreenshot";

export type SearchTestVariantResult = {
  variant_id: number;
  variant_type: string;
  query_text: string;
  results_returned: boolean;
  result_count_estimate: number | null;
  top_result_names: string[];
  screenshot_url: string | null;
  confidence: number | null;
  verdict_reason: string | null;
};

export type SearchTestEntryGroup = {
  entry_id: number;
  intent_label: string;
  variants: SearchTestVariantResult[];
};

const VARIANT_COLORS: Record<string, string> = {
  canonical: "var(--scout-accent)",
  typo: "#facc15",
  synonym: "#60a5fa",
  plural: "#a78bfa",
  partial: "#f97316",
};

export function SearchTestsBody({ entries }: { entries: SearchTestEntryGroup[] }) {
  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          fontSize: 13,
          color: "var(--s-text-tertiary)",
        }}
      >
        No search-test entries ran on this scan. Add entries on the prospect&apos;s
        vocabulary page — the next scan picks them up automatically.
      </div>
    );
  }
  return (
    <div>
      {entries.map((entry) => (
        <SearchEntryCard key={entry.entry_id} entry={entry} />
      ))}
    </div>
  );
}

function SearchEntryCard({ entry }: { entry: SearchTestEntryGroup }) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: "0.5px solid var(--s-border)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        {entry.intent_label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entry.variants.map((v) => (
          <VariantResultRow key={v.variant_id} variant={v} />
        ))}
      </div>
    </div>
  );
}

function VariantResultRow({ variant }: { variant: SearchTestVariantResult }) {
  const judgment = judgeVariant(variant.variant_type, variant.results_returned);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr auto 140px",
        gap: 12,
        alignItems: "center",
        padding: "8px 10px",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: VARIANT_COLORS[variant.variant_type] ?? "#888",
          }}
        />
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--s-text-tertiary)",
            fontWeight: 600,
          }}
        >
          {variant.variant_type}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--s-font-mono)",
            fontSize: 12,
            color: "var(--s-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {variant.query_text}
        </div>
        {variant.top_result_names.length > 0 && (
          <div
            style={{
              fontSize: 10,
              color: "var(--s-text-tertiary)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            top: {variant.top_result_names.slice(0, 3).join(" · ")}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--s-font-mono)",
            color: variant.results_returned
              ? "var(--s-text)"
              : "var(--s-text-tertiary)",
            fontWeight: 600,
          }}
        >
          {variant.result_count_estimate != null
            ? `${variant.result_count_estimate} results`
            : variant.results_returned
              ? "results"
              : "no results"}
        </span>
        {variant.screenshot_url && (
          <EvidenceScreenshot
            url={variant.screenshot_url}
            label={`${variant.variant_type}: ${variant.query_text}`}
            thumbWidth={64}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: judgment.color,
          }}
        >
          {judgment.label}
        </div>
        {variant.confidence != null && (
          <ConfidenceBadge
            confidence={variant.confidence}
            reason={variant.verdict_reason ?? ""}
          />
        )}
      </div>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
  reason,
}: {
  confidence: number;
  reason: string;
}) {
  // ≥80 green (trusted), 50-79 amber (review), <50 red (low confidence)
  const tier =
    confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low";
  const palette = {
    high: { bg: "rgba(34,197,94,0.10)", color: "var(--s-success-text, #16a34a)" },
    medium: { bg: "rgba(250,204,21,0.12)", color: "var(--s-warning-text, #ca8a04)" },
    low: { bg: "rgba(239,68,68,0.10)", color: "var(--s-danger-text, #dc2626)" },
  }[tier];
  return (
    <span
      title={reason}
      style={{
        fontSize: 9,
        fontFamily: "var(--s-font-mono)",
        padding: "1px 6px",
        borderRadius: 4,
        background: palette.bg,
        color: palette.color,
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      {confidence}% confidence
    </span>
  );
}

/**
 * Per-variant judgment driven by (variant_type, results_returned):
 *   canonical → expects results; no results = ❌
 *   typo      → expects results (proves typo tolerance works); 0 = ❌
 *   synonym   → expects results (proves synonym understanding); 0 = ❌
 *   plural / partial → expects results; 0 = ⚠ WEAK
 */
function judgeVariant(
  variantType: string,
  resultsReturned: boolean,
): { label: string; color: string } {
  if (resultsReturned) return { label: "OK", color: "var(--s-success)" };
  if (variantType === "canonical")
    return { label: "FAIL — no results", color: "var(--s-danger)" };
  if (variantType === "typo")
    return { label: "FAIL — no typo tolerance", color: "var(--s-danger)" };
  if (variantType === "synonym")
    return { label: "FAIL — synonym not understood", color: "var(--s-danger)" };
  return { label: "WEAK — no results", color: "#d97706" };
}

// ── Server-side loader (for use in server components) ──────────────────────

/**
 * Loads + groups search_test_result rows for a given run, ordered by
 * entry then canonical-first variant.
 *
 * Pass `supabase` from the caller (server-component handles both authd
 * and anon clients).
 */
type RawVariant = {
  variant_id: number;
  variant_type: string;
  query_text: string;
  sort_order: number;
  entry: { entry_id: number; intent_label: string }
    | { entry_id: number; intent_label: string }[]
    | null;
};
type RawResult = {
  result_id: number;
  results_returned: boolean;
  result_count_estimate: number | null;
  top_result_names: string[];
  screenshot_url: string | null;
  latency_ms: number | null;
  confidence: number | null;
  verdict_reason: string | null;
  variant: RawVariant | RawVariant[] | null;
};

export function groupSearchTestResults(rows: RawResult[]): SearchTestEntryGroup[] {
  const byEntry = new Map<number, SearchTestEntryGroup>();
  for (const r of rows) {
    const variant = Array.isArray(r.variant) ? r.variant[0] : r.variant;
    if (!variant) continue;
    const entry = Array.isArray(variant.entry) ? variant.entry[0] : variant.entry;
    if (!entry) continue;
    const group =
      byEntry.get(entry.entry_id) ??
      { entry_id: entry.entry_id, intent_label: entry.intent_label, variants: [] };
    group.variants.push({
      variant_id: variant.variant_id,
      variant_type: variant.variant_type,
      query_text: variant.query_text,
      results_returned: r.results_returned,
      result_count_estimate: r.result_count_estimate,
      top_result_names: r.top_result_names,
      screenshot_url: r.screenshot_url,
      confidence: r.confidence,
      verdict_reason: r.verdict_reason,
    });
    byEntry.set(entry.entry_id, group);
  }
  for (const group of byEntry.values()) {
    group.variants.sort((a, b) => {
      if (a.variant_type === "canonical") return -1;
      if (b.variant_type === "canonical") return 1;
      return 0;
    });
  }
  return Array.from(byEntry.values());
}

export const SEARCH_TEST_RESULT_SELECT =
  "result_id, results_returned, result_count_estimate, top_result_names, screenshot_url, latency_ms, confidence, verdict_reason, variant:search_test_variant(variant_id, variant_type, query_text, sort_order, entry:search_test_entry(entry_id, intent_label))";
