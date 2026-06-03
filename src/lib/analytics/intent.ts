/**
 * Search-intent skeleton (PostHog Analytics MVP, Prompt 5).
 *
 * A storefront visitor refines a search across several keystrokes — "running
 * shoe", "running shoes", "trail running shoe" — that all mean roughly the same
 * thing. assignIntent() labels that run with a stable `intent_group_id` so the
 * analytics layer can count distinct *intents* rather than distinct keystrokes.
 *
 * This is deliberately STRUCTURE over ACCURACY: grouping is a cheap head-noun /
 * stem heuristic, not embeddings (embeddings are deferred — see the doc). The
 * contract is what matters: same intent -> same id, new intent -> new id. The
 * heuristic can be swapped later without touching callers or the column.
 *
 * Pure + dependency-free so it runs inline on the fire-and-forget log path.
 */

export type RecentQuery = {
  /** The raw query string that was logged. */
  query: string;
  /** The intent_group_id that query was assigned. */
  intentGroupId: string;
};

// Tiny stopword set — enough to find a head noun in short product queries
// without dragging in an NLP dependency. Lowercase; English + Spanish (the two
// storefront locales) since queries arrive in either.
const STOPWORDS = new Set([
  // English
  "a", "an", "the", "of", "for", "and", "or", "with", "in", "on", "to", "my",
  "best", "new", "cheap", "buy",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "para",
  "y", "o", "con", "en", "mejor", "nuevo", "nueva", "barato", "comprar",
]);

/**
 * Reduce a query to its grouping signature: lowercase, strip punctuation,
 * drop stopwords, then crudely singularize each remaining token (trailing
 * "es"/"s" for EN, trailing "es"/"s" covers ES plurals too). Tokens are
 * sorted so word-order changes ("shoe running" vs "running shoe") don't split
 * an intent. Returns "" when nothing meaningful is left.
 */
export function intentSignature(query: string): string {
  const tokens = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents so "café" == "cafe"
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
  return Array.from(new Set(tokens)).sort().join(" ");
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function newIntentId(): string {
  // Not security-sensitive — just needs to be collision-resistant enough to
  // label a session's intent runs. Time + random keeps it sortable-ish.
  return `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Assign an intent_group_id to `newQuery` given the session's recent queries
 * (most-recent first). If the new query shares its head-noun/stem signature
 * with any recent query, it inherits that query's intent id; otherwise it
 * starts a fresh intent.
 *
 * `recentQueries` should be a small window (the route passes the last few rows
 * for this (instance_id, user_id)). An empty signature (e.g. an all-stopword
 * query) always starts a fresh intent rather than collapsing unrelated noise.
 */
export function assignIntent(
  recentQueries: RecentQuery[],
  newQuery: string
): string {
  const sig = intentSignature(newQuery);
  if (sig === "") return newIntentId();

  for (const recent of recentQueries) {
    if (recent.intentGroupId && intentSignature(recent.query) === sig) {
      return recent.intentGroupId;
    }
  }
  return newIntentId();
}
