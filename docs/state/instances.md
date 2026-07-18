---
application: core-app
module: State
title: "GroLabs — Instances & tenants (canonical map)"
status: Draft
audience: "Contributors and assistants who need to know which tenant/instance rows exist in the production DB, what each one is for, and which ones must never be repurposed."
scope: "Canonical tenant → instance map ratified and applied to the production Supabase DB (project scout, ixbbhwtpnebrhquunege) on 2026-07-04. Row-level inventory only; table shapes and RLS live in schema.md. The live DB is authoritative (Constitution Article 10) — this doc records the ratified intent behind each row."
actors:
  - name: GroLabs (template owner)
    type: system
    definition: "Tenant 1, kind template_owner, domain grolabs.ai. Owns instance 0, the system template used to seed new customer instances. Owner account: tuncho@grolabs.ai."
  - name: HPC
    type: human
    definition: "Tenant 3, kind customer, domain www.hpcenlinea.com.gt. The first real customer; owns instance 11. Members: tgranados@hpc.com.gt (owner), edullerena1603@gmail.com (admin)."
  - name: GroLabs.io test storefront
    type: system
    definition: "Tenant 4, kind customer, domain www.grolabs.io. A live WordPress install owned by GroLabs, posing as a customer to exercise the search/events plugins and E2E flows. Owner: tunchog@gmail.com (pure-Gmail Google SSO test account)."
  - name: Integration-test synthetic tenant
    type: system
    definition: "Tenant/instance 99999, storefront_domain test.local. Reserved exclusively for the vitest integration suite; never repurpose."
rules:
  - id: R-1
    statement: "Instance 0 is the system template (kind=template, is_active=false), owned by the template_owner tenant. It seeds new customer instances and is never a customer surface."
    truth: true
    rationale: "Ratified map applied 2026-07-04; template semantics per tenant-model.md and CLAUDE.md §2."
  - id: R-2
    statement: "instance_id = 0 is a legitimate, queryable value. JavaScript truthiness checks (if (!instanceId)) silently break for the template instance — always use == null / === null / === undefined checks."
    truth: true
    rationale: "CLAUDE.md §2 'Instance ID checking'; the trap has bitten before."
  - id: R-3
    statement: "Tenant/instance 99999 is reserved for the vitest integration suite (storefront_domain test.local) and must never be repurposed for real or demo data."
    truth: true
    rationale: "Synthetic fixture the integration tests assert against by id; repurposing it corrupts the suite."
  - id: R-4
    statement: "Instance 12 is the sole claimer of www.grolabs.io / grolabs.io in storefront_domains; the storefront-domain → instance resolution depends on that uniqueness."
    truth: true
    rationale: "Search proxy and events resolve the instance from the claiming domain."
  - id: R-5
    statement: "The former Wazú tenant (tenant 2, instances 1,3,4,5,6,8,9,10) was deleted from live tables on 2026-07-04; its row snapshot lives in the graveyard.wazu_* schema in the same DB and is dropped only after a stability window."
    truth: true
    rationale: "MVP testing plan Task 1 (Notion), executed 2026-07-04."
useCases:
  - id: T-1
    title: "Resolve which instance is safe to test against"
    given: "A contributor needs a live storefront to exercise the Meilisearch search/events plugins or a Playwright E2E run"
    when: "They consult this map"
    then: "They use instance 12 (GroLabs.io Test Storefront) — never HPC (real customer) and never instance 0 (template)"
    verifies: [R-1, R-4]
  - id: T-2
    title: "Avoid the instance-0 falsy trap"
    given: "Code handles a user whose current instance is the template (instance_id = 0)"
    when: "The instance id is checked with if (!instanceId)"
    then: "The check wrongly treats the template instance as 'no instance'; the fix is instanceId == null"
    verifies: [R-2]
  - id: T-3
    title: "Recover a pre-deletion Wazú row"
    given: "A question arises about data that lived on the deleted Wazú tenant"
    when: "The contributor queries the graveyard.wazu_* tables in the same DB"
    then: "The row snapshot from 2026-07-04 is available until the graveyard is dropped after the stability window"
    verifies: [R-5]
---

# GroLabs — Instances & tenants (canonical map)

**Ratified & applied:** 2026-07-04, production Supabase DB — project `scout`
(`ixbbhwtpnebrhquunege`).
**Method:** the map below was ratified (MVP testing plan, Task 1) and applied
to the live DB the same day; the live DB remains authoritative (Constitution
Article 10) — this doc records what each row *is for*, which the DB cannot say.

> Table shapes, columns, and RLS for `tenant` / `tenant_member` / `instance` /
> `instance_member` live in [`schema.md`](schema.md). This doc is the row-level
> inventory only.

---

## Map

```mermaid
flowchart LR
  subgraph live["Live rows — Supabase scout (public schema)"]
    T1["tenant 1 · GroLabs<br/>template_owner · grolabs.ai"] --> I0["instance 0<br/>GRO Scout Template (System)<br/>kind=template · is_active=false"]
    T3["tenant 3 · HPC<br/>customer · www.hpcenlinea.com.gt"] --> I11["instance 11 · HPC<br/>active — REAL CUSTOMER"]
    T4["tenant 4 · GroLabs.io (Test)<br/>customer · www.grolabs.io"] --> I12["instance 12<br/>GroLabs.io Test Storefront<br/>active — TEST SITE"]
    T9["tenant 99999 · Integration tests<br/>(synthetic)"] --> I9["instance 99999<br/>storefront_domain test.local"]
  end
  subgraph graveyard["graveyard schema (same DB)"]
    W["wazu_* row snapshots<br/>former tenant 2 · instances 1,3,4,5,6,8,9,10<br/>drop after stability window"]
  end
  T1 -.->|seeds new customer instances| I11
```

```mermaid
erDiagram
  tenant ||--o{ instance : owns
  tenant ||--o{ tenant_member : "has members"
  instance ||--o{ instance_member : "has members"
```

## Summary table

| Tenant | Kind | Domain | Instance | Instance name | Active | Purpose |
|---|---|---|---|---|---|---|
| 1 · GroLabs | `template_owner` | `grolabs.ai` | **0** | GRO Scout Template (System) | no | **TEMPLATE** — seeds new customer instances |
| 3 · HPC | `customer` | `www.hpcenlinea.com.gt` | **11** | HPC | yes | **REAL CUSTOMER** |
| 4 · GroLabs.io (Test) | `customer` | `www.grolabs.io` | **12** | GroLabs.io Test Storefront | yes | **TEST SITE** — live WordPress |
| 4 · GroLabs.io (Test) | `customer` | `www.grolabs.io` | **13** | SDK Test (TestEcomSite) | yes | **SDK / PROPRIETARY-TRACK TEST** — BYO API + JS SDK |
| 99999 · Integration tests (synthetic) | — | — | **99999** | Integration tests (synthetic) | — | **VITEST FIXTURE** — never repurpose |

## Tenant 1 — GroLabs → instance 0 (template)

- `tenant.kind = template_owner`, `domain = grolabs.ai`.
- Instance 0 **"GRO Scout Template (System)"**: `kind = template`,
  `is_active = false`. It exists to be copied when seeding a new customer
  instance; it is never a customer-facing surface and never appears active.
- Owner account: `tuncho@grolabs.ai`.
- Being the `template_owner` tenant is also what makes a user GroLabs staff
  for the admin gate ([`user-management.md`](../policy/user-management.md),
  SEC-001 in CLAUDE.md §17).

### The `instance_id = 0` falsy trap

Instance 0 is a real, meaningful, queryable id — and JavaScript treats `0` as
falsy. `if (!instanceId)` silently misbehaves for any user on the template
instance. **Always use null checks** — `instanceId == null` (covers `null` and
`undefined`), never truthiness, never `instanceId || fallback` (collapses 0 to
the fallback). Full rule with examples: `CLAUDE.md` §2 "Instance ID checking".

## Tenant 3 — HPC → instance 11 (real customer)

- `tenant.kind = customer`, `domain = www.hpcenlinea.com.gt`.
- Instance 11 **"HPC"**, active. This is a **real customer** — do not use it
  for testing, demos, or throwaway data.
- Members: `tgranados@hpc.com.gt` (owner), `edullerena1603@gmail.com` (admin).

## Tenant 4 — GroLabs.io (Test) → instance 12 (test site)

- `tenant.kind = customer`, `domain = www.grolabs.io`.
- Instance 12 **"GroLabs.io Test Storefront"**, active.
  `storefront_domains = {www.grolabs.io, grolabs.io}` — the live WordPress
  storefront ONLY, and sole claimer of both; storefront-domain → instance
  resolution (search proxy, events) depends on that uniqueness. The SDK/BYO
  test surface that briefly shared this instance was split out to
  **instance 13** on 2026-07-18 (catalog, index docs, and SDK-era
  events/orders all moved; the WC-imported catalog and `inst_12` index carry
  only real WordPress products now).
- Instance 12 also carries the **synthetic demo dataset** (2026-05-01→07-17,
  ~14.7k events / 443 orders) seeded 2026-07-18 for dashboard timelines —
  markers: `origin = 'demo.grolabs.io'`, synthetic order ids `8xxxxx`.
  Filter on that origin to separate demo history from real plugin traffic.
- Owner: `tunchog@gmail.com` — a **pure-Gmail Google SSO test account** (no
  GroLabs/HPC domain), which also **owns the GA4 property for grolabs.io**.
- Purpose: a **live WordPress install** used to exercise the Meilisearch
  search/events plugins end-to-end, and the target for future Playwright E2E
  runs (MVP testing plan chose Playwright over Browserless for this).

## Tenant 4 — instance 13 (SDK / proprietary-track test)

- **"SDK Test (TestEcomSite)"**, active, same tenant as instance 12; split
  out 2026-07-18 so WordPress-plugin testing and BYO API/SDK testing stop
  sharing one instance (they had polluted each other's catalog and index —
  duplicate docs, mixed dashboards).
- `storefront_domains = {demo.grolabs.io, testecomsite.vercel.app,
  localhost, 127.0.0.1}` — dev/demo origins live HERE, never on 12.
  `default_currency = USD` (TestEcomSite presents USD).
- Catalog: the 6 synthetic products (ids 1001–1006), ingested through the
  public BYO `/catalog/documents` endpoint into the `inst_13` index; a BYO
  write key is issued (rotate it from Configuration → External platform to
  take ownership of the plaintext).
- Carries the SDK-era analytics history (2026-07-04..06) moved from 12.
- Doubles as the working prototype of the **merchant sandbox instance**
  model (mode-by-credential, dev origins allowed) from the external-platform
  design discussion.

## Tenant/instance 99999 — Integration tests (synthetic)

- Reserved exclusively for the **vitest integration suite**;
  `storefront_domain = test.local`.
- The suite asserts against this id. **Never repurpose it** for real, demo,
  or manual-test data — doing so corrupts the suite.

## Deleted: Wazú (former tenant 2)

- Tenant 2 "Wazú" (instances **1, 3, 4, 5, 6, 8, 9, 10**; users
  `tuncho@wazu.test` / `tuncho@wazu.gt`) was **deleted on 2026-07-04**
  (MVP testing plan, Task 1).
- A row snapshot of everything deleted lives in the **`graveyard.wazu_*`**
  schema in the same DB. It is a recovery net, not live data — RLS and the
  app never read it. **Drop after a stability window**; until then, ids
  1–10 (minus 0) should be treated as burned, not reused.
- Older docs that still say "Wazú owns instances 1 and 3"
  ([`schema.md`](schema.md) seed notes, [`tenant-model.md`](../policy/tenant-model.md))
  describe pre-deletion history — this doc supersedes them for current rows.

## Related GroLabs modules

- **M1 Identity / M2 Identity Admin UI** — the tenant/instance layer these
  rows live in (`src/lib/instance.ts`, `src/lib/actions/instance.ts`).
- **M9 Search Engine** — per-instance Meilisearch indexes `inst_<instance_id>`;
  storefront-domain resolution for instance 12.
- **M12 Analytics** — the GA4 property for grolabs.io is owned by the
  instance-12 test account (`tunchog@gmail.com`).
- **Admin surface** (`admin.grolabs.ai`) — customer creation flows write new
  `tenant` + `instance` rows seeded from instance 0
  ([`user-management.md`](../policy/user-management.md)).

## External apps & credentials

| System | What | Credential / account |
|---|---|---|
| Supabase | Production DB, project `scout` (`ixbbhwtpnebrhquunege`) — live `public` rows + `graveyard` schema | Supabase MCP / dashboard access |
| Google (SSO + GA4) | Instance-12 owner login and the GA4 property for grolabs.io | `tunchog@gmail.com` (pure-Gmail Google SSO test account) |
| WordPress | Live test storefront at www.grolabs.io running the GroLabs plugins | Managed by GroLabs (test tenant) |

## Update protocol

Any change to tenant/instance rows in the production DB (new customer, deleted
tenant, domain claim change, graveyard drop) must be reflected here in the same
PR, per the [state-docs update protocol](README.md).
