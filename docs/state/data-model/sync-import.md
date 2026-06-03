---
application: core-app
module: Data Model
title: "Data model — Sync & Import"
status: Draft
scope: "The sync-status and import tables: product_sync_status, category_sync_status, sync_log, failed_indexing, query_log, import_job, import_staging, catalog_suggestion."
audience: "Engineers who need the table-level shape of the sync (GroLabs→WC push) and import (WC→GroLabs pull) domains."
---

# Data model — Sync & Import

The [[Sync]] status tables and the [[Import job|import]] pull tables. Sync status
is tracked per [[Product]] and [[Category]] alongside a `sync_log`;
`failed_indexing` and `query_log` record search-side outcomes. An import job
stages raw [[WooCommerce]] rows and emits catalog suggestions.

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative, not column-exact. `product`/`category` are catalog
> tables, referenced here as the things whose sync state is tracked.

```mermaid
erDiagram
  product ||--o{ product_sync_status : "sync state"
  category ||--o{ category_sync_status : "sync state"
  product ||--o{ failed_indexing : "index failures"
  import_job ||--o{ import_staging : stages
  import_job ||--o{ catalog_suggestion : proposes
  instance ||--o{ sync_log : records
  instance ||--o{ query_log : records
```
