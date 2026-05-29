"use client";

import { useEffect, useState } from "react";

/**
 * Inline thumbnail of a probe screenshot, with click-to-enlarge into
 * a fullscreen lightbox. Used in the diagnostic report surfaces (run
 * detail + public report + page-detail comparison) to show concrete
 * evidence next to each finding.
 *
 * The URL is a public Supabase Storage URL under prospect-evidence/.
 * Privacy is provided by the unguessable run-UUID prefix.
 *
 * The lightbox shows:
 *   - The query (or other label) in kinetic yellow at the top, so the
 *     reader sees exactly what was tested before scanning the image.
 *   - An explicit Close button (top-right) — no "click anywhere"
 *     pattern, since users were missing it.
 *   - Esc key also closes for keyboard users.
 */
export function EvidenceScreenshot({
  url,
  label,
  /** Optional secondary label (e.g. variant type "synonym") rendered as
   *  a small badge under the primary label in the lightbox header. */
  sublabel,
  thumbWidth = 96,
}: {
  url: string;
  label: string;
  sublabel?: string;
  thumbWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        loading="lazy"
        onClick={() => setOpen(true)}
        style={{
          width: thumbWidth,
          height: "auto",
          borderRadius: "var(--s-radius-sm)",
          border: "0.5px solid var(--s-border)",
          cursor: "zoom-in",
          background: "#fff",
          display: "block",
          flexShrink: 0,
        }}
      />
      {open && (
        <Lightbox
          url={url}
          label={label}
          sublabel={sublabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Lightbox({
  url,
  label,
  sublabel,
  onClose,
}: {
  url: string;
  label: string;
  sublabel?: string;
  onClose: () => void;
}) {
  // Esc closes the lightbox.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.92)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        padding: 24,
      }}
    >
      {/* Header: query in kinetic yellow + optional variant-type tag + Close. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            maxWidth: "calc(100% - 120px)",
            overflow: "hidden",
          }}
        >
          {sublabel && (
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(255,255,255,0.55)",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {sublabel}
            </span>
          )}
          <span
            style={{
              color: "var(--scout-accent)",
              fontFamily: "var(--s-font-mono)",
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.02em",
              overflowWrap: "break-word",
            }}
          >
            {label}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="s-btn s-btn-primary"
          autoFocus
          style={{ fontSize: 13, padding: "8px 18px" }}
        >
          Close
        </button>
      </div>

      {/* Image area — scrollable if needed, centered. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            borderRadius: 8,
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            display: "block",
          }}
        />
      </div>
    </div>
  );
}
