"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/**
 * Single-select Combobox.
 *
 * Behaviour:
 *   - Closed state: shows the selected option's label (or the placeholder).
 *   - Click anywhere on the trigger or the chevron → toggles the dropdown.
 *   - Open state: dropdown shows ALL options, scrollable. The trigger turns
 *     into a search input — typing filters in place. Selected row is
 *     highlighted and shows a checkmark.
 *   - Click an option → selects it, closes.
 *   - Click outside → closes.
 *
 * Strings are prop-driven (placeholder, emptyText, searchAriaLabel) so
 * the host page passes translated text via t().
 */

export type ComboboxOption = { id: number; label: string };

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
  options: ComboboxOption[];
  placeholder: string;
  /** Shown when the search returns nothing. Defaults to "—". */
  emptyText?: string;
  /** Aria label for the search input when open. */
  searchAriaLabel?: string;
  /** Visual error state. */
  invalid?: boolean;
  disabled?: boolean;
};

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  emptyText = "—",
  searchAriaLabel,
  invalid = false,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value === null ? null : options.find((o) => o.id === value) ?? null;

  // Close on outside click; only attached while open.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrap.current) return;
      if (!wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Focus the search input as soon as we open.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function pick(id: number) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      {open ? (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          aria-label={searchAriaLabel}
          placeholder={selected?.label ?? placeholder}
          disabled={disabled}
          style={triggerStyle(invalid)}
        />
      ) : (
        <button
          type="button"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          style={{
            ...triggerStyle(invalid),
            textAlign: "left",
            cursor: disabled ? "not-allowed" : "pointer",
            color: selected ? "var(--s-text)" : "var(--s-text-tertiary)",
            fontWeight: selected ? 500 : 400,
          }}
        >
          {selected?.label ?? placeholder}
        </button>
      )}

      {/* Chevron is purely decorative when closed (the whole trigger is
          clickable); clickable when open so the user can collapse without
          hunting for outside-click. */}
      <span
        onClick={() => {
          if (disabled) return;
          if (open) {
            setOpen(false);
            setQuery("");
          } else {
            setOpen(true);
          }
        }}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--s-text-tertiary)",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          padding: 2,
        }}
      >
        <Icon icon={ChevronDown} size={12} />
      </span>

      {open ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "0.5px solid var(--s-border-strong)",
            borderRadius: "var(--s-radius-md)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 100,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                textAlign: "center",
              }}
            >
              {emptyText}
            </div>
          ) : (
            filtered.map((o) => {
              const isSelected = o.id === value;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    // Prevent the input from losing focus before we
                    // process the click (which would close the dropdown
                    // via outside-click before pick runs).
                    e.preventDefault();
                    pick(o.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: 13,
                    textAlign: "left",
                    background: isSelected ? "var(--scout-accent-50)" : "transparent",
                    color: isSelected ? "var(--scout-accent-800)" : "var(--s-text)",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "var(--s-surface-alt)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span>{o.label}</span>
                  {isSelected ? <Icon icon={Check} size={14} /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function triggerStyle(invalid: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 40,
    padding: "10px 32px 10px 12px",
    fontSize: 15,
    border: `0.5px solid ${invalid ? "var(--s-danger)" : "var(--s-border)"}`,
    borderRadius: "var(--s-radius-md)",
    background: "white",
    outline: "none",
  };
}
