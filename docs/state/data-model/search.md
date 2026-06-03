---
application: core-app
module: Data Model
title: "Data model — Search"
status: Draft
scope: "The Postgres-side search tables: query_log and search_rate_limit, plus instance.storefront_domains. The search index itself is per-instance Meilisearch, not Postgres."
audience: "Engineers who need the table-level shape of the search domain and the boundary between Postgres and the Meilisearch index."
---

# Data model — Search

The [[Search Engine]] keeps very little in Postgres: a `query_log` and a
`search_rate_limit`, both scoped to the [[Instance]], plus `storefront_domains`
on the instance row. The actual index lives in [[Meilisearch]] as a per-instance
`inst_<instance_id>` index, not a Postgres table.

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative. The Meilisearch index is shown as an external store,
> not a Postgres table.

```mermaid
erDiagram
  instance ||--o{ query_log : records
  instance ||--o{ search_rate_limit : "rate-limits"
  instance ||--o{ meilisearch_index : "indexed into (external)"
```
