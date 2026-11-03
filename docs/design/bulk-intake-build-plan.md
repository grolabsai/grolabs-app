---
application: core-app
applicationKind: core
module: Design
title: "Bulk Intake — Build Plan (plain brief + executable prompts + test plan)"
status: Draft
owner: "Tuncho"
audience: "An implementer (human or a cloud coding agent) executing the bulk-intake design, plus Tuncho for the plain-language overview."
scope: "The executable companion to docs/design/bulk-intake.md. A plain-English summary of what we're building, the full ordered list of self-contained implementation prompts (each tagged for how it can run), how to run them without a local machine, the human follow-up tasks, and how to test everything once built."
---

# Bulk Intake — Build Plan

This is the *do-it* companion to [`bulk-intake.md`](bulk-intake.md). Read that for
the "why"; this is the "what to run, in what order, and how to test it."

## 1. The plan in plain language

We're building one pipe that moves a merchant's product catalog **into** GroLabs,
keeps it **in sync**, and sends our **enhanced** version back **out** — with as
little work for the merchant's developers as possible.

The core idea: **everything is a "product object"** — a single record with a
stable ID that carries the product plus its variants, attributes, and categories.
That same object shape is used for the first big import, for every later update,
and for the enhancements we push back. One shape, everywhere, both directions.

How a merchant connects depends on what they run:

- **WooCommerce / Shopify:** we do the work — pull their catalog through the
  platform's own API and write enhancements back the same way. The merchant
  installs our plugin/app and writes **no code**.
- **A custom system (e.g. our first client):** their developers connect to us
  using our **SDK** (a small library we give them) — and to make that fast, we
  also give them AI-readable instructions, copy-paste examples, and a sandbox to
  test against. They never write the tricky parts (mapping, upserts) — we do.

To remove mistakes and back-and-forth, three things matter: (1) the merchant only
ever has to guarantee a **stable ID** per product; (2) we figure out what their
fields mean **once**, save that mapping, and reuse it forever; (3) a **sandbox +
"check my data" endpoint** lets their developer's AI catch errors before anything
reaches us.

We never block on imperfect data, and we never silently overwrite a merchant's
store — enhancements are **proposed and approved**.

## 2. Executable prompts (ordered, self-contained)

Run these in order; `Depends on` notes the real constraints. Each tag says how it
can run:

- **[cloud-ok]** — a cloud coding agent can do it unattended and open a PR (writes
  code/files, no special connection needed).
- **[needs-connection]** — needs the Supabase MCP (apply/verify a migration) — run
  it where that connection exists, or split the "write SQL" part (cloud-ok) from
  the "apply + verify" part (do when connected).
- **[needs-human]** — a decision, a credential, or infra provisioning only a person
  can do.

Every prompt must finish with `npm run build` + `npm run typecheck` passing and
open a PR; never merge to `main` (the pre-push hook blocks it anyway).

---

**P1 — Product object schema + SDK foundation. [cloud-ok]**
In `web-apps/app`, extend `public/openapi.yaml` to define the full **product
object** used in both directions: stable `id` + nested `variants[]`,
`attributes[]` (incl. quantity `{value, unit}`), and `categories[]`. Keep the
existing `/api/v1/catalog/documents` upsert/delete shape; this just enriches the
object schema. Then scaffold the TypeScript SDK (in the SDK repo) generated from
the spec, exposing a typed `buildProduct({...})` helper. *Why:* the canonical unit
+ the library the client codes against. *Depends on:* none.

**P2 — Import session + raw landing tables (write SQL). [cloud-ok]**
Write the migration in `supabase/migrations/` adding `import_session` and
`import_file` (schemas in `bulk-intake.md` → Data model), both with `instance_id`
+ RLS. Do **not** apply it here — see P2b. *Why:* the accept-fast raw landing
zone. *Depends on:* none.

**P2b — Apply + verify the migration. [needs-connection]**
Apply the P2 migration via the Supabase MCP and verify the tables/columns/RLS
exist (`information_schema`). *Why:* migrations don't auto-apply (CLAUDE.md §12).
*Depends on:* P2.

**P3 — Multi-part intake API. [cloud-ok]**
In `web-apps/app` (`src/app/api/v1/catalog/`), add session lifecycle: open a
session, upload a part (lands raw, returns an instant ack), mark complete. Accept
product objects directly, or table-dump parts (custom backfill). *Why:*
accept-fast intake. *Depends on:* P1, P2b.

**P4 — Stitch table dumps → product objects. [cloud-ok]**
In `src/lib/import/`, on session-complete, stitch dump parts into product objects
using the data dictionary or inferred join keys; include the flat-file fallback
(detect the repeating product key; constant-within-group → product, varying →
variant axes). *Why:* the custom-source backfill convenience. *Depends on:* P3.

**P5 — Interpretation + save the bidirectional mapping profile. [cloud-ok]**
Feed objects through the existing ASE agents (`analyze-categories`,
`group-products`); on confirm, save the bidirectional **mapping profile** to
`instance.integrations_config.<source>.mapping_profile`. *Why:* AI normalization +
the artifact that makes updates deterministic and lets write-back speak the
merchant's field names. *Depends on:* P4.

**P6 — "I found this" confirm surface. [cloud-ok]**
Reuse the import-wizard review step to confirm interpretations from an
API-originated session: high-confidence auto-applies, low-confidence flagged,
never blocks. *Where:* `src/app/[locale]/(app)/import/`. *Depends on:* P5.

**P7 — Delta + reconcile sync. [cloud-ok] (scheduling = [needs-connection])**
Apply the saved mapping profile to each incoming object (deterministic, no AI);
route unknown fields to raw + a fresh confirm round. Add a `modified_after` poll
(used only where the merchant edits in their own system) and a periodic full
reconcile with an atomic Meilisearch index swap (the delete-catcher). *Why:* the
update basis + safety net. *Depends on:* P5. (pg_cron setup needs the DB
connection.)

**P8 — Source change-signals. [cloud-ok for code] [needs-human for keys]**
Shopify webhook registration + handler (`web-apps/app`); a WooCommerce push hook
in the GroLabs WP plugin (`wp-plugins/grolabs-wordpress-*`). *Why:* real-time
deltas incl. deletes. *Depends on:* P7. (Live webhook secrets are [needs-human].)

**P9 — Write-back (enhancement out), propose-then-approve. [cloud-ok]**
Outbound path: enrich → invert fields via the mapping profile → **propose**
changes a merchant approves (never silent) → write via Shopify Admin / WC REST /
the SDK channel. *Why:* the bidirectional endgame. *Depends on:* P1, P5. (Can ship
after the read side — phase 2.)

**P10 — SDK: wrap all surfaces. [cloud-ok]**
Extend the SDK beyond catalog to one client: `search()`, typed result objects,
`trackEvent()` (search click + add-to-cart + purchase with order value + a stable
user/session id), a GA4 helper, and the enrichment receiver. *Why:* "ask their
devs to call our library," not read five API docs. *Depends on:* P1.

**P11 — `llms-full.txt` (AI-readable integration guide). [cloud-ok]**
Generate `public/llms-full.txt` from the OpenAPI spec + SDK + idioms, so a client's
AI assistant can write the integration in their stack. Mirror the existing
`llms.txt` pattern. *Why:* the highest-leverage "copy-paste" lever. *Depends on:*
P1, P10.

**P12 — Copy-paste quickstart. [cloud-ok]**
A docs page with five complete, runnable SDK snippets: send catalog, wire search,
render results, track events (incl. cart/conversion/value), GA4. *Depends on:* P10.

**P13 — Sandbox + `validate` (dry-run) endpoint. [cloud-ok for code] [needs-human for sandbox instance]**
Add `POST /api/v1/catalog/validate` that accepts a payload and returns precise,
actionable errors **without** committing. Provision a sandbox instance + key.
*Why:* the thing that actually removes back-and-forth — the client's AI
self-corrects before anything reaches us. *Depends on:* P1, P3.

**P14 — `grolabs-integration` Claude Skill. [cloud-ok]**
Package P11/P12/P13 into a Skill (`SKILL.md` + the snippets + a payload-validator
script) so a client on Claude Code runs one command and gets guided, repo-aware,
validated integration codegen. *Why:* the white-glove layer for the first client.
*Depends on:* P11, P12, P13.

**P15 (optional, later) — Integration MCP server. [needs-human]**
Host an MCP exposing `get_schema`, `validate_product`, `dry_run_ingest`,
`sample_search` for live agentic development against the sandbox. *Why:* the
scaled version of P13/P14 for client #2+. *Depends on:* P13.

**P16 — Doc amendments (sign-off prompts, not inline). [cloud-ok]**
Amend `wc-import.md` to point its update story at this design (we own edits → write
back, no WC polling, with the stock/price caveat); add the Shopify source and the
SDK/write-back direction. (`wc-import.md` is locked — amend via its own sign-off,
protocol R-4.) *Depends on:* relevant prompts landing.

## 3. How to run them without your computer

Yes — possible. These run on Anthropic's cloud, not your laptop, so you can close
it. The honest shape of it:

- **What runs unattended well:** every **[cloud-ok]** prompt. A cloud coding agent
  executes it, builds, and opens a **PR you review when you're back**. Nothing
  merges to `main` automatically (your pre-push hook blocks it).
- **What can't run fully unattended:** **[needs-connection]** steps (applying
  Supabase migrations) if the headless cloud run lacks the Supabase MCP, and all
  **[needs-human]** steps (sandbox provisioning, live keys, SDK publish). These
  are written SQL/code by the cloud agent but **applied/decided by you** — they're
  in the Notion list (§4).
- **Recommended setup:** a one-time cloud run that executes P1–P16 in order in the
  `[cloud-ok]` scope, opening one PR per logical group, and stopping to list what
  needs you. You review + merge + run the connection/human steps when back.

## 4. Human tasks (after the code runs) — the Notion list

These are the things a person must do; mirrored into Notion.

1. Review + merge the PRs (in dependency order P1→P16).
2. Apply + verify the P2 migration via Supabase MCP (P2b).
3. Set up pg_cron for the delta poll + nightly reconcile (P7).
4. Provision a **sandbox instance + API key** (P13) and a staging Meilisearch
   index.
5. Create + store live credentials: catalog write key, search key, event/tenant
   token, Shopify Admin token, WC consumer key/secret, webhook secrets (P8).
6. Publish the SDK package (git-init the SDK repo, version, publish) (P1/P10).
7. Decide the two open product calls: WC **stock/price staleness** (pull lightly
   vs accept stale), and whether **login/SSO** and **AEO** are in scope for the
   first client.
8. Hand the first client: SDK + `llms-full.txt` + quickstart + sandbox key (+ the
   Skill).

## 5. How to test everything

Test in this order; each builds on the last.

1. **Schema (P2b).** `information_schema` shows `import_session` / `import_file`
   with RLS; insert a row as two different instances and confirm isolation.
2. **Validate endpoint (P13).** POST a deliberately-broken payload to
   `/api/v1/catalog/validate`; confirm it returns specific field errors and writes
   nothing.
3. **Intake round-trip (P3–P6).** Open a session, upload a small sample catalog
   (objects, and separately a 2-table dump), mark complete; confirm raw landing,
   stitched objects, ASE interpretation, and that the confirm screen shows
   high/low-confidence correctly. Verify the mapping profile is saved.
4. **Upsert + idempotency.** Send the same product twice → one record updated, not
   duplicated. Send a delete → it's gone. Send a partial delta → only that product
   changes.
5. **Sync safety net (P7).** Remove a product from the source, run the reconcile →
   it disappears from the catalog + Meilisearch with no half-empty window (index
   swap).
6. **SDK + AI codegen (P10–P12).** In a scratch repo, `npm install` the SDK and run
   each quickstart snippet against the sandbox. Then point Claude Code at
   `llms-full.txt` and ask it to "wire GroLabs search" — confirm it produces
   working code with no human fixes.
7. **Skill (P14).** Run `/grolabs-integrate` in a test repo; confirm it scaffolds +
   validates against the sandbox end-to-end.
8. **Write-back (P9).** Trigger an enhancement → confirm it appears as a *proposal*
   (not auto-applied), approve it, and confirm the merchant-side write lands with
   fields in the merchant's own names.
9. **Search + events live.** Run a real search through the proxy; fire click +
   cart + purchase events; confirm they're attributed to the right product ID and
   (eventually) the right user/session.
10. **GA4.** Confirm traffic shows on `/dashboard/traffic` for the connected
    property.
