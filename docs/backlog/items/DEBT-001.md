---
id: DEBT-001
title: Denied requests are counted as committed searches with zero hits
type: debt
severity: low
status: open
area: search
source: docs/design/direct-meilisearch-search.md
trigger: "Before any merchant's search KPIs are shown to them or used commercially"
created: 2026-11-02
closed: null
owner: null
---

`metric_daily_source` selects committed searches as:

```sql
cs as (
  SELECT instance_id, created_at, created_at::date AS day, query_uid, total_hits
  FROM public.query_log
  WHERE is_committed IS NOT FALSE
)
```

There is no filter on `status` or `denial_reason`. A request the proxy
**refused** — unauthorised origin, rate limited — is still written to
`query_log` with the caller's `is_committed` flag and `total_hits = 0`. So a
denial is counted as a search that found nothing.

It therefore inflates two things at once: **search volume** (a request that
never reached Meilisearch is counted as a search) and **zero-result rate** (it
is counted as a search that failed to match), which is the metric the
no-result → synonym recovery loop keys on. A merchant with a misconfigured
origin would see a wave of phantom zero-result searches and be advised to write
synonyms for queries that were never run.

## Scale, measured 2026-11-02

| instance | denials counted as searches | genuine committed | share |
|---|---|---|---|
| 99999 (synthetic test) | 101 | 561 | 15.3% |
| 16 (Shopify dev store) | 1 | 8 | 11.1% |

Low severity because today it lands almost entirely on the synthetic test
instance, and no merchant is reading these numbers yet. The mechanism is not
low severity — the share is double digits wherever denials happen at all.

## Direct mode shrinks it but does not close it

A direct-mode storefront never calls `/api/v1/search`, so search denials stop
being produced on that path, and reported `search_performed` rows carry
`status 200` with `denial_reason` null by construction. The proxy is retained
for ingest, back-compat and unconfigured storefronts (R-11), so denials keep
arriving from there.

## How to close it

1. Add `and denial_reason is null` to the `cs` CTE in `metric_daily_source`
   (and check the sibling CTEs in the same view for the same omission).
2. Re-run `refresh_metric_daily(null)` to restate history, which is cheap and
   is the documented way to change a view's meaning.
3. Decide separately whether a denied request should carry `is_committed` at
   all. The flag describes the caller's intent, which is real; the cleaner fix
   may be to stop writing it on a request that was refused, so the column means
   one thing.
