"use client";

/**
 * Top-level global error boundary. Next.js renders this when an error
 * is thrown in the root <html>/<body> tree itself — including when
 * the locale layout or the i18n provider fails to initialize. The
 * per-locale boundary at app/[locale]/error.tsx handles the common
 * case of a page-level crash; this one is the last line of defense.
 *
 * Intentionally minimal: no translations, no providers, no styling
 * dependencies — anything we lean on here could itself be the cause
 * of the error.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#131316",
          color: "#EDEAE0",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 16 }} aria-hidden>
            ⚠
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong · Algo salió mal
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "rgba(237, 234, 224, 0.6)",
              lineHeight: 1.55,
              margin: "0 0 24px",
            }}
          >
            The page hit an error before it could load. Try again, or use the
            language switch below.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "8px 16px",
                background: "#fae194",
                color: "#131316",
                border: "none",
                borderRadius: 8,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again · Reintentar
            </button>
            <button
              type="button"
              onClick={() => {
                // Force-swap locale prefix in the URL.
                try {
                  const here = window.location.pathname;
                  const next = here.startsWith("/en")
                    ? here.replace(/^\/en/, "") || "/"
                    : "/en" + here;
                  window.location.assign(next);
                } catch {
                  window.location.assign("/");
                }
              }}
              style={{
                padding: "8px 16px",
                background: "transparent",
                color: "#EDEAE0",
                border: "0.5px solid rgba(255,255,255,0.16)",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Switch language
            </button>
          </div>
          {error?.digest && (
            <div
              style={{
                marginTop: 24,
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                color: "rgba(237, 234, 224, 0.4)",
              }}
            >
              ref: {error.digest}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
