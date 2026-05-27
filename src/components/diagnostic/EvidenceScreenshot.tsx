"use client";

import { useState } from "react";

/**
 * Inline thumbnail of a probe screenshot, with click-to-enlarge into
 * a fullscreen lightbox. Used in the diagnostic report surfaces (run
 * detail + public report + page-detail comparison) to show concrete
 * evidence next to each finding.
 *
 * The URL is a public Supabase Storage URL under prospect-evidence/.
 * Privacy is provided by the unguessable run-UUID prefix.
 */
export function EvidenceScreenshot({
  url,
  label,
  thumbWidth = 96,
}: {
  url: string;
  label: string;
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
      {open && <Lightbox url={url} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        cursor: "zoom-out",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          maxWidth: "100%",
          maxHeight: "100%",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "100%",
            maxHeight: "80vh",
            borderRadius: 8,
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            cursor: "default",
          }}
        />
        <div
          style={{
            color: "#fff",
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          {label} · click anywhere to close
        </div>
      </div>
    </div>
  );
}
