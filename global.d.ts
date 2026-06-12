/**
 * TypeScript types for next-intl translation keys.
 *
 * `IntlMessages` extends the shape of the primary (English) message file so
 * that `useTranslations`, `getTranslations`, and `t()` calls are fully typed.
 * Unknown keys become compile errors; autocomplete works in supported editors.
 *
 * English is the official product language (messages/en.json, source of
 * truth). Spanish (messages/es.json) is parked and must mirror the same key
 * structure when re-enabled.
 */
type Messages = typeof import("./messages/en.json");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
