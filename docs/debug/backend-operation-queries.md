# Debugging the `backend_operation` audit table

`public.backend_operation` is the persistent trail for every backend
integration call (Meilisearch indexing, WooCommerce pull, …). One row per
discrete operation: opened `pending`, closed `succeeded` / `failed` /
`partial` once the **real** outcome is confirmed (for Meilisearch, after
polling the task to completion — enqueue is not success).

This doc is the no-UI way to query it. Run these in the Supabase SQL editor
(project `scout` / `ixbbhwtpnebrhquunege`) or via the Supabase MCP. Replace
`:iid` with the instance id (TestInstanceWazu1 = `4`).

## Operation types

| `operation_type`            | Meaning                                                        |
|-----------------------------|----------------------------------------------------------------|
| `meilisearch_index`         | Single-product index push (one row per product per sync).      |
| `meilisearch_index_bulk`    | Batch push from the full backfill (`indexAllForInstance`).     |
| `meilisearch_index_skipped` | Product not pushed — `payload_summary.reason` says why (e.g. `not-indexable: no-parent-wc-id`). Status `succeeded` because nothing failed; it's a deliberate no-op. |

`status='pending'` with a non-null `response_payload.task_uid` = the
Meilisearch task didn't confirm within the wait timeout; still processing.

## Recent failures

```sql
SELECT operation_id, operation_type, target_id, error_message,
       completed_at, duration_ms
FROM backend_operation
WHERE instance_id = :iid AND status = 'failed'
ORDER BY completed_at DESC NULLS LAST
LIMIT 50;
```

## Why a specific product failed / didn't land

`target_id` is the product's `woocommerce_id` (string) for index ops, or
the `product_id` when there is no WC id. The reliable key across all
operation types is `payload_summary->>'product_id'`:

```sql
SELECT operation_id, operation_type, status, error_message,
       payload_summary, response_payload, started_at, completed_at
FROM backend_operation
WHERE instance_id = :iid
  AND payload_summary->>'product_id' = '123'
ORDER BY started_at DESC;
```

## Operations grouped by status

```sql
SELECT operation_type, status, COUNT(*)
FROM backend_operation
WHERE instance_id = :iid
GROUP BY 1, 2
ORDER BY 1, 2;
```

## Why are products being skipped? (the "doesn't land" breakdown)

```sql
SELECT payload_summary->>'reason' AS reason, COUNT(*)
FROM backend_operation
WHERE instance_id = :iid
  AND operation_type = 'meilisearch_index_skipped'
GROUP BY 1
ORDER BY 2 DESC;
```

## Slow operations

```sql
SELECT operation_id, operation_type, target_id, duration_ms,
       status, completed_at
FROM backend_operation
WHERE instance_id = :iid AND duration_ms > 5000
ORDER BY completed_at DESC
LIMIT 20;
```

## Stuck / unconfirmed (timed out before the task finished)

```sql
SELECT operation_id, operation_type, target_id,
       response_payload->>'task_uid' AS task_uid, started_at
FROM backend_operation
WHERE instance_id = :iid AND status = 'pending'
  AND started_at < now() - interval '5 minutes'
ORDER BY started_at DESC;
```

## Full Meilisearch task error for a failed op

`response_payload` holds the raw Meilisearch task object on failure
(`error.message`, `error.code`, `error.type`).

```sql
SELECT operation_id, target_id,
       response_payload->'error'->>'code'    AS error_code,
       response_payload->'error'->>'type'    AS error_type,
       response_payload->'error'->>'message' AS error_message
FROM backend_operation
WHERE instance_id = :iid AND status = 'failed'
  AND operation_type LIKE 'meilisearch_index%'
ORDER BY completed_at DESC
LIMIT 50;
```
