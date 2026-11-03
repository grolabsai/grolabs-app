// Drives the REAL assignIntent over one scripted shopper journey, simulating
// exactly what the search route and the drainer now do:
//
//   * only COMMITTED searches are assigned an intent and enter the window
//     (a typeahead probe counts for nothing — F-2);
//   * the window is the last 10 committed rows for this (instance, user)
//     WITHIN 30 minutes (F-1's unbounded window);
//   * each assignment names how the query rewrites the one it joined.
//
// Run:
//   ./node_modules/.bin/esbuild --bundle --platform=node --format=cjs \
//     --outfile=/tmp/trace.js docs/state/event-semantics-trace.driver.ts && node /tmp/trace.js
import {
  assignIntent,
  intentSignature,
  INTENT_WINDOW_MS,
  type RecentQuery,
} from "../../src/lib/analytics/intent";

const INTENT_WINDOW = 10;

type Step = {
  n: number;
  at: string;                       // ISO
  /** `entity` is not a behavioural event: it is a server-side fact written to its
   *  own table (sales_order) by its own endpoint, at its own grain. */
  kind: "probe" | "committed" | "event" | "entity";
  /** The BROWSER. Identity is per-browser (localStorage), so a second device is
   *  a second user_id with an empty window — which is the point of visit 4. */
  user: "bidA" | "bidB";
  q?: string;
  hits?: number;
  event?: string;
  expect: string;                   // the branch the definitions name
};

const D1 = "2026-11-02T";
const D2 = "2026-11-03T";

const journey: Step[] = [
  { n: 1,  at: D1+"10:00:00.0Z", user:"bidA", kind:"probe",     q:"sn",                  expect:"keystroke — counts for nothing" },
  { n: 2,  at: D1+"10:00:00.6Z", user:"bidA", kind:"probe",     q:"snow",                expect:"keystroke" },
  { n: 3,  at: D1+"10:00:01.4Z", user:"bidA", kind:"probe",     q:"snwo",                expect:"keystroke" },
  { n: 4,  at: D1+"10:00:02.2Z", user:"bidA", kind:"probe",     q:"snwoboard",           expect:"keystroke" },
  { n: 5,  at: D1+"10:00:04Z",   user:"bidA", kind:"committed", q:"snwoboard", hits:0,   expect:"NEW INTENT (zero-result)" },
  { n: 6,  at: D1+"10:00:12Z",   user:"bidA", kind:"probe",     q:"snowboard",           expect:"keystroke" },
  { n: 7,  at: D1+"10:00:14Z",   user:"bidA", kind:"committed", q:"snowboard", hits:13,  expect:"CORRECTING → same intent" },
  { n: 8,  at: D1+"10:00:31Z",   user:"bidA", kind:"probe",     q:"complete snowboard",  expect:"keystroke" },
  { n: 9,  at: D1+"10:00:33Z",   user:"bidA", kind:"committed", q:"complete snowboard", hits:1, expect:"NARROWING → same intent" },
  { n:10,  at: D1+"10:00:40Z",   user:"bidA", kind:"event", event:"Search Result Clicked", expect:"click, attributed to #9" },
  { n:11,  at: D1+"10:00:42Z",   user:"bidA", kind:"event", event:"Product viewed",        expect:"view" },
  { n:12,  at: D1+"10:01:20Z",   user:"bidA", kind:"event", event:"Added to cart",         expect:"conversion (placement=pdp)" },
  { n:13,  at: D1+"10:01:40Z",   user:"bidA", kind:"event", event:"Added to cart (2nd item)", expect:"conversion — a second line on the same cart_id" },
  { n:14,  at: D1+"10:02:10Z",   user:"bidA", kind:"event", event:"Removed from cart",       expect:"cart_remove — own store ONLY, never Meilisearch" },
  { n:15,  at: D1+"10:03:00Z",   user:"bidA", kind:"event", event:"Proceeded to check out",expect:"conversion" },
  { n:16,  at: D1+"10:05:00Z",   user:"bidA", kind:"event", event:"Completed order",       expect:"conversion → intent 1 SATISFIED" },
  // The purchase is recorded TWICE, at two grains, by two paths. Revenue KPIs
  // read the entity; the behavioural event is for the funnel.
  { n:17,  at: D1+"10:05:02Z",   user:"bidA", kind:"entity", event:"sales_order upsert",    expect:"the order ENTITY — revenue's source of truth, not an event" },
  { n:18,  at: D1+"10:50:00Z",   user:"bidA", kind:"committed", q:"ski wax", hits:3,     expect:"NEW SESSION + NEW INTENT" },
  { n:19,  at: D1+"10:50:20Z",   user:"bidA", kind:"committed", q:"wax", hits:5,         expect:"BROADENING → same intent" },
  { n:20,  at: D1+"10:51:00Z",   user:"bidA", kind:"committed", q:"snowboard wax", hits:2, expect:"LATERAL vs #18 — but the chain judges it vs #19 → narrowing" },
  { n:21,  at: D2+"09:00:00Z",   user:"bidA", kind:"committed", q:"goggles", hits:4,     expect:"NEW SESSION (day) + NEW INTENT" },
  { n:22,  at: D2+"09:00:30Z",   user:"bidA", kind:"event", event:"Added to cart",        expect:"conversion" },
  // Visit 4 — same human, different browser. None of bidA's history is
  // reachable here, so this is self-contained for the worst possible reason.
  { n:23,  at: D2+"20:00:00Z",   user:"bidB", kind:"committed", q:"goggles", hits:4, expect:"same human — but a new user_id and an empty window" },
  { n:24,  at: D2+"20:00:40Z",   user:"bidB", kind:"event", event:"Completed order",     expect:"conversion, severed from the chain on bidA" },
];

// One log per BROWSER: the intent window is scoped to (instance_id, user_id),
// so bidB starts empty however much bidA has done.
const logs = new Map<string, RecentQuery[]>();
const logFor = (u: string) => {
  let l = logs.get(u);
  if (!l) { l = []; logs.set(u, l); }
  return l;
};
type Row = { n:number; at:string; kind:string; user:string; label:string; intent:string; type:string; prev:string; expect:string };
const rows: Row[] = [];

for (const s of journey) {
  if (s.kind === "event" || s.kind === "entity") {
    rows.push({ n:s.n, at:s.at, kind:s.kind, user:s.user, label:s.event!, intent:"—", type:"—", prev:"—", expect:s.expect });
    continue;
  }
  // A probe is logged, but it mints nothing and joins nothing.
  if (s.kind === "probe") {
    rows.push({ n:s.n, at:s.at, kind:s.kind, user:s.user, label:`"${s.q}"`, intent:"NULL", type:"—", prev:"—", expect:s.expect });
    continue;
  }
  // Window: this browser's committed searches, most-recent-first, in the bound.
  const log = logFor(s.user);
  const cutoff = Date.parse(s.at) - INTENT_WINDOW_MS;
  const window = log.filter((r) => Date.parse(r.at ?? "") >= cutoff).slice(0, INTENT_WINDOW);
  const a = assignIntent(window, s.q!, s.at);
  log.unshift({ query: s.q!, intentGroupId: a.intentGroupId, at: s.at });
  rows.push({
    n:s.n, at:s.at, kind:s.kind, user:s.user,
    label:`"${s.q}"` + (s.hits !== undefined ? ` (${s.hits} hits)` : ""),
    intent:a.intentGroupId,
    type:a.reformulationType ?? "— opens intent",
    prev:a.previousQuery ? `"${a.previousQuery}"` : "—",
    expect:s.expect,
  });
}

// ── JSON mode ───────────────────────────────────────────────────────────
// `--json` makes this the DATA SOURCE for event-semantics-trace.build.py, so
// the generated page's intent / type / previous_query cells are produced by
// executing the real assignIntent rather than typed by hand. Everything the
// page states that this cannot produce is authored in the build script and
// labelled there as authored.
if (process.argv.includes("--json")) {
  const shortJ = new Map<string, string>();
  for (const r of rows) {
    if (r.intent.startsWith("intent_") && !shortJ.has(r.intent)) {
      shortJ.set(r.intent, `I${shortJ.size + 1}`);
    }
  }
  const committedJ = rows.filter((r) => r.kind === "committed");
  const rewritesJ = committedJ.filter((r) =>
    ["correcting", "narrowing", "broadening", "lateral"].includes(r.type)
  );
  const intentsJ = new Set(committedJ.map((r) => r.intent));
  const withRewriteJ = new Set(rewritesJ.map((r) => r.intent));
  console.log(JSON.stringify({
    generatedBy: "docs/state/event-semantics-trace.driver.ts --json",
    windowMs: INTENT_WINDOW_MS,
    steps: rows.map((r) => ({
      n: r.n,
      at: r.at,
      kind: r.kind,
      user: r.user,
      label: r.label,
      intent: r.kind === "committed" ? (shortJ.get(r.intent) ?? r.intent) : null,
      // null when the query OPENS an intent: there is no previous query, so
      // there is no relation to name. The human-readable table prints a dash;
      // the JSON must not, because the page renders these as column values.
      type: r.kind === "committed" && r.type !== "— opens intent" ? r.type : null,
      previous: r.kind === "committed" && r.prev !== "—" ? r.prev : null,
      expect: r.expect,
    })),
    totals: {
      probes: rows.filter((r) => r.kind === "probe").length,
      committed: committedJ.length,
      intents: intentsJ.size,
      rewrites: rewritesJ.map((r) => r.type),
      reformulationRate: withRewriteJ.size / intentsJ.size,
    },
  }, null, 2));
  process.exit(0);
}

const short = new Map<string,string>();
for (const r of rows) if (r.intent.startsWith("intent_") && !short.has(r.intent)) short.set(r.intent, `I${short.size+1}`);
const name = (i:string) => short.get(i) ?? i;

console.log("\nSTEP  TIME      BROWSER KIND       QUERY / EVENT                  INTENT  TYPE            PREVIOUS            EXPECTED BRANCH");
console.log("".padEnd(146,"-"));
for (const r of rows) {
  console.log(
    String(r.n).padEnd(6) +
    r.at.slice(11,19).padEnd(10) +
    r.user.padEnd(8) +
    r.kind.padEnd(11) +
    r.label.padEnd(31) +
    name(r.intent).padEnd(8) +
    r.type.padEnd(16) +
    r.prev.padEnd(20) +
    r.expect
  );
}

const committed = rows.filter((r) => r.kind === "committed");
const probes = rows.filter((r) => r.kind === "probe");
const intents = new Set(committed.map((r) => r.intent));
const rewrites = committed.filter((r) => ["correcting","narrowing","broadening","lateral"].includes(r.type));

console.log("\nCOUNTS");
console.log("".padEnd(146,"-"));
console.log(`  typeahead probes logged .................. ${probes.length}  (intent_group_id NULL on every one)`);
console.log(`  committed searches ....................... ${committed.length}`);
console.log(`  distinct intents ......................... ${intents.size}`);
console.log(`  distinct intents per the DEFINITION ...... 3   ("a snowboard", "wax for it", "goggles")`);
console.log(`      the extra one is F-6, not F-1: steps 18 and 20 are the SAME demand`);
console.log(`      ("goggles") by the same human, split because identity is per browser`);
console.log(`      and the window is scoped to (instance_id, user_id). Nothing rolls`);
console.log(`      intents up by account_id, so a second device is a second person.`);
console.log(`  reformulations named ..................... ${rewrites.length}  (${rewrites.map((r)=>r.type).join(", ")})`);
console.log(`  reformulation_rate = intents with >=1 rewrite / intents`);
const withRewrite = new Set(rewrites.map((r)=>r.intent));
console.log(`      = ${withRewrite.size}/${intents.size} = ${(withRewrite.size/intents.size).toFixed(3)}`);
console.log(`
  ONE DIVERGENCE REMAINS, by design. Step 20 is classified "narrowing", not
  "lateral". The chain judges each query against its IMMEDIATE predecessor, and
  "wax" -> "snowboard wax" genuinely adds a criterion. Read against the query
  that OPENED the intent ("ski wax") it is a descriptor swap, ski <-> snowboard
  -- the vocabulary gap, and the more valuable signal, since its remedy is a
  synonym rather than a facet. An intervening broadening hides it.
  Classifying against both the predecessor and the intent's opening query would
  catch it; that is a second axis, not a bug fix, so it is NOT done here.
  classifyReformulation("ski wax","snowboard wax") does return "lateral" --
  covered in the unit tests -- so the type is reachable; this journey routes
  around it.`);
