"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { reportMissingTranslation } from "@/lib/i18n/missing-translation";

/**
 * Thin wrapper around `NextIntlClientProvider` that installs our shared
 * `onError` + `getMessageFallback`. Both are functions and so cannot be
 * passed from a Server Component — defining them inside this Client
 * Component is the standard next-intl pattern for the case.
 *
 * Behaviour for missing messages:
 *   - `onError`: silenced for `MISSING_MESSAGE` (default next-intl behaviour
 *     would re-throw in some contexts and crash the page). Other error
 *     codes (formatting, invalid keys, …) still console.error so they
 *     remain visible during development.
 *   - `getMessageFallback`: returns `[missing: namespace.key]` so the page
 *     still renders something the operator can spot, while
 *     `reportMissingTranslation` queues the key for the Activity Stream
 *     panel via `MissingTranslationListener`.
 */
export function IntlClientProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={(error) => {
        if (error.code === "MISSING_MESSAGE") return;
        console.error(error);
      }}
      getMessageFallback={({ namespace, key }) => {
        reportMissingTranslation({ namespace: namespace ?? "", key, locale });
        return `[missing: ${namespace ? namespace + "." : ""}${key}]`;
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
