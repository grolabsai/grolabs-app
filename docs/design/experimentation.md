---
application: core-app
module: Design
title: "Experimentation — proving a storefront change worked without a billion sessions"
status: Draft
owner: "Tuncho"
scope: "How GroLabs establishes that a storefront change (search-bar placement, facet position and presentation, natural-language filtering) caused more revenue. Covers the designs available to us, what each can and cannot prove, the traffic each needs, and the instrumentation prerequisites. Directional — no experiment has been run."
audience: "Claude Code (implementer), and anyone about to claim a storefront change 'worked'."

actors:
  - name: Shopper
    type: human
    definition: Sees one presentation of the storefront. Never knowingly in an experiment; never asked.
  - name: Merchant
    type: human
    definition: Owns the store whose conversion is being moved. In a staggered rollout, a store is the unit of assignment.
  - name: GroLabs theme
    type: system
    definition: The eventual GroLabs-owned Shopify theme, which is what makes layout a thing we control rather than a thing we ask the merchant to change.
  - name: Measurement layer
    type: system
    definition: query_log + analytics_event + sales_order + metric_daily. Supplies every number an experiment reads. See event-tracking.md and conversion-measurement-foundations.md.

integrations:
  - name: metric_daily
    kind: internal-module
    target: KPI rollups
    direction: in
    purpose: Daily per-instance series. The unit a switchback or staggered rollout compares.
  - name: signals.ts
    kind: internal-module
    target: SPC engine
    direction: in
    purpose: Control limits, run rules and CUSUM over a weekly series. Correct for a switchback; wrong for a per-visitor A/B.

rules:
  - id: R-1
    statement: "Per-visitor A/B on Shopify has a rendering problem before it has a statistics problem. Liquid renders server-side and cannot read cookies, so the theme cannot know a shopper's arm at render time. Assigning client-side moves the element after paint — which corrupts the very thing a PLACEMENT test measures and charges the variant a layout-shift penalty for existing."
    truth: true
    rationale: "The bucketing identity (grolabs_bid) lives in a cookie and localStorage, neither of which Liquid can read. The practical workaround in a theme we own is to render both arms and reveal one with CSS before first paint: no flicker, no extra request, at the cost of duplicated DOM for that component. Acceptable for a search bar or a facet rail, not for a page."
  - id: R-2
    statement: "Traffic, not code, is what makes a conversion A/B infeasible for most merchants. At 80% power and 5% significance, detecting a 10% relative lift needs roughly 6,400 sessions per arm on a 20% search CTR, and roughly 78,000 per arm on a 2% purchase conversion."
    truth: true
    rationale: "n ≈ 16·p(1−p)/δ². The asymmetry is the whole point: interaction rates fire many times per session, purchases fire 0.02 times. Any design that needs purchase significance per arm is out of reach for an SMB store; any design that reads interaction rates is not."
  - id: R-3
    statement: "A switchback — move the bars for every shopper for a period, then compare periods — randomises TIME rather than people. It is therefore a real intervention and yields a causal total effect, and it sidesteps R-1 entirely because there is only ever one layout rendered."
    truth: true
    rationale: "Decided as the preferred first design. No bucketing, no dual DOM, no flicker, and nothing to get wrong per visitor. The cost moves to time confounding (R-4)."
  - id: R-4
    statement: "One week against one week proves nothing. A single changeover confounds the treatment with everything else that differed between those weeks — promotions, seasonality, traffic mix, day-of-week composition, a competitor's sale."
    truth: true
    rationale: "The fix is alternation, not duration: A/B/A/B over four or more periods, so a slow trend cancels instead of loading onto the arm it happens to coincide with. A single A→B step is an anecdote with a p-value."
  - id: R-5
    statement: "Every switchback carries a NEGATIVE CONTROL metric — one the change cannot plausibly affect, such as conversion for sessions that never reached the filter surface. If the control moves with the treatment, what was measured is the period, not the change."
    truth: true
    rationale: "The cheapest protection against R-4 that exists, and the one most often skipped. It converts 'conversion went up' into 'conversion went up and the thing that should not have moved did not'."
  - id: R-6
    statement: "SPC (signals.ts) is the RIGHT statistics for a switchback and the WRONG statistics for a per-visitor A/B. A switchback is a time series with a known intervention point, which is exactly what control limits, run rules and CUSUM detect."
    truth: true
    rationale: "Stated because the reverse mistake is easy and expensive. A/B needs fixed-horizon sizing or a proper sequential test; reusing SPC there produces confident nonsense. Reusing it here is reusing machinery that already exists and is already tested against real instance data."
  - id: R-7
    statement: "'Shoppers who filter buy more' is NOT evidence that promoting filters causes purchases. Filter users self-select: they already arrived with higher intent. Observationally this correlation will hold on nearly every store and it says nothing about the effect of making filters prominent."
    truth: true
    rationale: "The classic mediation trap, and the one weak link in an otherwise good argument. The resolution is that the intervention itself supplies causality: a switchback measures the TOTAL effect of the placement change on revenue directly, and the rise in filter usage then EXPLAINS that effect rather than proving it. Report both; lean on the first."
  - id: R-8
    statement: "The strongest design available to GroLabs is not a switchback at all — it is a STAGGERED ROLLOUT across stores. Release the change to merchants in waves and compare changed against not-yet-changed stores over the same calendar period."
    truth: true
    rationale: "A difference-in-differences / stepped-wedge design. It removes time confounding outright (both groups live through the same week), pools traffic across the whole fleet instead of depending on one store's volume, and matches how a theme is actually rolled out. Under 100 tenants makes it administratively trivial, and every store ends up treated, so no merchant is held back as a permanent control. This is the design the multi-tenant architecture makes available and a single-store product cannot have."
  - id: R-9
    statement: "An experiment cannot be trusted while F-4 and F-6 are open. F-6 (sessions and intents partition by browser, never by account) means one human on two devices is two subjects — in a switchback they may straddle the changeover, and in any per-visitor design they can land in both arms. F-4 (no account_id on any revenue event) means a revenue result is computed on a grain that splits one person into several."
    truth: true
    rationale: "See docs/state/event-semantics-trace.md. Experimentation amplifies measurement defects rather than tolerating them, so these move from findings to prerequisites."
  - id: R-10
    statement: "Filter usage is not currently recorded at all, so the first link of the argument cannot be measured yet. There is no facet UI in the GroLabs storefront (FACET_ALLOWLIST and sanitizeFacets are dead code from the proxy), query_log has no filter column, and the pixel does not subscribe to collection_viewed."
    truth: true
    rationale: "Verified 2026-11-02. Any filtering shoppers do today happens in the merchant's own theme and is invisible to us. The cheap first step is to derive it: Shopify's native filters live in the URL, so parse them off collection_viewed and treat a change between consecutive views as a filter application."
  - id: R-11
    statement: "Measure whether filters are used BEFORE building better filters. The URL-derived instrumentation answers 'do shoppers filter at all, and what happens when they do' without any new UI — and that is the evidence for whether a GroLabs facet rail is worth building, let alone worth testing the placement of."
    truth: true
    rationale: "Same order the intent-grain work used: measure first, then fix. Building a facet UI in order to discover whether facets matter is the expensive way round."

useCases:
  - id: T-1
    title: Placement change raises filter usage
    given: Filter usage rate per session is instrumented and has a stable baseline
    when: The top three filters move from the left rail to the middle, for every shopper, alternating weekly over four weeks
    then: The change in filter usage rate is detectable at a few hundred sessions per period, because the metric fires many times per session
    verifies: [R-2, R-3, R-4]
  - id: T-2
    title: A period effect is caught before it is reported as a win
    given: A switchback where conversion rose in the treatment periods
    when: The negative-control metric — conversion for sessions that never reached the filter surface — rose by a similar amount
    then: The result is reported as a period effect, not an effect of the change
    verifies: [R-5]
  - id: T-3
    title: Self-selection is not mistaken for causation
    given: Shoppers who use filters convert at three times the rate of those who do not
    when: Someone proposes this as evidence that promoting filters will raise revenue
    then: It is rejected as observational; only the intervention's total effect supports that claim
    verifies: [R-7]
  - id: T-4
    title: The fleet supplies the power one store lacks
    given: A change that no single merchant has the traffic to evaluate on conversion
    when: It is released to merchants in waves and compared against not-yet-released stores in the same weeks
    then: Traffic pools across the fleet and the comparison is free of time confounding
    verifies: [R-8]
---

# Experimentation — proving a storefront change worked

Status: **Directional.** No experiment has been run and none of this is built. Written
2026-11-02 out of the question "could the GroLabs theme A/B test where the search bar and
the facets go, and is that too difficult?"

The short answer: **not too difficult, and the expensive half is already built** — but the
design most people reach for first (per-visitor A/B on purchase conversion) is the one
design that cannot work here, and the design that suits GroLabs best is one a
single-store product could not run at all.

## 1. What already exists

Two things that are normally the hard part:

- **A stable bucketing identity.** `grolabs_bid`, a cookie plus `localStorage`, already
  shared by the theme, the typeahead and the pixel. `hash(bid + experiment_id) % 100` gives
  a deterministic arm with no assignment service and no network call.
- **A measurement spine.** Committed-vs-probe separation, an intent grain, sessions, a
  journey thread on `cart_id`, an order entity for revenue, and a measured telemetry-loss
  ratio. Adding a variant is one column on `query_log` and `analytics_event`;
  `metric_daily` is keyed `(instance_id, day, metric_key, grain, …)` so a variant joins the
  grain.

## 2. The four designs, and what each buys

| Design | Randomises | Proves | Needs | Verdict |
|---|---|---|---|---|
| **Per-visitor A/B** | people | causal, per-arm | flicker-free render (R-1) + huge n (R-2) | last resort |
| **Switchback** | time | causal total effect | alternation + a negative control | **good first design** |
| **Staggered rollout** | stores × time | causal, fleet-pooled | several merchants on one release | **best available** |
| **Observational** | nothing | association only | nothing | never sufficient (R-7) |

### Why not per-visitor A/B

Liquid renders server-side and cannot read cookies, so the theme cannot know the arm at
render time. Assigning client-side moves the search bar *after paint* — which corrupts the
thing a placement test is measuring and charges the variant a layout-shift penalty for
existing. Render-both-reveal-one solves it for small components, but the traffic problem
remains:

| Metric | Baseline | Sessions **per arm** for a 10% relative lift |
|---|---|---|
| Search CTR | 20% | ~6,400 |
| Purchase conversion | 2% | ~78,000 |

The asymmetry is the whole argument. Interaction rates fire many times a session; purchases
fire 0.02 times.

### Why the switchback is the right first move

Move the bars for everyone for a period, then compare periods. There is only ever one
layout rendered, so R-1 disappears entirely — no bucketing, no duplicated DOM, no flicker,
nothing to get wrong per visitor. It is a real intervention, so it yields a causal effect
rather than an association.

Two conditions make it honest rather than anecdotal:

1. **Alternate, don't switch once.** A/B/A/B over four or more periods. One week against one
   week confounds the change with the week — a promotion, a season, a competitor's sale. The
   fix is alternation, not a longer single period.
2. **Carry a negative control.** A metric the change cannot plausibly affect — conversion for
   sessions that never reached the filter surface is the natural one here. If it moves with
   the treatment, what was measured is the period.

And the machinery for reading it already exists: a switchback is a time series with a known
intervention point, which is exactly what `signals.ts` was built for. Note the asymmetry in
R-6 — SPC is right here and wrong for per-visitor A/B. Do not carry it across.

### Why the staggered rollout is better still

GroLabs is multi-tenant, one deployable, under 100 merchants. So release the change in
waves and compare changed stores against not-yet-changed stores **over the same calendar
weeks**. Time confounding vanishes because both groups live through the same period, and
traffic pools across the fleet instead of depending on one store's volume. Every store is
treated eventually, so nobody is held back as a permanent control.

This is a difference-in-differences design, and it is available precisely because of the
architecture: a single-store product cannot run it.

## 3. The one weak link in the argument

The appealing chain is:

> placement change → filters used more → **and** people who use filters buy more → therefore
> the placement change raises revenue.

The first link is sound and cheap to measure. **The third is not evidence.** Shoppers who
filter self-select: they arrived with higher intent, which is why they bother. That
correlation will hold on nearly every store and it says nothing about the effect of making
filters prominent. Promoting filters to low-intent shoppers does not give them high-intent
behaviour.

The resolution is that **the intervention supplies the causality**. A switchback or a
staggered rollout measures the total effect of the change on revenue directly, and the rise
in filter usage then *explains* that effect instead of proving it. Report both; rest the
claim on the first. That ordering is what separates "we have evidence" from "we have a
correlation and a story".

## 4. Prerequisites, in order

1. **Close F-6 and F-4** (`docs/state/event-semantics-trace.md`). Sessions and intents
   partition by browser and never by account, and no revenue event carries an `account_id`.
   Until both are closed, one human on two devices is two subjects and a revenue result is
   computed on a grain that splits people apart. Experimentation amplifies measurement
   defects; these stop being findings and become blockers (R-9).
2. **Instrument filter usage at all** (R-10). There is no facet UI, `query_log` has no
   filter column, and the pixel does not subscribe to `collection_viewed`. Derive it from
   the URL first: Shopify's native filters live in the query string, so a change between
   consecutive collection views is a filter application. No new UI required.
3. **Add `variant` / `release_wave` as a dimension** on `query_log`, `analytics_event` and
   the `metric_daily` grain.
4. **Then** run a switchback on an interaction-rate metric, which the traffic supports.
5. **Then** a staggered rollout on conversion, once there are enough stores on the theme.

Conversion-on-one-store, per-visitor, is the last thing to attempt, not the first.

## 5. Related

- `docs/state/event-semantics-trace.md` — the findings this depends on, F-4 and F-6.
- `docs/design/event-tracking.md` — the store an experiment reads.
- `docs/design/conversion-measurement-foundations.md` — the KPI grammar and the session,
  intent and journey grains.
- `docs/design/direct-meilisearch-search.md` — why the storefront renders the way it does.

---

**End — directional. Nothing built; the prerequisites in §4 are the actual next work.**
