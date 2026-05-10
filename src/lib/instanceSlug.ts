/**
 * Derive a URL-safe slug from a free-form instance name. Per
 * docs/policy/instance-management.md §2: lowercase, strip non-[a-z0-9],
 * collapse runs to single hyphens, trim edges. Diacritics are folded via
 * NFD so "Café" → "cafe" rather than disappearing.
 *
 * Returns the empty string when nothing usable remains (caller treats this as
 * invalid_name — covers all-whitespace, emoji-only, and pure-symbol input).
 *
 * Lives in its own module because it is consumed by both the client-side
 * dialog (live preview) and the server action (final slug + collision suffix).
 * "use server" files cannot export non-async helpers.
 */
export function deriveSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
