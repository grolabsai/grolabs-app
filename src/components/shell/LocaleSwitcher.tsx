"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";
import { routing } from "@/i18n/routing";

/**
 * Tiny ES/EN switcher for the top bar. Persists the choice via the
 * NEXT_LOCALE cookie that next-intl middleware reads on every request,
 * and replaces the current URL with the locale-aware version (so /en/…
 * appears in the URL when English is picked, /… stays clean for the
 * default locale 'es').
 *
 * Default behaviour: with no explicit pick, middleware resolves to the
 * defaultLocale ('es'). Picking ES therefore "clears" any prior English
 * preference by writing es into the cookie.
 */
export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const current = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function pick(next: string) {
    if (next === current || pending) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <select
      aria-label={t("label")}
      value={current}
      disabled={pending}
      onChange={(e) => pick(e.target.value)}
      style={{
        height: 28,
        padding: "0 26px 0 10px",
        fontSize: 12,
        fontWeight: 500,
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
        background: "var(--s-surface)",
        color: "var(--s-text-secondary)",
        cursor: pending ? "wait" : "pointer",
        outline: "none",
        appearance: "auto",
      }}
    >
      {routing.locales.map((loc) => (
        <option key={loc} value={loc}>
          {t(loc as "es" | "en")}
        </option>
      ))}
    </select>
  );
}
