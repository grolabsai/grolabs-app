# B1 Conversion-Measurement — traffic emulator

A **known synthetic dataset pushed through the real APIs** so the whole pipeline
can be validated round-trip:

```
scenario.mjs (known input + EXPECTED)
   → /api/v1/search + /api/v1/events  (real routes)
      → analytics_event + query_log    (storage)
         → refresh_metric_daily()       (rollup)
            → diff vs EXPECTED          (interpretation)  ✓/✗
```

Everything writes to the **reserved test instance 99999** (`storefront_domains =
[test.local]`), so it never touches real tenant data. The generator + expected
sheet are version-controlled here; the generated rows live in the DB and are
regenerated on demand (reset → push → check).

## Run it (local, repeatable)

```bash
# terminal 1 — the app (writes to the scout DB via .env.local)
npm run dev

# terminal 2 — the full cycle: reset → push → check
npm run emulate
```

`npm run emulate` exits non-zero if any KPI fails its expectation, so it works as
a regression assertion too. Individual steps:

| script | what it does | needs |
|---|---|---|
| `npm run emulate:reset` | delete instance-99999 rows (clean slate) | `.env.local` (service role) |
| `npm run emulate:push`  | POST the scenario to the running dev server | dev server up |
| `npm run emulate:check` | `refresh_metric_daily()` + diff vs EXPECTED | `.env.local` |

Against a deployed URL (writes real rows to that env, instance 99999 only):

```bash
node scripts/emulator/run.mjs --url https://app.grolabs.ai --yes-prod
```

## Files

- **`scenario.mjs`** — the cast (10 shoppers, 3 logged-in), the searches/events,
  and **`EXPECTED`** (the hand-computed KPI sheet — the "data we know how to read").
- `run.mjs` — pushes the scenario through the APIs (the push step).
- `check.mjs` — refreshes the rollup and diffs `metric_daily` (instance 99999,
  today) vs `EXPECTED`; PASS/FAIL table + exit code.
- `reset.mjs` — clears instance-99999 rows for a deterministic re-run.
- `db.mjs` — shared service-role Supabase client (env via `--env-file=.env.local`).

## Phase 1 vs Phase 2

Phase 1 uses **no Meilisearch index** for 99999, so searches return no hits
(`no_result_rate` is degenerately 1.0) and the search↔click JOIN KPIs
(`search_ctr`, `no_click_rate`, `time_to_first_click_median`) are intentionally
**absent** — `EXPECTED` asserts that.

**Phase 2 (staged)** seeds a tiny `inst_99999` index so those become deterministic.
Prereq: `MEILISEARCH_HOST` + `MEILISEARCH_MASTER_KEY` in `.env.local`.

```bash
npm run emulate:seed       # build + load inst_99999
npm run emulate:phase2     # reset → seed → push(Phase 2) → check(Phase 2)
npm run emulate:teardown   # delete inst_99999
```

Files: `scenario.phase2.mjs`, `seed-meili.mjs`, `run.phase2.mjs`. `check.mjs` is
phase-agnostic (`EMU_SCENARIO=./scenario.phase2.mjs`).

## Cleanup

The 99999 dataset is left in place as a known fixture (useful when building the
KPI dashboard). Wipe it anytime: `npm run emulate:reset`.
