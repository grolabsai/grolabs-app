"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

/**
 * Google + Microsoft single sign-on buttons for the shared /login page (both
 * hosts). Per docs/policy/user-management.md §5.
 *
 * Styling (R-10): both buttons use the GroLabs design tokens — canvas surface,
 * our border, our text — NOT vendor brand colors or the official vendor button.
 * Each carries only a small MONOCHROME provider glyph (currentColor) for
 * recognition. No colored vendor logos.
 *
 * Access (R-9): sign-in only, never provisioning. Unknown emails are rejected
 * by the Before-User-Created hook (when enabled) and the layout no-access gate.
 */

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 10.9v3.1h4.4c-.2 1.2-1.5 3.4-4.4 3.4-2.7 0-4.9-2.2-4.9-5s2.2-5 4.9-5c1.5 0 2.5.6 3.1 1.2l2.1-2C15.9 4.4 14.2 3.7 12 3.7 7.7 3.7 4.2 7.2 4.2 11.5S7.7 19.3 12 19.3c4.4 0 7.4-3.1 7.4-7.5 0-.5 0-.8-.1-1.2H12z"
      />
    </svg>
  );
}

function MicrosoftGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1 1h6.6v6.6H1V1zm7.4 0H15v6.6H8.4V1zM1 8.4h6.6V15H1V8.4zm7.4 0H15V15H8.4V8.4z"
      />
    </svg>
  );
}

const BUTTON_STYLE: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 40,
  borderRadius: "var(--gl-radius-md, 8px)",
  border: "0.5px solid var(--gl-border)",
  background: "var(--gl-surface)",
  color: "var(--gl-text)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

export function SsoButtons({ next = "/" }: { next?: string }) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState<null | "google" | "azure">(null);

  async function signIn(provider: "google" | "azure") {
    setPending(provider);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        ...(provider === "azure" ? { scopes: "email openid profile" } : {}),
      },
    });
    if (error) {
      setPending(null);
      window.location.href = `/login?error=${encodeURIComponent("oauth")}`;
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "4px 0",
          color: "var(--gl-text-tertiary)",
          fontSize: 11,
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--gl-border)" }} />
        {t("ssoDivider")}
        <span style={{ flex: 1, height: 1, background: "var(--gl-border)" }} />
      </div>

      <button
        type="button"
        style={BUTTON_STYLE}
        onClick={() => signIn("google")}
        disabled={pending !== null}
        aria-label={t("google")}
      >
        <GoogleGlyph />
        {pending === "google" ? t("redirecting") : t("google")}
      </button>

      <button
        type="button"
        style={BUTTON_STYLE}
        onClick={() => signIn("azure")}
        disabled={pending !== null}
        aria-label={t("microsoft")}
      >
        <MicrosoftGlyph />
        {pending === "azure" ? t("redirecting") : t("microsoft")}
      </button>
    </div>
  );
}
