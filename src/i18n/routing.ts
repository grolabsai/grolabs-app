import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

/**
 * i18n routing configuration.
 *
 * Architecture decisions (see CLAUDE.md for rationale):
 *   - defaultLocale: 'es'  — Spanish is the product language; 'es' URLs have
 *     no prefix (/catalog/products, not /es/catalog/products).
 *   - locales: ['es', 'en'] — English planned; not active until messages are
 *     fully populated and UI is validated.
 *   - localePrefix: 'as-needed' — default locale gets clean URLs; non-default
 *     locales get a prefix (/en/catalog/products).
 *   - Canonical paths are English-ASCII slugs (catalog, products, settings)
 *     regardless of active locale. No /es/catalogo URL ever exists.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
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
