# Scout Dashboard — Design Brief

> **Editor's note:** Reframed 2026-05-17 to conform to Constitution Article 1. Previous version positioned the dashboard as for 'pet supply ecommerce stores.' GroLabs is industry-agnostic; the pet-shop angle is one of several vertical templates, not the product's identity.

Status: Brief for visual / UX design (claude.ai/design workflow)
Owner: Tuncho
Audience: Designer (Claude in claude.ai), then implementer (Claude Code)

This brief is meant to be copy-pasted into a fresh design conversation. The designer has zero context on Scout — give them everything they need to produce mockups that are immediately implementable. After mockups land, they come back to Claude Code for HTML/CSS implementation matching the existing visual language.

---

## What Scout is

Scout is a multi-tenant admin app for **solopreneur-run ecommerce stores** in Latin America (primarily Guatemala, Spanish-speaking). It is **industry-agnostic by design** — merchants come from any vertical (pet-shop, electronics, jewelry, clothing, …), each provisioned from the matching vertical template; no vertical is privileged in the product. Each merchant has one "instance" — their products, categories, attributes, integrations, and now their analytics live there.

Today the merchant logs into a sidebar-driven web app and manages: product catalog, categories, attributes, pricing rules, WooCommerce sync, search configuration, imports. The app is at production at `scout.gro.gt` (or similar — check live URL).

The user is **time-poor and not technically deep**. They run a small store, wear every hat, and don't want to learn analytics tooling. The dashboard is where they should be able to glance for 60 seconds each morning and know whether anything needs their attention.

## What lives on the dashboard today

`/dashboard` currently shows **no-results search analytics from Algolia** — search queries that returned zero hits, surfaced so the merchant can add synonyms or new products to fill the gap. This is the only screen on the dashboard right now and it's a single full-page table.

## What's coming (the dashboard is becoming a multi-section cockpit)

The dashboard needs to evolve from "one screen, one data source" to **a unified daily cockpit with multiple sections**, each surfacing one signal type:

1. **Traffic & engagement** (Google Analytics 4) — *priority for v1*
   - Daily digest of top-3 traffic-health metrics with WoW comparison
   - "Active users right now" live widget (refreshed every 30s)
   - Active alerts inbox when thresholds are breached
   - Charts for sessions and engagement over the last 14 days
   - Top channels, landing pages, exit pages, geo
2. **Search behavior** (existing Algolia no-results, plus future Meilisearch search analytics)
3. **Catalog health** (planned) — import status from WooCommerce, enrichment progress, missing attributes
4. **Pricing activity** (planned) — recent price changes, MAP violations, batches awaiting authorization
5. **Sync status** (planned) — last successful WooCommerce sync, anything stuck

The merchant should be able to glance at the dashboard and see *what changed since yesterday* across all of these without clicking into individual modules.

## Existing visual language (must match)

The implementer will be using these — your mockups should respect them:

- **Tailwind CSS v3.4 + shadcn/ui** primitives (cards, buttons, dropdowns, dialogs, badges, tables)
- **Lucide React icons**, stroke-only style, 16px default through a wrapper (no filled icons)
- **Color palette**: Tailwind defaults plus Scout's brand. Greens for success, ambers for warning, reds for alert, neutral grays for chrome. Use sparingly — alerts should *pop*; normal-state cards should be calm.
- **Typography**: system font stack, no custom fonts. Hierarchy through size + weight, not color.
- **Layout**: fixed left sidebar (already built, do not redesign it), main content area, **and a reserved right quarter for a future agent panel** — every screen must accommodate a vertical strip on the right that may be empty in v1 but will hold a natural-language assistant later. Don't use that space for content yet.
- **Spanish (Latin American / Guatemalan)** for all visible copy. We can iterate on exact wording, but design in Spanish from the start.
- **No emojis** in production UI.
- **No gradients, no glassmorphism, no decorative animations.** Calm, dense, scannable.

## Screens to mock up

### 1. Dashboard landing — `/dashboard`

The new top-level dashboard. Replaces the current single-table no-results page. Should be:

- **Multi-card layout**, each card a section from the list above (Traffic, Search, Catalog, Pricing, Sync)
- **Most important section is Traffic** — it gets the most prominent placement (top-left or full-width banner row)
- **Each card should answer: "is this OK or do I need to look at it?"** at a glance — green dot, red badge, count of unresolved items, etc.
- **Click a card → drill into that section's detail screen** (e.g. `/dashboard/traffic`, `/dashboard/search`)
- **No deep data on the landing.** Everything is summary. Detail lives on sub-pages.
- **Time range selector** at the top: Today / Yesterday / Last 7 days / Last 30 days. Changes context for cards that have time-relevant data.

The other modules (Catalog, Pricing, Sync) cards can be lower-fidelity placeholders — we'll fill them in as those features mature. **Focus design effort on the Traffic card.**

### 2. Traffic detail — `/dashboard/traffic`

Drill-in from the Traffic card. Single screen, no sub-tabs in v1. Sections from top to bottom:

a. **"Right now" widget** — small, top-left. Live count of active users. Refreshes every 30s. Shows "—" if GA4 not connected or unreachable. Below it: tiny "última actualización: hace 12s" timestamp.

b. **Three alert tiles** in a row — Sessions, Engagement Rate, Traffic Source Mix. Each tile shows:
   - Current value (large)
   - Comparison vs 7-day baseline (with arrow + % change)
   - Visual state: green (within threshold), yellow (approaching), red (firing alert)
   - If red: a one-line description of what tripped ("Sessions dropped 23% vs 7-day average")

c. **Two line charts** below the alert tiles, side by side:
   - Sessions: last 14 days, daily, with the 7-day rolling average overlaid as a dotted line
   - Engagement rate: last 14 days, daily

d. **Channels card** — current period's traffic-source mix as a horizontal stacked bar (or small pie + table), with WoW arrows next to each channel ("Organic Search 42% ↓ 8pp")

e. **Two side-by-side tables** — Top 5 landing pages (path + entrances + WoW), Top 5 exit pages (path + exits + WoW)

f. **Geo map or top-5 countries table** — keep it simple; a table is fine if a map adds complexity

g. **Active alerts inbox** at bottom — list of currently-firing alerts with metadata (when, what, how much) and a button to acknowledge each. When zero alerts firing: a calm "no hay alertas activas" message.

### 3. GA4 connection screen — `/configuration/ga4`

Pre-connection: a CTA "Conectar Google Analytics" with a brief explanation of what gets pulled and why. After clicking, the OAuth flow is handled by Google's UI (we don't design that).

Post-connection:
- Status panel: green badge, "Conectado", connected Google account email, GA4 property ID, last successful pull timestamp
- A "Desconectar" button (with confirmation dialog)
- A "Pull now" button (force a refresh, useful for testing)

### 4. Notification toast / inbox treatment

When an alert fires (background polling job detects it), the user should see it next time they're in the app. Two surfaces:
- A small badge on the dashboard nav item ("3" indicating 3 firing alerts)
- The active alerts inbox panel on `/dashboard/traffic`

Optional: a global notification center accessible from a bell icon in the top-right of the topbar — useful if other modules also start firing alerts. Mock this at low fidelity if it feels right; we can defer it.

## Interactions and states

For every screen, please mock:
- **Empty state** (e.g. GA4 not connected — what does the Traffic card on the dashboard landing look like?)
- **Loading state** (initial fetch — skeleton or spinner?)
- **Error state** (e.g. GA4 API quota exhausted — how does the user know what to do?)
- **Populated normal state**
- **Populated alert state** (the "something's wrong" version — the visual difference matters a lot)

## What you don't need to design

- Login / auth screens (already built)
- The sidebar (already built)
- Top bar branding / instance switcher (already built)
- Any module other than dashboard (catalog, pricing, etc. are out of scope here)
- The OAuth consent screen (Google's, not ours)

## Deliverables

Please produce mockups (any format — Figma frames, image attachments, or detailed HTML) for:

1. `/dashboard` landing — populated normal state, with the Traffic card prominent and other module cards as lower-fidelity placeholders
2. `/dashboard/traffic` — populated normal state
3. `/dashboard/traffic` — populated alert state (one or two alerts firing)
4. `/dashboard/traffic` — empty state (GA4 not connected)
5. `/configuration/ga4` — pre-connection
6. `/configuration/ga4` — post-connection (connected normal state)

For each, also note in plain text:
- Spacing / margins / breathing room you intended
- Color choices that depart from defaults
- Any interaction nuance not visible in the static mock (hover states, tooltips, what happens on click)

## How the mockups come back

Tuncho will paste the resulting mockups (or a description / screenshots) into Claude Code, which then implements the HTML/CSS/React components matching them, using the existing Tailwind + shadcn primitives. The closer the mockups are to a real implementable layout (real component types, real spacing tokens, real Lucide icon names where applicable), the faster the implementation goes.

If you have questions before starting, ask Tuncho directly.
