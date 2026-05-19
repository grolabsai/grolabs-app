import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import { reportMissingTranslation } from "@/lib/i18n/missing-translation";

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
 *
 * onError + getMessageFallback are the server-side twin of what
 * `IntlClientProvider` installs for the client bundle. A missing
 * message logs (so it surfaces in Vercel/server logs) and renders as
 * `[missing: namespace.key]` instead of throwing during SSR. The
 * client-side miss separately bubbles into the Activity Stream.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  const resolvedLocale = locale;

  return {
    locale: resolvedLocale,
    messages: (await import(`../../messages/${resolvedLocale}.json`)).default,
    onError(error) {
      // String literal instead of IntlErrorCode enum import to keep
      // the server bundle free of use-intl's React client hooks.
      if (error.code === "MISSING_MESSAGE") return;
      console.error(error);
    },
    getMessageFallback({ namespace, key }) {
      reportMissingTranslation({
        namespace: namespace ?? "",
        key,
        locale: resolvedLocale,
      });
      return `[missing: ${namespace ? namespace + "." : ""}${key}]`;
    },
  };
});
