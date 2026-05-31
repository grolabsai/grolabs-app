# Integration tests

API-level tests that exercise `/api/v1/search` end-to-end against a real
Meilisearch cluster + Supabase project. Lives outside the unit suite
(`tests/unit/`) because they need network IO and credentials.

## What's covered

`tests/integration/search/category-filter.test.ts` — the matrix:

- Keyword-only search returns the expected products across categories.
- Keyword + `category_ids` filter narrows correctly.
- Keyword that exists in one category + filter targeting another → empty.
- Multi-category products surface under each of their categories.
- Cross-instance isolation: requesting `instance_id=88888` never returns
  fixtures from `instance_id=99999`.
- Origin validation: missing Origin or non-whitelisted Origin → 403.
- Variant products surface a non-null `matched_variation` pointing at an
  in-stock variation.

Add new specs alongside this one when you wire new filter rules.

## Required environment

```
MEILISEARCH_HOST            # https://… (no trailing slash)
MEILISEARCH_MASTER_KEY      # production cluster master key
NEXT_PUBLIC_SUPABASE_URL    # production Supabase URL
SUPABASE_SERVICE_ROLE_KEY   # service-role key (bypasses RLS)
```

The suite is **safe to run against production** because:
- Fixtures live under `instance_id = 99999`, isolated by RLS + the
  Meilisearch index pattern (`scout-products-99999`).
- The DB row for instance 99999 is created by migration
  `20260520000001_test_instance.sql` (already applied) and is
  permanent — tests never write to instance tables.

## Running locally

```sh
# .env.local must have all four secrets above.
npm run test:integration
```

A single run takes ~10–15 s — most of which is Meilisearch indexing-task
polling on fresh fixtures. The suite tears the test index down on
completion (success or failure).

## CI

`.github/workflows/test.yml` runs:

1. **`unit` job** — typecheck + `npm test`. Runs on every PR (incl. forks).
2. **`integration` job** — `npm run test:integration`. Gated on secrets;
   skipped for forks (which can't access secrets without explicit approval).

To enable integration tests in CI, add the four env vars above as
**repository secrets**: Settings → Secrets and variables → Actions →
New repository secret.

### Or via gh CLI (faster)

```sh
gh secret set MEILISEARCH_HOST           --repo grolabsai/grolabs-rre --body 'https://…'
gh secret set MEILISEARCH_MASTER_KEY     --repo grolabsai/grolabs-rre --body '…'
gh secret set NEXT_PUBLIC_SUPABASE_URL   --repo grolabsai/grolabs-rre --body 'https://….supabase.co'
gh secret set SUPABASE_SERVICE_ROLE_KEY  --repo grolabsai/grolabs-rre --body '…'
```

Grab the values from Vercel project env (RRE production) or the
Meilisearch Cloud / Supabase dashboards. After all four are set,
trigger a run manually at
https://github.com/grolabsai/grolabs-rre/actions/workflows/test.yml →
"Run workflow" → confirm the `integration` job passes.

## Adding a new rule

Pattern: when a new filter/business rule lands in
`src/app/api/v1/search/route.ts`, add a corresponding `describe` block here
that exercises both the matching and non-matching path. The fixtures in
`./search/fixtures.ts` are designed to be extended — add new products
(IDs in the 90_000 range) and new category constants (`CAT_D`, etc.)
rather than mutating existing ones, so existing tests keep their
assertions stable.
