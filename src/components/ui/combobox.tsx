"use client";

import { useState, useRef, useEffect } from "react";

export type ComboboxOption = {
  value: number | string;
  label: string;
  hint?: string;
};

type Props = {
  options: ComboboxOption[];
  value: number | string | null;
  onValueChange: (v: number | string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
};

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.hint ?? "").toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        style={{
          width: "100%",
          height: 38,
          padding: "0 10px",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          cursor: disabled ? "default" : "pointer",
          fontFamily: "var(--s-font)",
          fontSize: 15,
          fontWeight: selected ? 500 : 400,
          color: selected ? "#000" : "var(--s-text-tertiary)",
          opacity: disabled ? 0.6 : 1,
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--s-surface)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          }}
        >
          <div style={{ padding: "6px 6px 4px" }}>
            <input
              ref={inputRef}
              type="search"
              className="s-input"
              style={{ height: 30, fontSize: 12 }}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--s-text-tertiary)" }}>
                Sin resultados
              </div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 12px",
                      border: "none",
                      background: isSelected ? "var(--s-surface-alt)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--s-font)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "var(--s-surface-alt)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = isSelected
                        ? "var(--s-surface-alt)"
                        : "transparent";
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 13, color: "var(--s-text)", fontWeight: isSelected ? 500 : 400 }}>
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span style={{ fontSize: 11, color: "var(--s-text-tertiary)", flexShrink: 0 }}>
                        {opt.hint}
                      </span>
                    )}
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--scout-accent)" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
