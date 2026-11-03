/**
 * Search intent grouping and reformulation classification.
 *
 * A shopper expresses ONE demand and may rewrite it several times getting
 * there -- "snwoboard" (typo), "snowboard" (fixed), "complete snowboard"
 * (narrowed). The grammar in docs/design/conversion-measurement-foundations.md
 * §3 calls that whole run one INTENT, and each rewrite inside it a
 * REFORMULATION of one of four types:
 *
 *   correcting  -- a typo repaired        -> remedy: typo tolerance
 *   narrowing   -- criteria added         -> remedy: faceting / specificity
 *   broadening  -- criteria removed       -> remedy: (results were too narrow)
 *   lateral     -- descriptors swapped    -> remedy: SYNONYMS (vocabulary gap)
 *
 * The type is not decoration. Each one points at a DIFFERENT fix, so calling a
 * typo repair a refinement prescribes faceting for a spelling problem.
 *
 * ── What this file used to do, and why it changed (2026-11-02) ──────────────
 *
 * It compared the sorted stem SET of two queries for exact equality. Traced
 * against the four types (docs/state/event-semantics-trace.md, F-1) that
 * grouped none of them: every genuine reformulation started a NEW intent, and
 * the only queries that grouped were ones that were never reformulations at all
 * -- plurals, word order, accents. So `intent_group_id` was in effect a
 * normalised query, measured and confirmed on live data: across every user-day
 * in query_log, distinct intents equalled distinct queries.
 *
 * That made `reformulation_rate` ("intents needing >=1 rewrite / intents")
 * structurally ~0 rather than merely unbuilt -- every intent held exactly one
 * query -- and left the synonym-candidate generator with no input, because the
 * lateral pairs it reads were never linked.
 *
 * Three of the four types are decidable with no semantics at all: narrowing and
 * broadening are set containment, correcting is edit distance. Only LATERAL
 * genuinely needs meaning, and it is the one the Demand-Interpretation agent is
 * for. The deferral used to cover all four; it only ever needed to cover one.
 *
 * Still deliberately STRUCTURE over ACCURACY: no embeddings, no network, no
 * dependency. The contract is what matters -- same demand -> same id, new
 * demand -> new id, and every rewrite inside a demand named. The heuristic can
 * be swapped without touching callers or columns.
 *
 * Pure + dependency-free so it runs inline on the fire-and-forget log path.
 */

export type RecentQuery = {
  /** The raw query string that was logged. */
  query: string;
  /** The intent_group_id that query was assigned. */
  intentGroupId: string;
  /**
   * When it was logged, ISO. Optional, but supply it where you have it: the
   * time bound is enforced HERE as well as in the caller's WHERE clause, so a
   * caller that forgets the clause cannot silently produce week-long intents.
   */
  at?: string | null;
};

/**
 * How two consecutive queries in one intent relate.
 *
 * `same` is not a reformulation -- it is the same demand restated (a plural, a
 * reordering, the committed search repeating its own last prefix). It groups,
 * but it is not a rewrite and must not count toward reformulation depth.
 *
 * `unrelated` is the only verdict that starts a new intent.
 */
export type Reformulation =
  | "same"
  | "correcting"
  | "narrowing"
  | "broadening"
  | "lateral"
  | "unrelated";

/** The rewrite types that are genuinely rewrites, for KPI counting. */
export const REWRITE_TYPES: readonly Reformulation[] = [
  "correcting",
  "narrowing",
  "broadening",
  "lateral",
];

/**
 * How far back a query may reach to join an intent. Matched to
 * session_assignment's 30-minute inactivity gap, so an intent cannot outlive
 * the session that contains it.
 *
 * The old window had NO time bound -- it was simply "the last 10 rows for this
 * (instance, user)" -- so a shopper returning days later could inherit an
 * intent id from a previous visit, and a "demand" could span a week.
 */
export const INTENT_WINDOW_MS = 30 * 60 * 1000;

// Tiny stopword set -- enough to find a head noun in short product queries
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

/** The stem tokens of a query, deduped, order discarded. */
export function intentTokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents so "café" == "cafe"
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t))
      .map(stem)
  );
}

/**
 * Reduce a query to its grouping signature: the stem tokens, sorted, joined.
 * Sorting discards word order so "shoe running" and "running shoe" agree.
 * Returns "" when nothing meaningful is left.
 *
 * Kept exported: it is the cheap identity test, and the trace driver and tests
 * read it directly.
 */
export function intentSignature(query: string): string {
  return Array.from(intentTokens(query)).sort().join(" ");
}

/**
 * Crude singularisation. The `-es` rule is restricted to stems that actually
 * take `-es` in English — those ending in a sibilant (s, x, z, ch, sh): boxes,
 * dishes, watches.
 *
 * It used to strip `-es` from anything, which silently broke the very example
 * this file's own header gives: "shoes" became "sho" while "shoe" stayed
 * "shoe", so `running shoe` -> `running shoes` was not a restatement but a
 * LATERAL — a vocabulary gap, which would have sent the merchant to add
 * synonyms for a plural. Caught by tests/unit/analytics/intent.test.ts.
 *
 * Known limitation, stated rather than hidden: Spanish consonant plurals
 * ("colores" -> "color") strip only the `s`, leaving "colore", which is within
 * one edit of "color" and so reads as `correcting` rather than `same`. The
 * grouping — the load-bearing part — is right either way; only the label on
 * that one case is off. A real stemmer is the fix, and is not worth a
 * dependency on this path yet.
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("es")) {
    const base = token.slice(0, -2);
    if (/(?:s|x|z|ch|sh)$/.test(base)) return base;
    return token.slice(0, -1);
  }
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/**
 * How many character errors we are willing to call a typo rather than a
 * different word.
 *
 * These are MEILISEARCH'S OWN defaults (minWordSizeForTypos: oneTypo 5,
 * twoTypos 9), deliberately rather than a threshold of our own. The engine
 * already forgives exactly this much when matching, so a pair it would treat
 * as the same word is a pair we call `correcting`; a pair it would treat as
 * different words we do not. Picking our own number would mean the analytics
 * disagreed with the search about what counts as a misspelling.
 */
function typoBudget(len: number): number {
  if (len >= 9) return 2;
  if (len >= 5) return 1;
  return 0;
}

/**
 * Damerau-Levenshtein distance, bounded: returns `max + 1` as soon as it is
 * certain the true distance exceeds `max`. Bounded because we only ever ask
 * "is this within 1 or 2", and the early exit keeps it O(n) for the common
 * case of two obviously different words on a hot log path.
 *
 * Transposition matters here specifically: "snwoboard" for "snowboard" is two
 * adjacent characters swapped, which plain Levenshtein scores 2 and Damerau
 * scores 1. Adjacent transposition is the most common typing error there is, so
 * without it the commonest typo reads as a different word.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = new Array(b.length + 1);
  let cur: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // Transposition: the two characters are swapped relative to each other.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length] > max ? max + 1 : prev[b.length];
}

/**
 * Classify how `next` rewrites `prev`.
 *
 * Order matters. Containment is checked before typo proximity because a query
 * that strictly adds a word is narrowing even if the added word happens to
 * resemble one already there; and typo proximity is checked before lateral
 * because a misspelling looks exactly like a swapped descriptor to a set
 * comparison, and the two prescribe opposite remedies.
 */
export function classifyReformulation(prev: string, next: string): Reformulation {
  const a = intentTokens(prev);
  const b = intentTokens(next);
  if (a.size === 0 || b.size === 0) return "unrelated";

  const shared = Array.from(b).filter((t) => a.has(t));
  if (shared.length === a.size && shared.length === b.size) return "same";

  // Strict containment, both directions. Decidable with no semantics, and the
  // single most informative pair of types: one says the catalogue answered too
  // broadly, the other too narrowly.
  if (shared.length === a.size && b.size > a.size) return "narrowing";
  if (shared.length === b.size && a.size > b.size) return "broadening";

  // A typo: the queries differ in exactly one token each, and those two tokens
  // are within the engine's own typo budget of each other.
  const onlyA = Array.from(a).filter((t) => !b.has(t));
  const onlyB = Array.from(b).filter((t) => !a.has(t));
  if (onlyA.length === 1 && onlyB.length === 1) {
    const budget = typoBudget(Math.max(onlyA[0].length, onlyB[0].length));
    if (budget > 0 && editDistance(onlyA[0], onlyB[0], budget) <= budget) {
      return "correcting";
    }
  }

  // Descriptors swapped around a shared subject: the shopper's words are not
  // the catalogue's words. Each lateral chain that ends in success is a synonym
  // candidate. Requires a shared token -- without one there is no evidence the
  // two queries are about the same thing, and guessing that they are is what
  // the Demand-Interpretation agent is for.
  if (shared.length > 0) return "lateral";

  return "unrelated";
}

function newIntentId(): string {
  // Not security-sensitive -- just needs to be collision-resistant enough to
  // label a session's intent runs. Time + random keeps it sortable-ish.
  return `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type IntentAssignment = {
  intentGroupId: string;
  /** How this query rewrites the one it joined. `null` when it opens an intent. */
  reformulationType: Reformulation | null;
  /** The query it was judged against. `null` when it opens an intent. */
  previousQuery: string | null;
};

/**
 * Assign an intent to `newQuery` given the session's recent queries (most
 * recent first, already time-bounded and committed-only by the caller).
 *
 * Walks most-recent-first and joins the FIRST query it is related to, so a
 * chain is built link by link: "snwoboard" -> "snowboard" is judged against
 * "snwoboard", and "complete snowboard" against "snowboard". Judging against
 * the intent's FIRST query instead would break a chain that drifts
 * legitimately, which is exactly what a multi-step refinement does.
 *
 * An empty signature (an all-stopword query) opens a fresh intent rather than
 * collapsing unrelated noise.
 */
export function assignIntent(
  recentQueries: RecentQuery[],
  newQuery: string,
  newQueryAt?: string | null
): IntentAssignment {
  const fresh: IntentAssignment = {
    intentGroupId: newIntentId(),
    reformulationType: null,
    previousQuery: null,
  };
  if (intentTokens(newQuery).size === 0) return fresh;

  const nowMs = newQueryAt ? Date.parse(newQueryAt) : NaN;

  for (const recent of recentQueries) {
    if (!recent.intentGroupId) continue;
    // Too long ago to be the same demand. The list is most-recent-first, so
    // everything after this is older still -- stop rather than continue.
    if (Number.isFinite(nowMs) && recent.at) {
      const thenMs = Date.parse(recent.at);
      if (Number.isFinite(thenMs) && nowMs - thenMs > INTENT_WINDOW_MS) break;
    }
    const rel = classifyReformulation(recent.query, newQuery);
    if (rel === "unrelated") continue;
    return {
      intentGroupId: recent.intentGroupId,
      reformulationType: rel,
      previousQuery: recent.query,
    };
  }
  return fresh;
}
