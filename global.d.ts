/**
 * TypeScript types for next-intl translation keys.
 *
 * `IntlMessages` extends the shape of the primary (Spanish) message file so
 * that `useTranslations`, `getTranslations`, and `t()` calls are fully typed.
 * Unknown keys become compile errors; autocomplete works in supported editors.
 *
 * Keep this file in sync with messages/es.json (the source of truth).
 * English messages must mirror the same key structure.
 */
type Messages = typeof import("./messages/es.json");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
