# Implementation guide — proprietary e-commerce

You chose the proprietary track: your storefront is your own stack, and
GroLabs connects through its **public API** and the **`@grolabs/web-sdk`**
JavaScript SDK. Your developers integrate three surfaces — catalog ingest,
search, and events — in that order.

**You'll need:**
- Your **Instance ID** — public, like a publishable key. Shown in the app
  under **Configuration → External platform** (copy action) and in your
  welcome email.
- A **write key** — secret, server-side only, like a secret key. Issue it
  yourself under **Configuration → External platform** — it's shown once,
  at issuance, so copy it straight into your server's secret store. The
  same screen rotates it if it ever leaks.
- Your **storefront domain(s) registered** with your instance — the browser
  APIs authenticate by matching the request's `Origin` against them, so an
  unregistered domain is silently rejected. Managed in Configuration →
  Search, or ask the GroLabs team.

**Reference:** full OpenAPI spec at `https://app.grolabs.ai/openapi.yaml`,
browsable Swagger UI at `https://app.grolabs.ai/api-docs.html`.

**The trust model in one line:** the browser never holds a secret — search
and events are origin-validated; anything that writes your catalog runs on
your server with the write key.

---

## Step 1 — Connect your catalog (server-side)

Searches can only return products GroLabs knows about, so ingest comes
first. From any server-side job (Node):

```ts
import { createGrolabsIngest } from "@grolabs/web-sdk/ingest";

const ingest = createGrolabsIngest({
  baseUrl: "https://app.grolabs.ai",
  instanceId: YOUR_INSTANCE_ID,
  writeKey: process.env.GROLABS_WRITE_KEY, // never ship this to the browser
});

const ack = await ingest.upsert([
  { id: "SKU-1", title: "Trail shoes", price: 120 /* … your fields … */ },
]);
// Ingestion is accept-fast: you get a task id back, then poll it.
const status = await ingest.task(ack.task_id); // processing | succeeded | failed
```

- Re-running `upsert` with the same ids updates in place — safe to wire into
  your product-update pipeline.
- `ingest.delete([...])` / `ingest.deleteAll()` remove products;
  `ingest.updateSettings({ filterableAttributes, sortableAttributes })`
  controls which fields can filter/sort search results.
- Messy or one-off data? There's an **assisted intake** flow (upload → map
  fields → review → promote) where nothing reaches the live catalog until
  you accept it — see the "intake sessions" section of the API reference.

**Verify:** the GroLabs app's **Catalog → Products** shows your products.

## Step 2 — Search & event collection (browser-side)

```ts
import { createGrolabsClient } from "@grolabs/web-sdk";

const grolabs = createGrolabsClient({
  baseUrl: "https://app.grolabs.ai",
  instanceId: YOUR_INSTANCE_ID, // public — no secret in the browser
});

// Search (wire to your search box / results page):
const results = await grolabs.search({
  query: "trail shoes",
  filters: "in_stock = true",
});

// Events (wire to your product interactions):
grolabs.trackClick({ objectId: "SKU-2", position: 1 });
grolabs.trackAddToCart({ objectId: "SKU-2", quantity: 1 });
grolabs.trackRemoveFromCart({ objectId: "SKU-2" });
grolabs.trackOrder({ orderId: "1001", amount: 240, currency: "USD" /* … */ });
```

Rules that make the analytics meaningful:

- **Attribution is automatic when you pass `objectId`** — the SDK attaches
  the `query_uid` of the search that surfaced the product, which is what
  stitches search → click → cart → order into one journey. Fire the events
  even for products reached without a search; they're recorded as
  direct-journey events.
- **Send every order with `trackOrder`** including `amount` and `currency` —
  it's idempotent on `orderId`, so re-firing on status changes is safe and
  keeps revenue KPIs exact.
- **Logged-in shoppers:** call `grolabs.setAccountId(yourHashedId)` at login
  with an opaque hash of your customer id — **never an email or raw id**.
  Anonymous visitors are handled automatically (the SDK maintains a browser
  id).
- Using React? `@grolabs/web-sdk/react` ships a headless provider + hooks
  over the same client.

**Verify, from your storefront:** run a search and click a result, then
check the GroLabs app — **Configuration → Search** shows the search arriving
and **Configuration → Events** shows the click, within a minute.

## Step 3 — Traffic analytics (GA4)

1. Your site presumably already carries the GA4 tag (gtag/GTM). If not, add
   it the standard Google way — GroLabs doesn't need a special tag.
2. In the GroLabs app, **Configuration → GA4**:
   - **Connect Google Analytics** — sign in with the Google account that
     owns (or can view) the property.
   - Enter your **GA4 property ID** — the **9-digit number** from
     analytics.google.com → Admin (⚙) → Property settings. This is NOT the
     "G-…" Measurement ID. Then **Save ID** and **Test connection**.

GroLabs reads traffic data only; it never modifies your Analytics.

**Verify:** **Dashboard → Traffic** shows sessions (GA4 data lags up to a
day; tiles show data through yesterday by design).

## Step 4 — Final check

A day after finishing steps 1–3:

- [ ] **Catalog → Products** matches your catalog, and updates flow when
      your pipeline re-upserts
- [ ] Searches from your storefront appear in **Configuration → Search**
- [ ] Clicks / carts / orders appear in **Configuration → Events**, orders
      with the right amounts and currency
- [ ] **Dashboard → Traffic** shows yesterday's sessions
- [ ] **Dashboard → Search** shows yesterday's search volume

All green: you're fully connected. Anything not green — first confirm your
storefront domain is registered (the silent failure mode for steps 2's
browser calls), then contact GroLabs with the failing checkbox.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser search/events return 403 | Your storefront domain isn't registered for your instance (Origin check) | Register the exact domain(s) — apex AND www if both serve traffic |
| Ingest returns 401 | Write key missing/wrong, or used from the browser | Server-side only, correct key in env |
| Search returns zero hits for everything | Catalog not ingested, or task still `processing` | Poll the task id; check Catalog → Products |
| Events arrive but journeys don't stitch | `objectId` not passed on events, or orders fired without `orderId` | Pass ids consistently; see the attribution rules above |
| Revenue looks wrong | Orders sent without `amount`/`currency` | Always include both in `trackOrder` |
