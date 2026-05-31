"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Plus, Loader2 } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/**
 * Single-select Combobox with optional inline-create.
 *
 * Base behaviour:
 *   - Closed state: shows the selected option's label (or the placeholder).
 *   - Click anywhere on the trigger or the chevron → toggles the dropdown.
 *   - Open state: dropdown shows ALL options, scrollable. The trigger turns
 *     into a search input — typing filters in place. Selected row is
 *     highlighted and shows a checkmark.
 *   - Click an option → selects it, closes.
 *   - Click outside → closes.
 *
 * Inline-create (opt-in via the `onCreate` prop):
 *   - When the user types a value that doesn't match any option and an
 *     `onCreate` handler is provided, a "+ Crear «query»" row appears at
 *     the bottom of the dropdown.
 *   - Clicking it (or pressing Enter while focused on the search) calls
 *     `onCreate(query)`. The component shows a spinner on the create row
 *     until the promise resolves.
 *   - On success the new option is automatically selected via onChange
 *     and the dropdown closes.
 *   - The host is responsible for making the new option appear in the
 *     `options` array on subsequent renders (typically by appending to the
 *     parent state inside the `onCreate` callback before resolving).
 *
 * Strings are prop-driven (placeholder, emptyText, createLabel,
 * searchAriaLabel) so the host page passes translated text via t().
 */

export type ComboboxOption = { id: number; label: string };

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
  options: ComboboxOption[];
  placeholder: string;
  /** Shown when the search returns nothing AND inline-create is not enabled
   *  (or the query is empty). Defaults to "—". */
  emptyText?: string;
  /** Aria label for the search input when open. */
  searchAriaLabel?: string;
  /** Visual error state. */
  invalid?: boolean;
  disabled?: boolean;
  /**
   * When set, the dropdown shows a "+ Crear «query»" row whenever the
   * search has no matches. The handler should persist the new entry and
   * return its id+label. On success the option is auto-selected. On
   * failure return null and surface the error yourself (a toast is
   * customary). The host is also responsible for adding the new option to
   * the `options` array so it appears on subsequent searches.
   */
  onCreate?: (label: string) => Promise<ComboboxOption | null>;
  /** Label template for the create row — receives the trimmed query, must
   *  return a UI string. Defaults to `Crear "{query}"`. */
  createLabel?: (query: string) => string;
};

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  emptyText = "",
  searchAriaLabel,
  invalid = false,
  disabled = false,
  onCreate,
  createLabel = (q) => `Crear "${q}"`,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
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

  // Does the current query exactly match an existing option label?
  // (Case-insensitive match — typing "hills" when "Hills" exists should
  // NOT offer to create a duplicate.)
  const trimmedQuery = query.trim();
  const exactMatch = useMemo(() => {
    if (!trimmedQuery) return null;
    const lower = trimmedQuery.toLowerCase();
    return options.find((o) => o.label.toLowerCase() === lower) ?? null;
  }, [options, trimmedQuery]);

  // Inline-create is offered when:
  //   - the host wired `onCreate`, AND
  //   - the user has typed something non-empty, AND
  //   - that something doesn't exactly match an existing option.
  // It's offered even when the filter returns partial matches — the user
  // may want a brand-new entry whose name happens to be a substring of an
  // existing one ("Hill" vs "Hill's").
  const canCreate = !!onCreate && trimmedQuery.length > 0 && exactMatch === null;

  async function runCreate() {
    if (!onCreate || !trimmedQuery || creating) return;
    setCreating(true);
    try {
      const newOpt = await onCreate(trimmedQuery);
      if (newOpt) {
        // Auto-select. The host is expected to have added the option to
        // its own state so subsequent renders include it.
        onChange(newOpt.id);
        setOpen(false);
        setQuery("");
      }
    } finally {
      setCreating(false);
    }
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
              return;
            }
            // Enter creates a new option when:
            //   - inline-create is wired,
            //   - the query doesn't match an existing option,
            //   - there are no filtered matches OR the user clearly wants
            //     a new entry (e.g. typed "Hills New" while "Hills" is a
            //     partial match).
            if (e.key === "Enter" && canCreate) {
              e.preventDefault();
              void runCreate();
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
          {filtered.length === 0 && !canCreate ? (
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
                    background: isSelected ? "var(--rre-accent-50)" : "transparent",
                    color: isSelected ? "var(--rre-accent-800)" : "var(--s-text)",
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

          {canCreate ? (
            <button
              type="button"
              role="option"
              aria-busy={creating}
              disabled={creating}
              onMouseDown={(e) => {
                e.preventDefault();
                void runCreate();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                textAlign: "left",
                background: "transparent",
                color: "var(--rre-accent-800, var(--rre-accent))",
                border: "none",
                borderTop:
                  filtered.length > 0
                    ? "0.5px solid var(--s-border)"
                    : "none",
                cursor: creating ? "wait" : "pointer",
                fontWeight: 500,
              }}
              onMouseEnter={(e) => {
                if (!creating)
                  e.currentTarget.style.background = "var(--s-surface-alt)";
              }}
              onMouseLeave={(e) => {
                if (!creating) e.currentTarget.style.background = "transparent";
              }}
            >
              <Icon icon={creating ? Loader2 : Plus} size={14} />
              <span>{createLabel(trimmedQuery)}</span>
              {creating ? (
                <span
                  aria-hidden
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "var(--s-text-tertiary)",
                  }}
                >
                  …
                </span>
              ) : null}
            </button>
          ) : null}
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
