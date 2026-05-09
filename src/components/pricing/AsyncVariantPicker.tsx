"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import {
  searchVariantsForMapRule,
  type MapRuleSourceType,
  type VariantSearchResult,
} from "@/lib/actions/pricing";

/**
 * Debounced async variant picker for the MAP rule dialog.
 *
 * - Requires 2+ chars before querying.
 * - Caps results at 50 (server-side).
 * - When source_type='brand' is supplied alongside source_id, results are
 *   filtered to that brand. Provider source doesn't filter — variants
 *   aren't tied to a single provider.
 */
export function AsyncVariantPicker({
  value,
  valueLabel,
  onChange,
  sourceType,
  sourceId,
}: {
  value: number | null;
  valueLabel: string | null;
  onChange: (variantId: number | null, label: string | null) => void;
  sourceType: MapRuleSourceType;
  sourceId: number | null;
}) {
  const t = useTranslations("pricing.mapRules.variantPicker");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, startSearch] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrap.current) return;
      if (!wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Debounced search — fires 250ms after typing stops. Below the 2-char
  // threshold we skip the timer entirely; results are cleared by the
  // setQueryValue helper at the input edge so the effect body never has
  // to call setState synchronously.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        const res = await searchVariantsForMapRule(trimmed, sourceType, sourceId);
        if (res.ok) setResults(res.variants);
        else setResults([]);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, sourceType, sourceId]);

  function setQueryValue(v: string) {
    setQuery(v);
    if (v.trim().length < 2) setResults([]);
  }

  function pick(v: VariantSearchResult) {
    onChange(v.variant_id, v.label);
    setOpen(false);
    setQuery("");
  }

  function clearSelection() {
    onChange(null, null);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      {value !== null && valueLabel ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            background: "var(--scout-accent-50)",
            border: "1px solid var(--scout-accent)",
            borderRadius: "var(--s-radius-md)",
            fontSize: 13,
            color: "var(--scout-accent-800)",
          }}
        >
          <span style={{ flex: 1 }}>{valueLabel}</span>
          <button
            type="button"
            onClick={clearSelection}
            aria-label={t("clear")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--scout-accent-800)",
              padding: 2,
            }}
          >
            <Icon icon={X} size={14} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--s-text-tertiary)",
              pointerEvents: "none",
            }}
          >
            <Icon icon={Search} size={14} strokeWidth={1.75} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQueryValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={t("placeholder")}
            style={{
              width: "100%",
              padding: "8px 12px 8px 32px",
              fontSize: 14,
              border: "1px solid var(--s-border-strong)",
              borderRadius: "var(--s-radius-md)",
              background: "var(--s-surface)",
              color: "var(--s-text)",
            }}
          />
        </div>
      )}

      {open && value === null ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid var(--s-border-strong)",
            borderRadius: "var(--s-radius-md)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: 280,
            overflowY: "auto",
            zIndex: 100,
          }}
        >
          {query.trim().length < 2 ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                textAlign: "center",
              }}
            >
              {t("hintMinChars")}
            </div>
          ) : searching ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                textAlign: "center",
              }}
            >
              {t("searching")}
            </div>
          ) : results.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                textAlign: "center",
              }}
            >
              {t("noResults")}
            </div>
          ) : (
            results.map((v) => (
              <button
                key={v.variant_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(v);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: 13,
                  background: "transparent",
                  color: "var(--s-text)",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--s-surface-alt)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {v.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
