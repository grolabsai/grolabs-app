"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { Attribute } from "@/components/import/ImportWizard";
import { appendAttributeParsingHint } from "@/app/[locale]/(app)/catalog/attributes/actions";
import type {
  ProposedAttributeCell,
  ProposedAxisCell,
  ProposedProductBaseRow,
} from "@/lib/import/types";
import { colorForAttribute } from "@/lib/import/attribute-colors";

/**
 * Stage proposed `parsing_hint` updates to the user after a successful
 * import. For each attribute the agent extracted with a literal source
 * span (`extractedFrom`), we collect those spans and offer to append
 * them to the attribute's hint so the agent gets smarter on the next
 * import. Non-blocking — the user can click Accept on a row, dismiss
 * the panel, or just navigate away. Nothing is auto-written.
 *
 * Suggestions surface only NEW terms (case-insensitive substring check
 * vs the current hint). If the agent caught nothing new for an
 * attribute, that attribute doesn't show up in the panel.
 */
export function HintReviewPanel({
  bases,
  attributes,
}: {
  bases: ProposedProductBaseRow[];
  attributes: Attribute[];
}) {
  const t = useTranslations("import.wizard.hintReview");
  const [pending, startTransition] = useTransition();
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  const attrById = useMemo(() => {
    const m = new Map<number, Attribute>();
    for (const a of attributes) m.set(a.attribute_id, a);
    return m;
  }, [attributes]);

  const suggestions = useMemo(
    () => collectSuggestions(bases, attrById),
    [bases, attrById],
  );

  if (dismissed || suggestions.length === 0) return null;

  function acceptOne(attributeId: number, terms: string[]) {
    startTransition(async () => {
      const r = await appendAttributeParsingHint(attributeId, terms);
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
        return;
      }
      setAccepted((prev) => new Set(prev).add(attributeId));
      toast.success(t("saved"));
    });
  }

  return (
    <div className="s-card" style={{ padding: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          borderBottom: "0.5px solid var(--s-border)",
        }}
      >
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("title")}</p>
          <p style={{ fontSize: 11, color: "var(--s-text-tertiary)", margin: "2px 0 0" }}>
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--s-text-tertiary)",
            fontSize: 13,
          }}
        >
          {t("dismiss")}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {suggestions.map((s) => {
          const accent = colorForAttribute(s.attributeId);
          const isAccepted = accepted.has(s.attributeId);
          return (
            <div
              key={s.attributeId}
              style={{
                padding: "12px 18px",
                borderBottom: "0.5px solid var(--s-border)",
                opacity: isAccepted ? 0.55 : 1,
                display: "grid",
                gridTemplateColumns: "minmax(160px, 200px) 1fr auto",
                gap: 16,
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: accent.fg,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{s.attributeName}</div>
                  <div style={{ fontSize: 10, color: "var(--s-text-tertiary)" }}>
                    {s.attributeCode}
                  </div>
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginBottom: 4 }}>
                  {t("newTerms")}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {s.terms.map((term) => (
                    <span
                      key={term}
                      style={{
                        background: accent.bg,
                        color: accent.fg,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                disabled={pending || isAccepted}
                onClick={() => acceptOne(s.attributeId, s.terms)}
                className="s-btn s-btn-secondary"
                style={{ height: 28, padding: "0 12px", fontSize: 12 }}
              >
                {isAccepted ? t("accepted") : t("accept")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

type Suggestion = {
  attributeId: number;
  attributeCode: string;
  attributeName: string;
  /** New terms to append, deduped against the current hint. */
  terms: string[];
};

function collectSuggestions(
  bases: ProposedProductBaseRow[],
  attrById: Map<number, Attribute>,
): Suggestion[] {
  const termsByAttr = new Map<number, Set<string>>();

  function add(attributeId: number | string, term: string | null) {
    if (!term) return;
    const id = typeof attributeId === "number" ? attributeId : Number(attributeId);
    if (!Number.isFinite(id)) return;
    const set = termsByAttr.get(id) ?? new Set<string>();
    set.add(term.trim());
    termsByAttr.set(id, set);
  }

  for (const b of bases) {
    for (const a of b.baseAttributes) add(a.attributeId, a.extractedFrom);
    for (const v of b.variants) {
      for (const ax of v.axes) add(ax.attributeId, ax.extractedFrom);
      for (const at of v.attributes) add(at.attributeId, at.extractedFrom);
    }
  }

  const out: Suggestion[] = [];
  for (const [attrId, terms] of termsByAttr) {
    const attr = attrById.get(attrId);
    if (!attr) continue;
    const currentLower = (attr.parsing_hint ?? "").toLowerCase();
    const newTerms = Array.from(terms).filter(
      (t) => t.length > 0 && !currentLower.includes(t.toLowerCase()),
    );
    if (newTerms.length === 0) continue;
    // De-dupe by lowercase form, preserve original casing on first match.
    const seen = new Set<string>();
    const finalTerms: string[] = [];
    for (const term of newTerms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      finalTerms.push(term);
    }
    out.push({
      attributeId: attrId,
      attributeCode: attr.attribute_code,
      attributeName: attr.attribute_name,
      terms: finalTerms,
    });
  }
  // Stable sort by attribute name for predictable display.
  out.sort((a, b) => a.attributeName.localeCompare(b.attributeName));
  return out;
}
