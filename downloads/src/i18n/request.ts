import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * Server-side i18n request configuration.
 *
 * Wired into Next.js via the next-intl plugin in next.config.ts.
 * Called once per request; returns the locale and the corresponding
 * message bundle.
 *
 * Fallback: if the locale extracted from the URL is missing or invalid
 * (shouldn't happen once middleware is in place, but belt-and-suspenders),
 * we fall back to the default locale so the page renders rather than
 * throwing.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (
      await import(`../../messages/${locale}.json`)
    ).default,
  };
});
