/**
 * Missing-translation collector.
 *
 * Wired into `next-intl`'s `onError` / `getMessageFallback` (see
 * `src/components/i18n/IntlClientProvider.tsx` for the client side and
 * `src/i18n/request.ts` for the server side). When a `t()` call hits a
 * key that doesn't exist in the active locale's bundle, this module:
 *
 *  1. Deduplicates by `${locale}|${namespace}.${key}` so the same hole
 *     reported on every render only fires once.
 *  2. On the server: logs to console so the issue shows up in deploy
 *     logs.
 *  3. On the client: notifies subscribers via a microtask (deferred to
 *     after render, so subscribers can safely call `setState`).
 *
 * The Activity Stream subscribes via
 * `src/components/i18n/MissingTranslationListener.tsx` and turns each
 * event into a warning entry in the right-side Assistant panel, so an
 * operator sees the missing key and the affected locale instead of a
 * blank crash page.
 */

export type MissingTranslationEvent = {
  /** Bundle the missing key was looked up in. Empty when the call site
   *  used `useTranslations()` with no namespace. */
  namespace: string;
  /** Dotted key path *within* the namespace, as passed to `t()`. */
  key: string;
  /** The active locale at the time of the miss (e.g. "en"). */
  locale: string;
};

type Subscriber = (event: MissingTranslationEvent) => void;

const seen = new Set<string>();
const subscribers = new Set<Subscriber>();

function signature(event: MissingTranslationEvent): string {
  return `${event.locale}|${event.namespace}.${event.key}`;
}

export function reportMissingTranslation(event: MissingTranslationEvent): void {
  const sig = signature(event);
  if (seen.has(sig)) return;
  seen.add(sig);

  if (typeof window === "undefined") {
    console.error(
      `[i18n] Missing translation: ${event.namespace ? event.namespace + "." : ""}${event.key} (${event.locale})`,
    );
    return;
  }

  // Defer to a microtask so subscribers (React listeners) don't update
  // state during the parent's render pass — `getMessageFallback` is
  // invoked synchronously from `t()` inside render.
  queueMicrotask(() => {
    for (const s of subscribers) s(event);
  });
}

export function subscribeMissingTranslations(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
