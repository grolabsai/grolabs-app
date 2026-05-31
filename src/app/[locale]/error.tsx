"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

/**
 * Per-locale error boundary. Next.js renders this whenever a page
 * under /[locale]/* throws during render or hydration. Most of the
 * time the cause is a translation issue (missing key, malformed ICU
 * pattern, a runtime crash specific to one language's data shapes).
 *
 * Instead of dumping a raw stack trace at the user, we:
 *   1. Show a friendly card.
 *   2. Offer a button to switch to the other locale, which is the
 *      pragmatic fix when one language file is broken — the *other*
 *      language usually still works.
 *   3. Surface a "try again" button for transient errors (e.g.
 *      Supabase blip).
 *
 * The error is also reported to the console / error overlay so we
 * can still debug in dev.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  const otherLocale = locale === "es" ? "en" : "es";
  const [switching, setSwitching] = useState(false);

  // Log so the error surfaces in browser DevTools + Vercel client logs.
  useEffect(() => {
    console.error("[locale-error-boundary]", error);
  }, [error]);

  function switchLocale() {
    setSwitching(true);
    // Path-prefix swap: /es/foo → /en/foo and vice versa. We don't
    // know what the original "current" path was (this component is
    // rendered after an error, so router state may be unreliable),
    // so we rewrite based on the visible URL.
    try {
      const here = window.location.pathname;
      let next: string;
      if (here.startsWith(`/${locale}/`) || here === `/${locale}`) {
        next = otherLocale === "es"
          // es is the default — drop the prefix
          ? here.replace(new RegExp(`^/${locale}`), "")
          : here.replace(new RegExp(`^/${locale}`), `/${otherLocale}`);
        if (next === "") next = "/";
      } else {
        // We're on the default locale (es) without a prefix.
        next = `/${otherLocale}${here}`;
      }
      window.location.assign(next);
    } catch {
      window.location.assign(`/${otherLocale}`);
    }
  }

  // The card text is intentionally bilingual so the user can read
  // whichever they're more comfortable with — we don't know which
  // language is the "broken" one.
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
        <h2
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--gl-text-secondary)",
            margin: "0 0 20px",
          }}
        >
          Algo no salió bien en esta página
        </h2>

        <p
          style={{
            fontSize: 13,
            color: "var(--gl-text-secondary)",
            lineHeight: 1.55,
            margin: "0 0 6px",
          }}
        >
          This page hit a bug while rendering in <strong>{locale.toUpperCase()}</strong>.
          The other language usually keeps working — switching lets you continue.
        </p>
        <p
          style={{
            fontSize: 13,
            color: "var(--gl-text-secondary)",
            lineHeight: 1.55,
            margin: "0 0 24px",
          }}
        >
          Esta página falló al renderizar en <strong>{locale.toUpperCase()}</strong>.
          El otro idioma suele seguir funcionando — cambiá para continuar.
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={switchLocale}
            disabled={switching}
            style={{ minWidth: 200 }}
          >
            {switching
              ? "…"
              : `Switch to ${otherLocale.toUpperCase()} · Cambiar a ${otherLocale.toUpperCase()}`}
          </button>
          <button
            type="button"
            className="s-btn"
            onClick={() => reset()}
            disabled={switching}
          >
            Try again · Reintentar
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
