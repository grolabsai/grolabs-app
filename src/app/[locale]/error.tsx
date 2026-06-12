"use client";

import { useEffect } from "react";

/**
 * Per-locale error boundary. Next.js renders this whenever a page
 * under /[locale]/* throws during render or hydration.
 *
 * The app is English-only for now (the locale switcher is removed), so
 * this just shows a friendly card with a "try again" button for transient
 * errors (e.g. a Supabase blip). The error is also reported to the console
 * / error overlay so we can still debug in dev.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log so the error surfaces in browser DevTools + Vercel client logs.
  useEffect(() => {
    console.error("[locale-error-boundary]", error);
  }, [error]);

  return (
    <div className="s-content">
      <div
        style={{
          maxWidth: 540,
          margin: "80px auto",
          background: "var(--gl-surface)",
          border: "0.5px solid var(--gl-border)",
          borderRadius: "var(--gl-radius-lg)",
          padding: 32,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 32,
            marginBottom: 16,
            lineHeight: 1,
          }}
          aria-hidden
        >
          ⚠
        </div>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--gl-text-strong)",
            margin: "0 0 8px",
          }}
        >
          Something went wrong on this page
        </h1>

        <p
          style={{
            fontSize: 13,
            color: "var(--gl-text-secondary)",
            lineHeight: 1.55,
            margin: "0 0 24px",
          }}
        >
          This page hit a bug while rendering. Try again — if it keeps
          happening, the reference below helps us track it down.
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={() => reset()}
            style={{ minWidth: 160 }}
          >
            Try again
          </button>
        </div>

        {error?.digest && (
          <div
            style={{
              marginTop: 24,
              fontSize: 10,
              fontFamily: "var(--gl-font-mono)",
              color: "var(--gl-text-tertiary)",
            }}
          >
            ref: {error.digest}
          </div>
        )}
      </div>
    </div>
  );
}
