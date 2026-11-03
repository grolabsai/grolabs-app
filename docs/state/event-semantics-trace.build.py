#!/usr/bin/env python3
"""
Build the event-semantics trace reader.

    python3 event-semantics-trace.build.py

Writes event-semantics-trace.html next to this file.

WHY THIS IS GENERATED. The first version of the page was written by hand from
reading the code, and the honest objection to that is drift: the moment
assignIntent changes, a hand-typed tree says something that is no longer true,
and nothing fails. Same reason ux/build.py exists. So the page now labels every
claim with its provenance, and the two mechanically checkable classes are
produced at build time rather than typed:

  MEASURED  Produced by EXECUTING the real code. The intent id, reformulation
            type and previous_query for every committed search come from
            running src/lib/analytics/intent.ts through the driver's --json
            mode. Nothing in this script types an intent id or a type name;
            the assertions at the bottom fail the build if a measured value
            did not reach the page.

  VERIFIED  Produced by running the real SQL once, against the live scout
            database, and recorded here with the date. Session numbers come
            from public.session_assignment's own window logic; the live counts
            come from query_log / analytics_event. Recorded rather than re-run
            because the build must not need database credentials.

  AUTHORED  Read out of the source by a person and written below: what state a
            decision reads, which branches the code has, what the definitions
            say. This is the half a human has to keep true, and it is marked
            as such on every row so a reader knows which cells to distrust.

Design tokens are lifted from _shell.html at build time, never re-decided here
(see the root CLAUDE.md).
"""

from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent              # .../web-apps/app/docs/state
APP = HERE.parent.parent                            # .../web-apps/app
CODE = APP.parents[2]                               # .../code
SHELL = CODE / "dev-studio" / "apps" / "spec" / "_shell.html"
DRIVER = HERE / "event-semantics-trace.driver.ts"
ESBUILD = APP / "node_modules" / ".bin" / "esbuild"
OUT = HERE / "event-semantics-trace.html"
ART = HERE / "event-semantics-trace.artifact.html"

MEASURED_ON = "2026-11-02"


# ══════════════════════════════════════════════════════════════════════════
#  MEASURED — execute the real code
# ══════════════════════════════════════════════════════════════════════════

def measured() -> dict:
    """Run the driver against the real intent module and read its JSON."""
    bundle = HERE / ".trace-driver.cjs"
    try:
        subprocess.run(
            [str(ESBUILD), "--bundle", "--platform=node", "--format=cjs",
             "--log-level=error", f"--outfile={bundle}", str(DRIVER)],
            cwd=APP, check=True, capture_output=True, text=True,
        )
        out = subprocess.run(
            ["node", str(bundle), "--json"],
            cwd=APP, check=True, capture_output=True, text=True,
        ).stdout
    finally:
        bundle.unlink(missing_ok=True)
    return json.loads(out)


# ══════════════════════════════════════════════════════════════════════════
#  VERIFIED — recorded results of real queries, with their date
# ══════════════════════════════════════════════════════════════════════════

# Session numbers: public.session_assignment's own window expression, driven
# over this journey's timestamps as literals (read-only, no table touched).
SESSIONS = {
    "Visit 1": "session_seq 1",
    "Visit 2": "session_seq 2 — 45-minute gap, over the 30-minute rule",
    "Visit 3": "session_seq 3 — next store-local day",
    "Visit 4": "session_seq 1 again — a different browser, so a different partition",
}

# Live counts, instance 16 and the whole table, read on MEASURED_ON.
LIVE = [
    ("account_id on events",
     "<strong>0</strong> of 21 rows on instance 16 carry one — across every event name. "
     "The only populated values in the table belong to instance 99999's seed data."),
    ("user_id on query_log",
     "<strong>50</strong> of ~1,372 rows. Intent assignment and sessionization both "
     "require it, so most logged searches can be neither grouped nor sessionized."),
    ("is_committed NULL",
     "<strong>660</strong> legacy rows. <code>metric_daily_source</code> reads "
     "<code>IS NOT FALSE</code>, so every one is counted as committed."),
    ("intent vs query grain, before the fix",
     "In every user-day with committed searches, distinct intents equalled distinct "
     "queries — <strong>0</strong> user-days where grouping collapsed anything."),
]


# ══════════════════════════════════════════════════════════════════════════
#  AUTHORED — read out of the source by hand. The half that can drift.
# ══════════════════════════════════════════════════════════════════════════

STORES = [
    ("Browser id",
     "localStorage <code>grolabs_search_session_id</code>, mirrored to cookie "
     "<code>grolabs_bid</code>. Persistent per browser — despite the name it is not a "
     "session. Becomes <code>user_id</code> on every row."),
    ("Attribution",
     "localStorage <code>grolabs_search_attribution</code>: productId &rarr; "
     "{queryUid, indexUid, position, name, ts}. 7-day TTL, 100 entries LRU. Written by "
     "a click, read by every later conversion."),
    ("Dedup flags",
     "sessionStorage for checkout (sorted cart-id hash); localStorage for order "
     "(<code>orderId</code>) — once per order, ever."),
    ("Cart token",
     "localStorage <code>grolabs_cart_token</code>, threads add &rarr; checkout &rarr; "
     "order as <code>cart_id</code>."),
    ("Intent window",
     "The only server-side one: committed <code>query_log</code> rows for this "
     "(instance, user), last 10, within 30 minutes."),
]

VISITS = [
    ("Visit 1", "11-02 10:00 &rarr; 10:05 · anonymous",
     [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]),
    ("Visit 2", "11-02 10:50 · same browser, 45 minutes later", [18,19,20]),
    ("Visit 3", "11-03 09:00 · next day, same browser, logs in", [21,22]),
    ("Visit 4", "11-03 20:00 · same human, different device", [23,24]),
]

# Everything the system records, whether or not this journey reaches it. Counts
# read from the live database on MEASURED_ON. The journey is one path; this is
# the whole surface, so a reader can see what the path does NOT exercise.
EVERYTHING = [
    ("Search Result Clicked", "16", "yes", "Step 10. <code>click</code>."),
    ("Product viewed", "44", "yes", "Step 11. <code>view</code>."),
    ("Added to cart", "88", "yes", "Steps 12 and 13. <code>conversion</code>."),
    ("Removed from cart", "21", "yes", "Step 14. <code>cart_remove</code> — own store only."),
    ("Proceeded to check out", "34", "yes", "Step 15."),
    ("Completed order", "32", "yes", "Step 16, with the entity at 17."),
    ("Cart updated", "20", "no",
     "<strong>No code emits this.</strong> It is in no taxonomy — not "
     "<code>event-tracking.md</code> §2, not <code>search-events.md</code> §2 — and no "
     "constant in the storefront or the pixel produces it. Drift from the BYO/SDK work. It "
     "is <em>not</em> counted in any conversion metric (every one filters by "
     "<code>event_name</code>), but it does enter <code>event_stream</code>, so it counts as "
     "session activity. Finding F-8."),
    ("Committed search", "41", "yes", "<code>query_log</code>, <code>is_committed = true</code>."),
    ("Typeahead probe", "11", "yes",
     "<code>query_log</code>, <code>is_committed = false</code>. Excluded from "
     "<code>event_stream</code>, so a typeahead-only visit produces no session at all."),
    ("Denied search", "105", "no",
     "<strong>More denials than committed searches.</strong> "
     "<code>query_log</code> rows with <code>status &ne; 200</code> and a "
     "<code>denial_reason</code> — origin not whitelisted, or rate limited. A proxy-path "
     "artifact: in direct mode the storefront never calls <code>/api/v1/search</code>, so "
     "these cannot recur, but they are the majority of the table and any query over it that "
     "forgets the status filter is reading mostly refusals."),
    ("sales_order", "31", "yes", "Step 17. The order entity; revenue's source of truth."),
    ("event_inbox", "7", "partly",
     "The durable buffer every batched event passes through. Covered by the note under the "
     "journey rather than as a node, since the shopper does not cause it."),
    ("metric_daily", "133", "no",
     "Nightly rollups materialized from <code>metric_daily_source</code>. Downstream of "
     "everything above; nothing writes it directly."),
    ("backend_operation", "179", "no",
     "Health and canary probes from <code>pg_cron</code>, every 5 minutes. Our own "
     "monitoring, not shopper behaviour."),
    ("ga4_*_daily", "5 tables", "no",
     "The anonymous daily-aggregate overlay — <code>session</code>, <code>traffic</code>, "
     "<code>page</code>, <code>device</code>, <code>geo</code>. A sibling source, "
     "deliberately never joined per-user, so no journey can reach it."),
]

# dep: r = reads earlier state, w = writes state a later event reads,
#      s = self-contained. v: ok | gap  (the CURRENT verdict)
NODES = {
 1: dict(did="Types “sn”", dep=["s","w"], v="ok",
   sum="Typeahead fires a debounced search (200 ms, 2-char minimum) and reports it as a probe.",
   state="None. A probe no longer reads the intent window, and no longer enters it.",
   rule="<code>logRequest()</code> assigns an intent only when the caller marked the search committed. A typeahead probe is marked <code>committed=false</code> at capture time.",
   br=[["committed","assign an intent",0],["probe","log the row, leave intent_group_id NULL",1]],
   cols=[["query","sn"],["is_committed","false"],["commit_reason","typeahead"],["intent_group_id","NULL"]],
   dfn="A keystroke “counts for nothing” — <em>conversion-measurement-foundations.md</em> §3.",
   was=["F-2","This used to mint an intent. Intent was assigned to every successful search including prefixes, so the id a committed search later inherited had been minted by whichever keystroke happened to match it. The thing that counts for nothing named the thing that counts."]),
 2: dict(did="Types “snow”", dep=["s"], v="ok",
   sum="Second probe. Logged for latency and volume, invisible to intent grouping.",
   state="None.",
   rule="Same committed check.",
   br=[["committed","assign an intent",0],["probe","intent_group_id NULL",1]],
   cols=[["query","snow"],["is_committed","false"],["intent_group_id","NULL"]],
   dfn="Still a keystroke.", was=None),
 3: dict(did="Types “snwo” — a typo in progress", dep=["s"], v="ok",
   sum="Third probe.", state="None.", rule="Same committed check.",
   br=[["committed","assign an intent",0],["probe","intent_group_id NULL",1]],
   cols=[["query","snwo"],["is_committed","false"],["intent_group_id","NULL"]],
   dfn="Still a keystroke.", was=None),
 4: dict(did="Types “snwoboard”", dep=["s"], v="ok",
   sum="Fourth probe — and the one that used to mint the id the committed search inherited.",
   state="None.", rule="Same committed check.",
   br=[["committed","assign an intent",0],["probe","intent_group_id NULL",1]],
   cols=[["query","snwoboard"],["is_committed","false"],["intent_group_id","NULL"]],
   dfn="Still a keystroke.",
   was=["F-2","Previously minted the intent that step 5 inherited two seconds later."]),
 5: dict(did="Presses Enter → “snwoboard”, 0 hits", dep=["r","w"], v="ok",
   sum="The first search that counts. Opens the demand, and finds nothing.",
   state="The intent window: committed searches for this (instance, user) in the last 30 minutes. Empty — this is the first.",
   rule="<code>assignIntent</code> walks the window most-recent-first and joins the first query it is related to; with an empty window it opens a new intent.",
   br=[["a related query in the window","inherit its intent, name the relation",0],["nothing related","open a new intent",1]],
   cols=[["is_committed","true"],["commit_reason","results_page"],["total_hits","0"],["estimated_total_hits","0"]],
   dfn="Opens an intent — the demand “a snowboard” — and is a zero-result search.",
   was=["F-2","Used to inherit an id minted by the probe at step 4, so the demand was labelled by a prefix."]),
 6: dict(did="Retypes “snowboard”", dep=["s"], v="ok",
   sum="Probe for the corrected spelling.", state="None.", rule="Same committed check.",
   br=[["committed","assign an intent",0],["probe","intent_group_id NULL",1]],
   cols=[["query","snowboard"],["is_committed","false"],["intent_group_id","NULL"]],
   dfn="Still a keystroke.", was=None),
 7: dict(did="Enter → “snowboard”, 13 hits", dep=["r","w"], v="ok",
   sum="A typo repaired. Stays in the demand it is repairing, and says so.",
   state="The window now holds step 5. Probes are not in it, so the comparison is against the last real search rather than against prefix noise.",
   rule="<code>classifyReformulation</code> checks containment first, then typo proximity: the two queries differ in exactly one token each, and those tokens are within <strong>Meilisearch's own typo budget</strong> (<code>minWordSizeForTypos</code> — one error from 5 characters, two from 9). Transposition counts as one error, which is why <em>snwo</em> for <em>snow</em> is caught.",
   br=[["identical token set","same — a restatement, not a rewrite",0],["one set contains the other","narrowing or broadening",0],["one token each, within the typo budget","correcting",1],["shares a token, neither contains","lateral",0],["nothing shared","unrelated — open a new intent",0]],
   cols=[["is_committed","true"],["total_hits","13"]],
   dfn="<span class='pill ref'>CORRECTING</span> — a typo repair. Its remedy is typo tolerance, which is why it must never be reported as narrowing.",
   was=["F-1","Signature equality meant this started an unrelated new intent, and the fact that it was a correction was recorded nowhere."]),
 8: dict(did="Types “complete snowboard”", dep=["s"], v="ok",
   sum="Probe.", state="None.", rule="Same committed check.",
   br=[["committed","assign an intent",0],["probe","intent_group_id NULL",1]],
   cols=[["query","complete snowboard"],["is_committed","false"],["intent_group_id","NULL"]],
   dfn="Still a keystroke.", was=None),
 9: dict(did="Enter → “complete snowboard”, 1 hit", dep=["r","w"], v="ok",
   sum="Criteria added — the actual refinement, and the third query in one demand.",
   state="The window holds steps 7 and 5, most recent first.",
   rule="Strict set containment: <code>{complete, snowboard}</code> &sup; <code>{snowboard}</code>. Decidable with no semantics at all, which is why three of the four types never needed the agent.",
   br=[["identical token set","same",0],["new set strictly contains the old","narrowing",1],["old contains the new","broadening",0],["one token each within the typo budget","correcting",0],["shares a token","lateral",0]],
   cols=[["is_committed","true"],["total_hits","1"]],
   dfn="<span class='pill ref'>NARROWING</span> — adds words, signalling the first results were too broad. Remedy: faceting and specificity.",
   was=["F-1","Started a third intent for one demand, although the containment that identifies narrowing was already being computed."]),
 10: dict(did="Clicks the result", dep=["s","w"], v="ok",
   sum="Records what its own search returned — no history involved — and writes the attribution every later conversion depends on.",
   state="None. <code>queryUid</code> and <code>position</code> come from the response this click belongs to.",
   rule="<code>recordClick()</code> writes the Meilisearch row and stores attribution keyed by product id.",
   br=[["has a queryUid","Meilisearch and the own store",1],["no queryUid","own store only — the fence",0]],
   cols=[["event_type","click"],["event_name","Search Result Clicked"],["position","0 (global rank)"],["query_uid","← step 9's search"]],
   dfn="A click, attributed to the search that produced it.", was=None),
 11: dict(did="Product page renders", dep=["s"], v="ok",
   sum="Self-contained: the product id comes from the page being viewed.",
   state="None.", rule="The pixel subscribes to <code>product_viewed</code> and reports it.",
   br=[["product id present","record the view",1]],
   cols=[["event_type","view"],["event_name","Product viewed"],["query_uid","NULL in live data"]],
   dfn="A PDP view, feeding <code>pdp_views</code> and <code>click_to_pdp</code> as daily ratios.", was=None),
 12: dict(did="Adds to cart", dep=["r"], v="gap",
   sum="The first node whose correctness depends on a click 40 seconds earlier — and the first to lose the shopper's identity.",
   state="Attribution store (written at step 10), cart token, and the placement hint the theme left for the pixel.",
   rule="<code>conversionPayload()</code> looks the product up in the attribution store; if found, the conversion carries that <code>queryUid</code>.",
   br=[["attribution found","own store + Meilisearch",1],["none","own store only — journey kept, ranking untouched",0]],
   cols=[["event_type","conversion"],["event_name","Added to cart"],["cart_id","← cart token"],["placement","pdp"],["account_id","NULL"]],
   dfn="A conversion attributable to the search chain.",
   was=["F-4 · OPEN","<code>conversionPayload()</code> sets event type, name, object and attribution — never <code>accountId</code>. The pixel owns cart, checkout and order, so every revenue event is accountless. Live: 0 of 3."]),
 13: dict(did="Adds a second item", dep=["r","w"], v="ok",
   sum="A second line on the same cart. Needed before a removal means anything, and before cart value can be computed at all.",
   state="The cart token from step 12, so both lines thread to one <code>cart_id</code>.",
   rule="Same <code>conversionPayload()</code> path. Attribution is looked up per product, so this line carries a <code>query_uid</code> only if THIS product was clicked in search — it was not.",
   br=[["this product has attribution","own store + Meilisearch",0],["none","own store only, journey still threaded by cart_id",1]],
   cols=[["event_type","conversion"],["event_name","Added to cart"],["cart_id","same as step 12"],["query_uid","NULL — this one was not clicked in search"],["account_id","NULL"]],
   dfn="A conversion with no search lineage. The fence holds: the own store takes it, Meilisearch does not.",
   was=None),
 14: dict(did="Removes the second item", dep=["r","w"], v="ok",
   sum="The one event type that NEVER reaches Meilisearch, by design — and the reason cart value is computable.",
   state="The cart token, and the attribution store (consulted, though a removal has no ranking meaning).",
   rule="Emitted from the pixel's <code>product_removed_from_cart</code> subscription with <code>eventType = 'cart_remove'</code>. The receiver accepts it; there is no Meilisearch counterpart because a removal is not relevance feedback.",
   br=[["own store","always written",1],["Meilisearch","no such event — a removal would not train ranking",0]],
   cols=[["event_type","cart_remove"],["event_name","Removed from cart"],["cart_id","same thread"],["query_uid","NULL"]],
   dfn="Own-store only. Lets cart value be computed as adds &minus; removes &minus; purchases — the reason this event exists at all.",
   was=None),
 15: dict(did="Proceeds to checkout", dep=["r","w"], v="ok",
   sum="Reads attribution again, and a dedup flag so a reload does not double-count.",
   state="Attribution store; sessionStorage flag keyed on the sorted cart-id hash.",
   rule="<code>ranOnce('session', …)</code> — if the flag is set, emit nothing.",
   br=[["flag absent","emit one event per attributed item, set the flag",1],["flag present","emit nothing",0]],
   cols=[["event_name","Proceeded to check out"],["cart_id","← cart token"]],
   dfn="One event per attributed cart item, once per cart.", was=None),
 16: dict(did="Completes the order", dep=["r","w"], v="ok",
   sum="Deduped on order id in localStorage — fires once per order, ever — and now satisfies a demand rather than a fragment.",
   state="Attribution store; localStorage flag keyed on <code>orderId</code>.",
   rule="Same <code>ranOnce</code>, localStorage scope, so the guarantee survives the tab closing.",
   br=[["order not seen","emit per item, record the order id",1],["already recorded","emit nothing",0]],
   cols=[["event_name","Completed order"],["order_id","(order)"],["value / quantity","(line item)"]],
   dfn="The purchase, and the point at which the intent is <strong>satisfied</strong> — any query in the chain earning a click or purchase satisfies the whole chain.",
   was=["F-1","There used to be no chain to satisfy: the demand was split across three intents, so satisfaction attached to whichever fragment happened to hold the click."]),
 17: dict(did="The order is written a second time, as an entity", dep=["s"], v="ok",
   sum="The same purchase, recorded twice at two grains by two paths. Revenue reads this one, not the event.",
   state="None. <code>/api/v1/orders</code> is called server-side with the order; it reads no browser state and no earlier event.",
   rule="Upsert on the <code>(instance_id, order_id)</code> primary key, so a retry cannot double-count revenue. <code>total_sales</code>, <code>orders</code>, <code>aov</code> and <code>avg_items_per_order</code> derive from this table and never from <code>analytics_event</code> — an order is a server-side fact, not a behavioural event, and <code>event_stream</code> stays a pure activity spine.",
   br=[["order_id already present","update in place — idempotent",0],["new order_id","insert",1]],
   cols=[["table","sales_order (NOT analytics_event)"],["amount","net product revenue, ex-tax/shipping"],["order_id","the platform's own id"],["source","woocommerce | sdk"]],
   dfn="The order ENTITY — source of truth for revenue, deliberately distinct from the behavioural <code>Completed order</code> event at step 16.",
   was=None),
 18: dict(did="Searches “ski wax”, 3 hits", dep=["r"], v="ok",
   sum="A genuinely different demand, in a new session.",
   state="Previous event's timestamp (10:05:00) and the intent window.",
   rule="<code>session_assignment</code>: a gap over 30 minutes starts a session. <code>assignIntent</code>: nothing in the window is related, so a new intent.",
   br=[["gap over 30 minutes","new session",1],["same day, gap within 30 minutes","stay in the session",0]],
   cols=[["query","ski wax"],["is_committed","true"],["total_hits","3"]],
   dfn="A new session by inactivity, and a second demand.", was=None),
 19: dict(did="Searches “wax”, 5 hits", dep=["r"], v="ok",
   sum="Dropped a word — the same containment test as narrowing, inverted.",
   state="The window holds step 15.",
   rule="<code>{wax}</code> &sub; <code>{ski, wax}</code>.",
   br=[["new set strictly contains the old","narrowing",0],["old contains the new","broadening",1],["shares a token","lateral",0]],
   cols=[["query","wax"],["total_hits","5"]],
   dfn="<span class='pill ref'>BROADENING</span> — removes words, the shopper widening after too narrow a result.",
   was=["F-1","Also undetected, by the same equality test."]),
 20: dict(did="Searches “snowboard wax”, 2 hits", dep=["r"], v="gap",
   sum="Joins the right demand, but gets the less useful label — the one case this journey still does not measure correctly.",
   state="The window holds steps 16 and 15, most recent first.",
   rule="The chain joins the FIRST related query walking backwards, which is step 16. Against <em>wax</em>, adding <em>snowboard</em> is containment, so: narrowing.",
   br=[["related to step 16 (“wax”)","narrowing — taken, because this is the nearest relation",1],["related to step 15 (“ski wax”)","lateral — ski ↔ snowboard is a descriptor swap",0]],
   cols=[["query","snowboard wax"],["total_hits","2"]],
   dfn="<span class='pill ref'>LATERAL</span> — the shopper's words are not the catalogue's words. Each lateral chain ending in success is a <strong>synonym candidate</strong>, which is why this is the type worth most.",
   was=["F-1 · PARTIAL","Grouping is now right — it joins the correct demand — but the type is <code>narrowing</code>, not <code>lateral</code>. Judging each query against its immediate predecessor is what loses it: an intervening broadening hides the swap. Reading against the query that OPENED the intent would catch it, which is a second axis rather than a bug fix, so it was not done. <code>classifyReformulation(\"ski wax\",\"snowboard wax\")</code> does return <code>lateral</code> — covered in the unit tests — so the type is reachable; this journey routes around it."]),
 21: dict(did="Returns next day and searches “goggles”", dep=["r"], v="ok",
   sum="Same browser, so the same user. The day boundary opens a third session, and the 30-minute bound stops yesterday's intent being inherited.",
   state="Browser id still in localStorage; previous event's timestamp is yesterday.",
   rule="A 30-minute gap <em>or</em> a change of store-local calendar day, via <code>instance_day()</code>. The intent window carries the same 30-minute bound, enforced inside <code>assignIntent</code> as well as in the SQL.",
   br=[["store-local day changed","new session",1],["same day","compare the gap instead",0]],
   cols=[["user_id","unchanged — same browser"],["account_id","(set once logged in)"]],
   dfn="A returning visitor is the same user as long as browser storage survives — it breaks on cleared storage, private mode, a new device, or roughly 7 days of inactivity under ITP.",
   was=["F-1","The window used to have no time bound at all, so an intent could be inherited across days and a “demand” could span a week."]),
 22: dict(did="Adds to cart while logged in", dep=["r"], v="gap",
   sum="The merge point — where the anonymous history is supposed to attach to the human. It does not happen.",
   state="Attribution store, cart token — and a logged-in customer the theme can see but the pixel cannot.",
   rule="The theme embed computes an account id from the Shopify <code>customer</code> object. The pixel runs in a sandboxed worker with no access to it, and <code>conversionPayload()</code> never sets one.",
   br=[["theme-side event (click, view)","account_id stamped",0],["pixel-side event (cart, checkout, order)","account_id NULL",1]],
   cols=[["event_name","Added to cart"],["account_id","NULL — on the very event that proves who the human is"]],
   dfn="“Login is the merge point. When <code>account_id</code> first appears for a browser id, the prior anonymous history attaches to the human.”",
   was=["F-4, F-5 · OPEN","No Shopify human's account has ever met their behaviour. Separately, the theme hashes <code>md5(customer.id)</code> where the definition specifies SHA-256 over (instance_id, customer id) — a bare md5 of a small integer is brute-forceable, and two instances hash the same id identically."]),
 23: dict(did="Searches “goggles” on another device", dep=["s"], v="gap",
   sum="Nothing before this exists here. A fresh browser means a fresh identity and a session counter that starts again at 1.",
   state="None — empty localStorage. Self-contained for the opposite reason to a click: not because it needs no history, but because its history is unreachable.",
   rule="<code>session_assignment</code> partitions by <code>(instance_id, user_id)</code> only. <code>account_id</code> is carried on the row but never partitioned by.",
   br=[["partition by user_id","session counter restarts",1],["partition by account_id","would continue the human's count — no such rollup exists",0]],
   cols=[["user_id","a second identity for one person"],["account_id","(set, but unused for grouping)"]],
   dfn="<code>account_id</code> is “the only handle that means a human across devices”.",
   was=["F-6 · OPEN","It means that on the row and nowhere else. A session count is a count of (browser, burst) pairs, correct only for a single-device shopper."]),
 24: dict(did="Completes the order on that device", dep=["r"], v="gap",
   sum="The purchase lands under the second identity, severed from the search chain that caused it.",
   state="Attribution store on device B — empty, since the clicks happened on device A.",
   rule="No attribution, so the Meilisearch write is skipped and the own store takes an unattributed conversion.",
   br=[["attribution found","attributed conversion",0],["none","own store only, no search credited",1]],
   cols=[["event_name","Completed order"],["query_uid","NULL — the search was on the other device"],["account_id","NULL — pixel"]],
   dfn="A journey is “one user's full path to an outcome across sessions”, and is the correct unit for purchase conversion.",
   was=["F-6 · OPEN","The journey is the one grain that spans devices, and the one with no identity to span them with. <code>journey_conversion</code> is tagged deferred as “identity-spanning, not a clean daily grain” — this is what that costs."]),
}


# ══════════════════════════════════════════════════════════════════════════
#  Render
# ══════════════════════════════════════════════════════════════════════════

def token_blocks(src: str) -> tuple[str, str]:
    """Lift the dark (:root) and light (.gl-light) token declarations out of
    _shell.html verbatim. Returned separately because the artifact build has to
    re-emit the light set under three different selectors."""
    start = src.index(":root{")
    end = src.index("}", src.index("--gl-accent-ink:var(--gl-accent);")) + 1
    lstart = src.index(".gl-light{")
    lend = src.index("}", src.index("--gl-accent-ink:var(--gl-accent-on-light);")) + 1
    dark = src[start:end]
    light = src[lstart:lend]
    # Just the declarations, so they can be wrapped in another selector.
    inner = light[light.index("{") + 1:light.rindex("}")].strip()
    return dark, inner


def tokens_from_shell(src: str) -> str:
    """Disk build: dark on :root, light on .gl-light, exactly as the shell has it."""
    dark, inner = token_blocks(src)
    return dark + "\n.gl-light{" + inner + "}"


def tokens_for_artifact(src: str) -> str:
    """Artifact build: same values, but the page must follow the VIEWER'S theme.

    GroLabs is dark-first, so the dark set stays on bare :root (with
    color-scheme, so native controls and scrollbars follow) and the light set is
    re-emitted under the two selectors the artifact platform actually uses — the
    OS preference when the viewer has made no explicit choice, and an explicit
    light choice — plus .gl-light, so the shell's own class still works if this
    markup is ever reused on disk. No colour is re-decided here; the values are
    the shell's, repeated under different selectors.
    """
    dark, inner = token_blocks(src)
    return "\n".join([
        dark[:-1] + "color-scheme:dark}",
        "@media (prefers-color-scheme: light){:root:not([data-theme=\"dark\"]){"
        + inner + "color-scheme:light}}",
        ":root[data-theme=\"light\"]{" + inner + "color-scheme:light}",
        "body.gl-light{" + inner + "}",
    ])


CSS = """
*{box-sizing:border-box}
body{margin:0;background:var(--gl-bg);color:var(--gl-text);font-family:var(--gl-font);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding-block:32px 96px;
  padding-left:max(16px,env(safe-area-inset-left,0px));
  padding-right:max(16px,env(safe-area-inset-right,0px))}
@media(min-width:720px){.wrap{padding-left:max(24px,env(safe-area-inset-left,0px));
  padding-right:max(24px,env(safe-area-inset-right,0px))}}
header.page{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}
h1{font-size:30px;line-height:1.15;margin:0 0 6px;color:var(--gl-text-strong);font-weight:650}
.sub{color:var(--gl-text-secondary);max-width:72ch;margin:0}
.sub + .sub{margin-top:8px}
button{font-family:inherit;font-size:13px;cursor:pointer;border-radius:var(--gl-radius-sm);
  border:1px solid var(--gl-border-strong);background:var(--gl-surface);color:var(--gl-text);
  padding:7px 13px}
button:hover{background:var(--gl-surface-hover)}
button:focus-visible{outline:2px solid var(--gl-accent-ink);outline-offset:2px}
section.card{background:var(--gl-surface);border:1px solid var(--gl-border);
  border-radius:var(--gl-radius-lg);padding:28px;margin-top:40px}
.sec-title{font-size:11px;letter-spacing:.11em;text-transform:uppercase;
  color:var(--gl-text-tertiary);font-weight:700;margin:0 0 4px}
.sec-note{color:var(--gl-text-secondary);margin:0 0 20px;max-width:78ch}
.rows{display:grid;gap:1px;background:var(--gl-border);border:1px solid var(--gl-border);
  border-radius:var(--gl-radius-md);overflow:hidden}
.row{display:grid;grid-template-columns:170px 1fr;background:var(--gl-surface)}
.row > .lbl{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;
  color:var(--gl-text-tertiary);padding:11px 14px;background:var(--gl-bg-deeper);
  white-space:nowrap}
.row > .lbl .prov{display:block;margin-top:5px;letter-spacing:.06em}
.row > .val{padding:11px 14px;min-width:0;overflow-wrap:break-word}
.row > .val.mono{font-family:var(--gl-font-mono);font-size:12.5px}
@media(max-width:640px){.row{grid-template-columns:1fr}
  .row > .lbl{padding-bottom:0;background:var(--gl-surface)}}
.pill{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;
  padding:2px 8px;border-radius:999px;border:1px solid;white-space:nowrap;vertical-align:middle}
.pill.ok{color:var(--gl-success-text);background:var(--gl-success-bg);border-color:var(--gl-success)}
.pill.gap{color:var(--gl-danger-text);background:var(--gl-danger-bg);border-color:var(--gl-danger);
  border-style:dashed}
.pill.reads{color:var(--gl-probe-site-wide);border-color:var(--gl-probe-site-wide);background:transparent}
.pill.writes{color:var(--gl-probe-category);border-color:var(--gl-probe-category);background:transparent}
.pill.alone{color:var(--gl-text-tertiary);border-color:var(--gl-border-strong);background:transparent}
.pill.ref{color:var(--gl-probe-search);border-color:var(--gl-probe-search);background:transparent}
/* Provenance is a classification, not a status, so it takes probe hues. */
.pill.measured{color:var(--gl-probe-homepage);border-color:var(--gl-probe-homepage);background:transparent}
.pill.verified{color:var(--gl-probe-category);border-color:var(--gl-probe-category);background:transparent}
.pill.authored{color:var(--gl-probe-pdp);border-color:var(--gl-probe-pdp);background:transparent}
.prov{font-size:9.5px;font-weight:700;text-transform:uppercase}
.prov.measured{color:var(--gl-probe-homepage)}
.prov.verified{color:var(--gl-probe-category)}
.prov.authored{color:var(--gl-probe-pdp)}
.legend{display:flex;flex-wrap:wrap;gap:10px 22px;margin:0;padding:0;list-style:none}
.legend li{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--gl-text-secondary)}
.legend.stack{flex-direction:column;gap:11px}
.legend.stack li{align-items:flex-start}
.legend.stack .pill{margin-top:1px;flex:none}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;
  padding:12px 0;margin-bottom:4px;background:var(--gl-bg);border-bottom:1px solid var(--gl-border)}
.bar .spacer{flex:1}
.bar .count{font-size:12.5px;color:var(--gl-text-tertiary)}
.visit{margin-top:26px}
.vhead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  padding:0 0 10px 2px;border-bottom:1px solid var(--gl-border)}
.vhead .vt{font-size:17px;font-weight:650;color:var(--gl-text-strong)}
.vhead .vm{font-size:12.5px;color:var(--gl-text-tertiary)}
.branch{border-left:2px solid var(--gl-border-strong);margin-left:10px;padding-left:16px}
details.node{margin-top:10px;background:var(--gl-bg-deeper);border:1px solid var(--gl-border);
  border-radius:var(--gl-radius-md)}
details.node[open]{background:var(--gl-surface)}
details.node > summary{list-style:none;cursor:pointer;padding:13px 16px;display:flex;
  gap:12px;align-items:flex-start}
details.node > summary::-webkit-details-marker{display:none}
details.node > summary:hover{background:var(--gl-surface-hover)}
details.node > summary:focus-visible{outline:2px solid var(--gl-accent-ink);outline-offset:-2px}
/* The expander. It was a bare grey "+" that read as decoration, and readers
   concluded the nodes simply withheld their detail. It is a control, so it is
   shaped like one: a bordered target, its own ground, and a hover state. */
.caret{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;margin-top:1px;border:1px solid var(--gl-border-strong);
  border-radius:var(--gl-radius-sm);background:var(--gl-surface);
  color:var(--gl-text);font-family:var(--gl-font-mono);font-size:14px;line-height:1;
  font-weight:700;transition:border-color .12s,background .12s}
details.node > summary:hover .caret{border-color:var(--gl-accent-ink);
  background:var(--gl-surface-hover)}
/* How much is inside, so a closed row says whether opening it is worth it. */
.howmany{margin-left:auto;flex:none;font-size:11px;letter-spacing:.04em;
  color:var(--gl-text-tertiary);white-space:nowrap;padding-left:12px}
details.node > summary:hover .howmany{color:var(--gl-accent-ink)}
details.node[open] .howmany{display:none}
.sumbody{flex:1;min-width:0}
.sumtop{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.step{font-family:var(--gl-font-mono);font-size:11.5px;color:var(--gl-text-tertiary);flex:none}
.did{font-weight:600;color:var(--gl-text-strong)}
.clock{font-family:var(--gl-font-mono);font-size:11.5px;color:var(--gl-text-tertiary)}
.sumline{color:var(--gl-text-secondary);font-size:13.5px;margin-top:3px}
.marks{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
/* The record itself, on the CLOSED row: destination plus the values written.
   Without it every node has to be opened to learn what it recorded. */
.rec{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-top:8px;
  font-family:var(--gl-font-mono);font-size:11.5px;line-height:1.5}
.rec .dest{color:var(--gl-text-strong);font-weight:700;white-space:nowrap;
  border:1px solid var(--gl-border-strong);border-radius:4px;padding:0 6px}
.rec .kvp{white-space:nowrap;color:var(--gl-text)}
.rec .kvp b{font-weight:600;color:var(--gl-text-tertiary)}
.rec .kvp.m b{color:var(--gl-probe-homepage)}
.rec .kvp .nul{color:var(--gl-text-muted)}
.nodebody{padding:0 16px 16px;margin-top:2px}
.branches{display:grid;gap:7px;margin:0;padding:0;list-style:none}
.branches li{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;
  padding:8px 11px;border-radius:var(--gl-radius-sm);border:1px solid transparent}
.branches li.taken{border-color:var(--gl-accent-ink);background:var(--gl-panel)}
.branches li.taken .bmark{color:var(--gl-accent-ink);font-weight:700}
.branches li.skipped{color:var(--gl-text-muted)}
.bmark{flex:none;font-family:var(--gl-font-mono);font-size:12px;width:24px}
code{font-family:var(--gl-font-mono);font-size:.92em;background:var(--gl-panel);
  padding:1px 5px;border-radius:4px;white-space:nowrap}
.kv{font-family:var(--gl-font-mono);font-size:12.5px;overflow-x:auto;display:block}
.kv table{border-collapse:collapse;min-width:100%}
.kv td{padding:3px 12px 3px 0;vertical-align:top}
.kv td.k{color:var(--gl-text-tertiary);white-space:nowrap}
.kv td.v.null{color:var(--gl-text-muted)}
.was{border-left:3px solid var(--gl-accent-ink);padding:2px 0 2px 14px;margin-top:14px}
.was .flabel{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;
  font-weight:700;color:var(--gl-accent-ink)}
.was p{margin:3px 0 0;color:var(--gl-text);max-width:78ch}
.banner{border:1px solid var(--gl-success);background:var(--gl-success-bg);
  border-radius:var(--gl-radius-md);padding:16px 18px;margin-top:20px}
.banner .ct{font-weight:700;color:var(--gl-success-text);margin:0 0 5px;font-size:14px}
.banner p{margin:0;color:var(--gl-text);max-width:80ch}
footer.meta{margin-top:40px;padding-top:16px;border-top:1px solid var(--gl-border);
  display:flex;flex-wrap:wrap;gap:6px 28px;font-size:12.5px;color:var(--gl-text-tertiary)}
"""

DEP = {"r": ("reads", "READS"), "w": ("writes", "WRITES"), "s": ("alone", "SELF")}


def lbl(text: str, prov: str) -> str:
    return (f'<div class="lbl">{text}'
            f'<span class="prov {prov}">{prov}</span></div>')


DEST = {"probe": "query_log", "committed": "query_log",
        "event": "analytics_event", "entity": "sales_order"}


def record_strip(step: dict, node: dict) -> str:
    """What this event actually wrote, on the closed row.

    Measured values (the intent facts, for a committed search) come from the
    driver and are keyed in the MEASURED hue; the rest are the authored column
    list. Everything here also appears expanded — the strip is a summary, not a
    second source.
    """
    pairs = []
    if step["kind"] == "committed":
        pairs.append(("intent_group_id", step["intent"], True))
        pairs.append(("reformulation_type", step["type"] or "NULL", True))
        if step["previous"]:
            pairs.append(("previous_query", step["previous"], True))
    for k, v in node["cols"]:
        pairs.append((k, v, False))

    out = [f'<span class="dest">{DEST[step["kind"]]}</span>']
    for k, v, measured in pairs:
        null = "NULL" in str(v) or str(v).startswith("(")
        val = (f'<span class="nul">{html.escape(str(v))}</span>' if null
               else html.escape(str(v)))
        out.append(f'<span class="kvp{" m" if measured else ""}">'
                   f'<b>{html.escape(k)}</b>={val}</span>')
    return '<div class="rec">' + "".join(out) + "</div>"


def kv(pairs) -> str:
    out = ['<div class="kv"><table>']
    for k, v in pairs:
        cls = " null" if v.startswith("(") or "NULL" in v else ""
        out.append(f'<tr><td class="k">{html.escape(k)}</td>'
                   f'<td class="v{cls}">{html.escape(v)}</td></tr>')
    out.append("</table></div>")
    return "".join(out)


def render(data: dict, artifact: bool = False) -> str:
    by_n = {s["n"]: s for s in data["steps"]}
    t = data["totals"]
    parts = []

    for vtitle, vmeta, nums in VISITS:
        parts.append('<div class="visit"><div class="vhead">'
                     f'<span class="vt">{vtitle}</span>'
                     f'<span class="vm">{vmeta}</span>'
                     f'<span class="vm">· {SESSIONS[vtitle]}</span>'
                     f'<span class="vm">· {len(nums)} events</span>'
                     '</div><div class="branch">')
        for n in nums:
            node, step = NODES[n], by_n[n]
            parts.append('<details class="node"><summary><span class="caret">+</span>'
                         '<div class="sumbody"><div class="sumtop">'
                         f'<span class="step">#{n}</span>'
                         f'<span class="did">{node["did"]}</span>'
                         f'<span class="clock">{step["at"][11:19]}</span>'
                         f'<span class="howmany">{len(node["br"])} branches &nbsp;·&nbsp; open</span>'
                         '</div>'
                         f'<div class="sumline">{node["sum"]}</div>'
                         + record_strip(step, node)
                         + '<div class="marks">')
            for d in node["dep"]:
                cls, txt = DEP[d]
                parts.append(f'<span class="pill {cls}">{txt}</span>')
            parts.append(f'<span class="pill {node["v"]}">'
                         f'{"MATCH" if node["v"] == "ok" else "GAP"}</span>'
                         '</div></div></summary><div class="nodebody">')

            parts.append('<div class="rows">'
                         f'<div class="row">{lbl("State in","authored")}'
                         f'<div class="val">{node["state"]}</div></div>'
                         f'<div class="row">{lbl("Rule","authored")}'
                         f'<div class="val">{node["rule"]}</div></div></div>')

            parts.append('<div class="rows">'
                         f'<div class="row">{lbl("Branch taken","authored")}'
                         '<div class="val"><ul class="branches">')
            for cond, outcome, taken in node["br"]:
                parts.append(f'<li class="{"taken" if taken else "skipped"}">'
                             f'<span class="bmark">{"&rarr;" if taken else "·"}</span>'
                             f'<span><strong>{cond}</strong> — {outcome}</span></li>')
            parts.append("</ul></div></div>")

            # MEASURED — straight from executing the real code.
            if step["kind"] == "committed":
                m = [("intent_group_id", step["intent"]),
                     ("reformulation_type", step["type"] or "NULL (opens the intent)"),
                     ("previous_query", step["previous"] or "NULL (opens the intent)")]
                parts.append(f'<div class="row">{lbl("Intent recorded","measured")}'
                             f'<div class="val mono">{kv(m)}</div></div>')
            parts.append(f'<div class="row">{lbl("Other columns","authored")}'
                         f'<div class="val mono">{kv(node["cols"])}</div></div>'
                         f'<div class="row">{lbl("Defined as","authored")}'
                         f'<div class="val">{node["dfn"]}</div></div></div>')

            if node["was"]:
                parts.append(f'<div class="was"><div class="flabel">{node["was"][0]}</div>'
                             f'<p>{node["was"][1]}</p></div>')
            parts.append("</div></details>")
        parts.append("</div></div>")

    gaps = sum(1 for n in NODES if NODES[n]["v"] == "gap")
    tally = (f'{len(NODES)} events · {len(NODES) - gaps} match · {gaps} still open · '
             f'{t["intents"]} intents from {t["committed"]} committed searches')

    live = "".join(f'<div class="row">{lbl(k,"verified")}<div class="val">{v}</div></div>'
                   for k, v in LIVE)
    cover = {"yes": '<span class="pill ok">IN THE TREE</span>',
             "partly": '<span class="pill reads">PARTLY</span>',
             "no": '<span class="pill gap">NOT IN THE TREE</span>'}
    everything = "".join(
        f'<div class="row">{lbl(k,"verified")}'
        f'<div class="val">{cover[c]} <strong>{n}</strong> rows &middot; {why}</div></div>'
        for k, n, c, why in EVERYTHING)
    stores = "".join(f'<div class="row">{lbl(k,"authored")}<div class="val">{v}</div></div>'
                     for k, v in STORES)

    shell_src = SHELL.read_text(encoding="utf-8")
    if artifact:
        # No doctype/html/head/body: the artifact platform supplies the
        # skeleton, and duplicating it would nest one document inside another.
        head = f"""<title>Event Semantics Trace</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* GroLabs tokens, lifted from dev-studio/apps/spec/_shell.html at build time.
   Dark is the default (the shell's rule); the light set is re-emitted under the
   selectors the viewer's theme actually sets. */
{tokens_for_artifact(shell_src)}
{CSS}</style>"""
        open_tag = ""
    else:
        head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Event Semantics Trace</title>
<style>
/* GroLabs tokens, lifted from dev-studio/apps/spec/_shell.html at build time. */
{tokens_from_shell(shell_src)}
{CSS}</style>
</head>
<body>"""
        open_tag = ""

    theme_btn = ("" if artifact else
                 '<button id="theme" type="button">Light</button>')
    theme_js = ("" if artifact else """
const btn = document.getElementById("theme");
btn.onclick = () => {
  const light = document.body.classList.toggle("gl-light");
  btn.textContent = light ? "Dark" : "Light";
};""")
    close = "" if artifact else "\n</body>\n</html>"

    return f"""{head}
<div class="wrap">

<header class="page">
  <div>
    <h1>Event semantics trace</h1>
    <p class="sub">One shopper journey. Each node is one event: open it to see the state the
      decision reads, the branch the code takes, and what gets recorded. Nodes marked
      <span class="pill alone">SELF</span> decide nothing from history — they would record the
      same thing on a fresh browser.</p>
    <p class="sub"><strong>This page is generated.</strong> Every row says where its claim comes
      from, because the three kinds are not equally trustworthy.</p>
  </div>
  {theme_btn}
</header>

<section class="card">
  <p class="sec-title">Where each claim comes from</p>
  <ul class="legend stack">
    <li><span class="pill measured">MEASURED</span><span>Produced by <strong>executing the real
      code</strong> at build time — <code>src/lib/analytics/intent.ts</code> run over this
      journey. No intent id or type name is typed anywhere in the generator, and the build fails
      if a measured value does not reach the page.</span></li>
    <li><span class="pill verified">VERIFIED</span><span>Produced by running the <strong>real
      SQL</strong> once against the live database and recorded with its date
      ({MEASURED_ON}) — session numbers from <code>session_assignment</code>'s own window
      expression, counts from <code>query_log</code> and <code>analytics_event</code>. Recorded
      rather than re-run so the build needs no credentials.</span></li>
    <li><span class="pill authored">AUTHORED</span><span><strong>Read out of the source by a
      person.</strong> What state a decision reads, which branches exist, what the definitions
      say. This is the half that can drift, and it is marked on every row so you know which
      cells to distrust.</span></li>
  </ul>
</section>

<section class="card">
  <p class="sec-title">What the badges on each event mean</p>
  <p class="sec-note">Every closed row carries the record itself: the table written, then the
    values, with the <span class="prov measured">MEASURED</span> ones — those produced by
    running the real code — keyed in their own colour. Open a node for how the decision was
    reached. The badges answer two separate questions. The first three are <em>does history
    matter here?</em> and say nothing about whether the event is right; the last two are the
    verdict.</p>
  <ul class="legend stack">
    <li><span class="pill reads">READS</span><span><strong>What this event records depends on
      an earlier one.</strong> Step 12, add to cart, carries a <code>query_uid</code> only
      because the click at step 10 stored one 40 seconds earlier. Take the click away and the
      same add-to-cart records something different.</span></li>
    <li><span class="pill writes">WRITES</span><span><strong>It leaves something behind that a
      later event will read.</strong> Step 10 is the click that writes that attribution. An
      event can be both: step 7 reads the window and then joins it.</span></li>
    <li><span class="pill alone">SELF</span><span><strong>Neither — it would record exactly the
      same thing on a brand-new browser.</strong> Step 11, the product view, takes the product
      id off the page it is on. Nothing before it changes the row. These are the events you can
      test one at a time; the <span class="pill reads">READS</span> ones can only be tested in
      sequence.</span></li>
    <li><span class="pill ok">MATCH</span><span><strong>What we record is what the definitions
      say to record.</strong> The branch the code took is the branch the grammar names.</span></li>
    <li><span class="pill gap">GAP</span><span><strong>It is not.</strong> The event is
      recorded, but as something other than what it means — so anything built on it is
      confidently wrong rather than missing. Five are left; each says which finding it belongs
      to, and the card below says why we record them at all.</span></li>
  </ul>
</section>

<section class="card">
  <p class="sec-title">Why record an event we know is wrong?</p>
  <p class="sec-note">A <span class="pill gap">GAP</span> is not a bug report, and it is not a
    reason to drop the event. In every one of the five, the write <em>succeeded</em> — nothing
    threw, nothing returned an error, the row is in the table and the funnel counts it. The
    event is true; what is wrong is a claim placed on it. Three different ways that happens:</p>

  <div class="rows">
    <div class="row"><div class="lbl">The field is not there to write<span class="prov authored">AUTHORED</span></div>
      <div class="val"><strong>Step 19 — add to cart, logged in.</strong> The shopper has just
        signed in, so the theme can see who they are. Then the <em>pixel</em> fires the
        conversion, and the pixel runs in a sandboxed worker with no access to the theme's
        <code>customer</code> object. The row lands: <code>conversion</code>,
        <code>Added to cart</code>, <code>cart_id</code> set, <code>account_id</code> NULL. HTTP
        202. The cart thread is right, the funnel is right, the conversion count is right.
        <br><br>Dropping that event to avoid the missing field would be strictly worse — you
        would lose a real add-to-cart. So we record it, and the gap is that the definition calls
        login “the merge point where anonymous history attaches to the human”, and this is the
        one row that proves who the human is while carrying nothing that identifies them. Ask
        “what are logged-in customers buying?” and you get <strong>nothing back — not an
        error</strong>. The honest reading is “we don't stamp accounts on purchases”. The
        reading you'd actually take is “logged-in customers don't buy”.</div></div>

    <div class="row"><div class="lbl">Every column is correct, the grain is not<span class="prov authored">AUTHORED</span></div>
      <div class="val"><strong>Step 23 — the same person, on their phone.</strong> This is the
        purest case: there is nothing to fix in the row. <code>user_id</code>, intent,
        <code>session_seq</code> — each is exactly what the code should write, given that
        identity lives in one browser's localStorage. The event <em>must</em> be recorded; a
        purchase on the second device is real revenue.
        <br><br>The gap is one level up. Counted against “one user, one session, one intent”,
        this person is now two users, their session counter has restarted at 1, and
        <code>goggles</code> has a fourth intent although step 21 already opened that demand.
        Your user count, session count and intent count are each one too high, and no column
        anywhere disagrees with itself. This is why a gap is not a bug: nothing
        malfunctioned.</div></div>

    <div class="row"><div class="lbl">The rule that ran is not the rule named<span class="prov authored">AUTHORED</span></div>
      <div class="val"><strong>Step 20 — “snowboard wax”.</strong> It joins the right demand and
        gets a type, so the row is complete and plausible. But the type is
        <code>narrowing</code> where the definition says <code>lateral</code>, because the chain
        judged it against <code>wax</code> rather than <code>ski wax</code>.
        <br><br>The two labels prescribe different work: narrowing says add a facet, lateral says
        add a synonym for <em>ski ↔ snowboard</em>. A missing type would send nobody anywhere; a
        confident wrong one sends them to the wrong fix.</div></div>
  </div>

  <p class="sec-note" style="margin:20px 0 0"><strong>So the remedy is never “stop recording”.</strong>
    It is to record the thing that tells the two cases apart — a field, a different grain, or a
    rule that matches the definition. A row that is absent shows up as a zero and someone asks
    why. A row that is present and means something else is read as fact.</p>
</section>

<section class="card">
  <p class="sec-title">The state these decisions read</p>
  <p class="sec-note">Everything in the “given what happened before” column lives in one of
    these five places. Four are in the shopper's browser, which is why clearing storage or
    switching device changes what gets recorded.</p>
  <div class="rows">{stores}</div>
</section>

<section class="card">
  <p class="sec-title">What the live data looks like</p>
  <p class="sec-note">The journey is scripted; these are the real tables on {MEASURED_ON}.</p>
  <div class="rows">{live}</div>
</section>

<section class="card">
  <p class="sec-title">Everything the system records</p>
  <p class="sec-note">The journey below is one path, and it is search-shaped. This is the whole
    surface, with row counts read from the live database on {MEASURED_ON} — so what the journey
    does <em>not</em> exercise is visible rather than implied.</p>
  <div class="rows">{everything}</div>
</section>

<section class="card">
  <p class="sec-title">The journey</p>
  <p class="sec-note">One person, one browser, four visits — scripted so each defined branch is
    exercised once: all four reformulation types, a session boundary by inactivity, one by day,
    a login, and a second device.</p>

  <div class="bar">
    <button id="expand" type="button">Expand all</button>
    <button id="collapse" type="button">Collapse all</button>
    <span class="spacer"></span>
    <span class="count">{tally}</span>
  </div>

  {"".join(parts)}

  <div class="banner">
    <p class="ct">Event time now survives the pipeline — reported as an age, not a timestamp</p>
    <p>Every timestamp above is the shopper's. It used not to reach the row at all: the
      storefront stamped no event time, <code>event_inbox</code> kept only
      <code>received_at</code>, and the drain omitted <code>created_at</code> — so it took the
      default, <em>the moment the drain ran</em>, collapsing every event in a drain window onto
      one instant and flattening the 30-minute gaps these session boundaries are built on. The
      storefront now reports how long <strong>ago</strong> each event happened and the receiver
      computes <code>occurred_at = received_at − age_ms</code> against our own clock. An age
      rather than a timestamp because both readings behind it come from the device's own clock,
      so a phone set to the wrong year still reports a correct age and the error cancels; an
      absolute client timestamp would have imported every broken clock on the internet into the
      KPI series. The drain is scheduled now, and walks each batch in event-time order rather
      than arrival order, because the retry queue can deliver an old event after a newer one.
      Rows written before this keep drain time and are not backfillable — the information was
      never sent.</p>
  </div>
</section>

<footer class="meta">
  <span>Generated from {DRIVER.name}</span>
  <span>Measured {MEASURED_ON}</span>
  <span>Intent window {data["windowMs"] // 60000} min</span>
  <span>reformulation_rate {t["reformulationRate"]:.3f}</span>
  <span>Companion to event-semantics-trace.md</span>
</footer>

</div>
<script>
const all = () => Array.from(document.querySelectorAll("details.node"));
all().forEach(d => d.addEventListener("toggle", () => {{
  d.querySelector(".caret").textContent = d.open ? "\\u2212" : "+";
}}));
all()[0].open = true;
document.getElementById("expand").onclick = () => all().forEach(d => d.open = true);
document.getElementById("collapse").onclick = () => all().forEach(d => d.open = false);{theme_js}
</script>{close}
"""


# ══════════════════════════════════════════════════════════════════════════
#  Build
# ══════════════════════════════════════════════════════════════════════════

def main() -> int:
    data = measured()

    # Coverage FIRST. render() indexes both sides by step number, so a gap here
    # would otherwise surface as a bare KeyError from deep inside rendering
    # instead of saying which step is unaccounted for. Found by deliberately
    # removing a node and watching the build fail with the wrong message.
    driver_steps = {s["n"] for s in data["steps"]}
    authored = set(NODES)
    missing = driver_steps - authored
    extra = authored - driver_steps
    assert not missing, f"driver reported steps with no authored prose: {sorted(missing)}"
    assert not extra, f"authored prose for steps the driver does not know: {sorted(extra)}"
    for vtitle, _, nums in VISITS:
        for n in nums:
            assert n in driver_steps, f"{vtitle} lists step {n}, which the driver never ran"
    listed = [n for _, _, nums in VISITS for n in nums]
    assert sorted(listed) == sorted(driver_steps), \
        f"visits cover {sorted(listed)} but the driver ran {sorted(driver_steps)}"

    page = render(data)

    # Every MEASURED value must actually appear in the page.
    for s in data["steps"]:
        if s["kind"] != "committed":
            continue
        assert s["intent"] and s["intent"] in page, \
            f"step {s['n']}: measured intent={s['intent']!r} did not reach the page"
        # `type` is legitimately null on a query that OPENS an intent — there is
        # no previous query to relate it to. Only a non-null one must appear.
        if s["type"]:
            assert s["type"] in page, \
                f"step {s['n']}: measured type={s['type']!r} did not reach the page"
        if s["previous"]:
            assert html.escape(s["previous"]) in page or s["previous"] in page, \
                f"step {s['n']}: measured previous_query did not reach the page"

    assert f'{data["totals"]["intents"]} intents' in page, "intent total did not reach the page"
    assert "://" not in page.replace("http-equiv", ""), "the page must not reach off disk"
    for v in VISITS:
        assert v[0] in SESSIONS, f"visit {v[0]} has no verified session number"

    OUT.write_text(page, encoding="utf-8")

    # The artifact variant: same generator, same measured data, platform shell.
    art = render(data, artifact=True)
    assert "<!doctype" not in art.lower(), "artifact build must not carry a doctype"
    assert "<body" not in art.lower(), "artifact build must not carry a body tag"
    assert 'id="theme"' not in art, "artifact follows the viewer's theme; no toggle"
    assert "prefers-color-scheme: light" in art, "artifact needs the light token block"
    ART.write_text(art, encoding="utf-8")

    t = data["totals"]
    print(f"wrote {OUT.name}  ({len(page):,} bytes)")
    print(f"wrote {ART.name}  ({len(art):,} bytes) — for publishing as an artifact")
    print(f"  steps          {len(data['steps'])} ({t['committed']} committed, {t['probes']} probes)")
    print(f"  intents        {t['intents']} — measured by running the real assignIntent")
    print(f"  rewrites       {', '.join(t['rewrites'])}")
    print(f"  reformulation_rate {t['reformulationRate']:.3f}")
    print(f"  gaps still open    {sum(1 for n in NODES if NODES[n]['v'] == 'gap')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
