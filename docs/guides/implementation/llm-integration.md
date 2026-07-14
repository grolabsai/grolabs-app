# GroLabs integration guide — for coding agents

You are integrating an e-commerce storefront with GroLabs (search + storefront
analytics). This file is self-contained: endpoints, exact field contracts,
canonical event names, and a verification command after every step. Machine-
readable spec: `https://app.grolabs.ai/openapi.yaml` · browsable:
`https://app.grolabs.ai/api-docs.html`.

**Base URL:** `https://app.grolabs.ai/api/v1`

**Auth model — three credentials, three trust levels:**

| Credential | Secrecy | Used for |
|---|---|---|
| `instance_id` (integer, may be `0` — treat as valid, never falsy-check) | Public, like a publishable key | Every request |
| `Origin` header = a storefront domain registered with the instance | The browser supplies it | Browser-side search + events (no key needed) |
| Write key (`Authorization: Bearer <write key>`) | Secret. Server-side only. Never in browser code, never committed | Catalog writes |

An unregistered `Origin` is rejected with the same undifferentiated
`403 {"error":"instance_not_found_or_origin_not_authorized"}` as a wrong
instance — if you get it, verify BOTH the instance id and that your domain
(exact hostname) is registered.

**Testing:** ask GroLabs for a test instance; do not develop against the
merchant's production instance id. (First-class sandbox instances are on the
roadmap.) `localhost` origins work only if registered on the instance.

**PII rule (hard):** no emails, names, or addresses in any analytics field.
Logged-in users are identified by `accountId` = an opaque hash you compute
(e.g. SHA-256 of your internal user id) — the same value everywhere, so one
shopper threads across search, events, and orders.

**Identity fields used throughout:**
- `userId` — anonymous browser id. Mint a UUID once per browser (localStorage +
  a 1-year cookie), send it on every search and event. This is what stitches a
  shopper's journey.
- `accountId` — hashed logged-in identity (see PII rule). Send alongside
  `userId` when the shopper is signed in.

---

# SEARCH

## Sending a search query

`POST /search` from the browser (Origin-validated, no key).

```bash
curl -X POST https://app.grolabs.ai/api/v1/search \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://YOUR-STORE.com' \
  -d '{
    "instance_id": 42,
    "query": "dog food",
    "limit": 20,
    "offset": 0,
    "committed": true,
    "commit_reason": "results_page",
    "userId": "<anonymous browser uuid>"
  }'
```

Field semantics that matter:

- `committed` — **you must send this correctly or search-quality KPIs are
  wrong.** `true` = the shopper settled on the query (pressed Enter / loaded a
  results page). `false` = an as-you-type prefix probe from an autocomplete
  widget (send `commit_reason: "typeahead"`). Probes are excluded from
  quality metrics; settled searches drive them.
- `filters` — optional filter expression string, e.g.
  `brand = "Acme" AND in_stock = true`.
- `facets` — optional array of facet names to aggregate.
- Zero results is a SUCCESS response (`total_hits: 0`) and is deliberately
  recorded — it feeds the merchant's no-results analytics. Do not retry or
  suppress it.

## Reading the results

The response:

```json
{
  "hits": [ { "document": { "id": 123, "name": "...", "price": 18.5,
              "in_stock": true, "url": "...", "image_url": "..." },
              "matched_variation": { "variation_id": 456, "...": "..." } } ],
  "total_hits": 21,
  "processing_time_ms": 9,
  "query_uid": "019f5ba0-...",
  "metadata": { "queryUid": "019f5ba0-...", "indexUid": "inst_42" }
}
```

- Render `hits[].document`. When `matched_variation` is non-null, the query
  matched a specific variant (e.g. "2kg") — prefer its price/image/link over
  the parent product's.
- **Keep `query_uid`.** Store it client-side keyed by the product ids you
  rendered. Every later click/add-to-cart on those products must echo it (see
  EVENTS) — it is the thread that makes keyword→conversion analytics exist.
  Losing it silently degrades the merchant's data; nothing errors.

## Verify (search)

A committed search for a term you know exists returns `total_hits > 0` and a
non-empty `query_uid`; the merchant's dashboard (Dashboard → Search) counts it
within ~1 minute.

---

# CATALOG

Server-side only (write key). Searches can only return products GroLabs
knows, so catalog comes before search works.

## First migration (initial bulk load)

`POST /catalog/documents` — batches of **max 1000 documents**; loop your
catalog. The first load is nothing special: one big upsert.

```bash
curl -X POST https://app.grolabs.ai/api/v1/catalog/documents \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <WRITE_KEY>' \
  -d '{
    "instance_id": 42,
    "documents": [
      { "id": "123", "name": "Dog food 2 kg", "description": "...",
        "price": 18.5, "in_stock": true, "categories": ["Dogs"],
        "url": "https://YOUR-STORE.com/p/123",
        "image_url": "https://..." }
    ]
  }'
```

- `id` is YOUR stable product id — the same id you will send as `objectId`
  in events. Keep them identical or attribution breaks.
- Ingestion is accept-fast: the response is an ack with a `task_id`. Poll
  `GET /catalog/tasks/{taskId}` until terminal before asserting counts.
- Unknown fields are retained verbatim for display; core fields (`name`,
  `price`, `in_stock`, `categories`, …) drive ranking and filtering.

## Ongoing updates

- **Product changed** (price, stock, name…): re-send the full document to
  `POST /catalog/documents` — it is an upsert by `id`. Send only changed
  documents; do this on your product-update hook or as a periodic diff job.
- **Product removed:** `POST /catalog/documents/delete` with
  `{"instance_id": 42, "ids": ["123", ...]}` (max 1000 per call).
- **Full resync** (schema rework, corrupted state): `DELETE
  /catalog/documents?instance_id=42` then re-run the first-migration loop.
  This empties live search results until the reload finishes — do it in a
  maintenance window.
- All writes are idempotent; retrying a failed batch is always safe.

## Verify (catalog)

`GET /catalog/summary?instance_id=42` (write key) returns document counts —
must equal what you sent. Then run one search for a known product name.

---

# EVENTS

Browser-side (Origin-validated, no key): `POST /events`. Fire-and-forget —
use `keepalive: true` (or `navigator.sendBeacon`) so events survive page
navigation.

## The events you monitor

Each row = one thing to instrument. `eventType` + `eventName` are **exact
canonical strings** — analytics keys off them; a misspelling silently
disappears from the merchant's KPIs.

| You are monitoring | `eventType` | `eventName` | When to fire | Required extras | Recommended extras |
|---|---|---|---|---|---|
| A shopper clicked a search result | `click` | `Search Result Clicked` | Click on a rendered hit (title, image, or button) | `objectId`, `queryUid` (from the search that rendered it), `position` (1-based rank in the full result list) | `objectName` |
| A shopper opened a product page | `view` | `Product viewed` | Product-detail page load | `objectId` | `placement` |
| Added to cart | `conversion` | `Added to cart` | The add-to-cart action succeeds | `objectId`, `quantity` (the DELTA added), `cartId` | `queryUid` if the product came from a search, `value`, `placement` (`pdp`, `plp`, `search_results`, `related`…) |
| Cart quantity changed | `conversion` | `Cart updated` | Qty edited on the cart page | `objectId`, `quantity` (new ABSOLUTE qty), `cartId` | |
| Removed from cart | `cart_remove` | `Removed from cart` | Line removed from cart | `objectId`, `cartId` | |
| Checkout started | `conversion` | `Proceeded to check out` | Checkout page reached with items (fire once per item set — dedupe per session) | `objectId` per cart item, `cartId` | |
| Order completed (client echo) | `conversion` | `Completed order` | Thank-you / order-received page | `objectId` per line, `orderId`, `value` (line total ex-tax), `quantity`, `cartId` | |

Cross-cutting rules:

- `userId` on **every** event (and `accountId` too when signed in).
- `cartId`: mint a UUID when a cart first gets an item; send it on every
  cart/checkout/order event; rotate it when the cart empties or the order
  completes. It is the key that threads add → checkout → order into one
  journey.
- `queryUid`: only attach when the product genuinely came from a search this
  session. Never fabricate one — un-attributed events are expected and fine.

```bash
curl -X POST https://app.grolabs.ai/api/v1/events \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://YOUR-STORE.com' \
  -d '{
    "instance_id": 42,
    "eventType": "click",
    "eventName": "Search Result Clicked",
    "objectId": "123",
    "position": 2,
    "queryUid": "<query_uid from the search response>",
    "userId": "<anonymous browser uuid>"
  }'
```

## Orders — the authoritative revenue record

`POST /orders`, **server-side, on your payment-complete hook** (write key not
required — it is Origin-validated, so send the header). The client-side
`Completed order` event above is the loss-tolerant echo; this call is the
book of record. **Idempotent** on `(instance_id, orderId)` — retries and
double-fires never double-count.

```bash
curl -X POST https://app.grolabs.ai/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://YOUR-STORE.com' \
  -d '{
    "instance_id": 42,
    "orderId": "1762",
    "amount": 200,
    "currency": "GTQ",
    "itemCount": 1,
    "totalQuantity": 1,
    "cartId": "<the cart id from the journey>",
    "accountId": "<hashed customer id, if signed in>"
  }'
```

**Always send `currency`.** If omitted it defaults from the instance
configuration — correct for single-currency stores, wrong the day you sell
in a second currency.

## Verify (events)

Perform one scripted journey — search → click → add to cart → checkout →
order — then check the merchant dashboard: the search appears with a click,
and the order appears with revenue. Every event API response is
`{"ok": true}`; a `400` names the missing field; a `403` is the
origin/instance check.

---

# GA4

Nothing to integrate through this API. GA4 covers the traffic side
(sessions, acquisition, page views) and connects **read-only inside the
GroLabs app**: the merchant signs into GroLabs and authorizes the Google
account that owns the GA4 property (Configuration → GA4). Your only
responsibility as the storefront developer: keep your existing GA4 tag
(`gtag.js`) installed and firing. If the store has no GA4 property, that is
a merchant decision, not an integration blocker — search, catalog, and
events above work without it.

---

# Final checklist for the agent

- [ ] Catalog loaded; `/catalog/summary` count equals what you sent
- [ ] Committed search returns hits; `query_uid` captured and echoed on clicks
- [ ] Typeahead (if any) sends `committed: false`
- [ ] All seven canonical events wired with exact names; `userId` on all
- [ ] `cartId` threads add → checkout → order; `orderId` + `currency` on `/orders`
- [ ] No PII in any field; `accountId` is a hash
- [ ] Product-update and product-delete hooks keep the catalog in sync
