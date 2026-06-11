import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

/**
 * i18n routing configuration.
 *
 * Architecture decisions (see CLAUDE.md for rationale):
 *   - defaultLocale: 'en'  — English is the official product language; 'en'
 *     URLs have no prefix (/catalog/products, not /en/catalog/products).
 *   - locales: ['en']      — English-only for now. The locale switcher is
 *     removed from the UI. Spanish is fully translated (messages/es.json) and
 *     parked, ready to re-enable later.
 *   - localePrefix: 'as-needed' — the default locale gets clean URLs.
 *   - Canonical paths are English-ASCII slugs (catalog, products, settings)
 *     regardless of active locale.
 *
 * To re-enable Spanish later:
 *   1. Add 'es' back to `locales` below.
 *   2. Re-mount <LocaleSwitcher /> in src/components/shell/TopBar.tsx
 *      (the component is kept, just unused).
 *   3. Restore the bilingual switch affordance in src/app/[locale]/error.tsx.
 */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

/**
 * Locale-aware navigation utilities.
 *
 * Import these instead of the plain next/navigation equivalents so that
 * Link hrefs and redirect() calls automatically carry the current locale.
 *
 * Usage:
 *   import { Link, redirect, usePathname, useRouter } from '@/i18n/routing';
 *
 * Migration from next/navigation is intentionally deferred — existing pages
 * use the plain variants and work correctly for 'es' (default, no-prefix).
 * Migrate on a screen-by-screen basis as screens are built out.
 */
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
