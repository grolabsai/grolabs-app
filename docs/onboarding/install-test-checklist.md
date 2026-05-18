# GroLabs WordPress Plugin Test Checklist

**Audience:** GroLabs operators and engineering colleagues verifying a plugin install. Run through this checklist after every fresh install on a new test site, after every plugin version upgrade, and as a pre-flight check before any merchant demo.

**Last updated:** 2026-05-17

---

## How to use this document

Each section corresponds to one plugin. Work through the sections in install order (GA4 → Login → Search). Check off items as you go. If any item fails, stop and resolve before continuing — later sections may depend on earlier ones.

**Mark results with:**
- `[ ]` not yet tested
- `[x]` passed
- `[!]` failed — note details in the issues log at the end

**Browser tooling assumed available:**
- DevTools Network tab (for inspecting requests)
- DevTools Console (for checking for errors)
- DevTools Application tab (for checking localStorage, cookies)
- Private/incognito window (for testing as anonymous user)

---

## Pre-flight environment check

Before testing any plugin, verify:

- [ ] The test WordPress site is reachable from a fresh browser
- [ ] WooCommerce is installed and activated
- [ ] At least 10 products exist in the catalog with: title, price, image, at least one category
- [ ] Site is reachable on HTTPS (not HTTP) — required for OAuth flows
- [ ] You have admin access to the WP site
- [ ] You can complete a test purchase (Stripe test mode, cash-on-delivery, or similar)
- [ ] Ad blockers disabled in your test browser for this site

If any item fails: resolve before proceeding.

---

## Test Set A — GroLabs GA4 Plugin

### Setup verification

- [ ] Plugin appears in WP admin → Plugins, status "Active"
- [ ] Plugin settings page is accessible at Settings → Scout Analytics (or current name)
- [ ] GA4 Measurement ID is populated (format `G-XXXXXXXXXX`)
- [ ] MP API Secret is populated (non-empty)
- [ ] All toggles are ON: Track traffic, Track ecommerce
- [ ] "Probar conexión" / Test Connection button returns success

### Client-side event firing

In a private browser window with DevTools Network tab open and filtered to `google-analytics.com`:

- [ ] Load the storefront homepage → see a `collect` request with `en=page_view`
- [ ] Click into a product page → see a `collect` request with `en=view_item`
- [ ] Open a category page → see `view_item_list` event fire
- [ ] Add a product to cart → see `add_to_cart` event fire
- [ ] Proceed to checkout → see `begin_checkout` event fire
- [ ] Complete a test purchase → see `purchase` event fire

### Server-side event firing

- [ ] After completing the purchase above, verify in WP debug log (or via the plugin's debug toggle if available) that the server-side MP API call to `https://www.google-analytics.com/mp/collect` was made
- [ ] The server-side event includes the `transaction_id` matching the WC order ID

### GA4 dashboard verification

In Google Analytics → Reports → Realtime:

- [ ] Within 60 seconds of testing, your user appears in the active user count
- [ ] The events list shows: `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, `purchase`
- [ ] The purchase event shows revenue value, currency, and items array

### Common failure modes — verify these don't trigger

- [ ] No JavaScript errors in browser console
- [ ] No duplicate event fires (e.g., `purchase` should fire exactly once per order, not twice)
- [ ] Test mode is OFF (or, if ON, events are prefixed with `test_` as expected)

---

## Test Set B — GroLabs Login Plugin

### Setup verification

- [ ] Plugin appears in WP admin → Plugins, status "Active"
- [ ] Plugin settings page is accessible
- [ ] Google provider is enabled (toggle ON)
- [ ] Client ID is populated
- [ ] Client Secret is populated (likely shown as `••••••••`)
- [ ] The Redirect URI shown in the plugin matches what's in Google Cloud Console
- [ ] Placement is set to "Above the checkout form" (or the configured placement for this site)

### Google Cloud OAuth configuration sanity check

In https://console.cloud.google.com → APIs & Services → Credentials → OAuth client:

- [ ] Authorized JavaScript origins includes the test site's URL (e.g., `https://wazu-test.example.com`)
- [ ] Authorized redirect URIs includes EXACTLY the URL the plugin generates (no trailing slash mismatch, no http/https mismatch)
- [ ] OAuth consent screen → Test users includes the email you're testing with

### End-to-end SSO flow

In a private/incognito browser window:

- [ ] Add a product to cart on the storefront
- [ ] Proceed to checkout
- [ ] The "Sign in with Google" button appears in the configured location
- [ ] Click the button → redirected to Google's OAuth screen
- [ ] Approve with a test user email → redirected back to checkout (NOT to wp-login.php)
- [ ] The checkout form is pre-filled with name and email from Google
- [ ] The email field matches your Google account email
- [ ] You can complete the order without typing a password

### Account creation verification

After completing the SSO order:

- [ ] In WP admin → Users, a new user appears with the Google account email
- [ ] The user has role "Customer" (not Subscriber, not anything else odd)
- [ ] In WP admin → WooCommerce → Orders, the new order is associated with that user (not "Guest")

### Sign back in flow

- [ ] Log out of the storefront
- [ ] In a fresh private window, add a product to cart and proceed to checkout
- [ ] Click "Sign in with Google" again with the same Google account
- [ ] You're signed in to the existing user account, NOT a duplicate user
- [ ] WP admin → Users shows still only one user with that email (no duplicate created)

### Common failure modes — verify these don't trigger

- [ ] No `redirect_uri_mismatch` error from Google
- [ ] No "This app isn't verified" hard-block (a warning is OK during test phase if you can click "Advanced" → "Go to app")
- [ ] No JavaScript errors in browser console
- [ ] The SSO button is not displayed in places it shouldn't be (e.g., not on every page, only at checkout per configuration)

---

## Test Set C — GroLabs Search Plugin v0.3.0

### Pre-conditions (do these BEFORE testing the plugin)

These verify the supporting infrastructure that the plugin depends on:

- [ ] grolabs-core is deployed with `feature/search-click-events` merged to main
- [ ] grolabs-core environment variables are set: `MEILISEARCH_HOST`, `MEILISEARCH_MASTER_KEY`
- [ ] The events action validation test (Option A from test plan) has passed against the live cluster
- [ ] An instance exists in grolabs-core for this storefront with `is_active = true`
- [ ] The storefront's hostname is in the instance's `storefront_domains` list
- [ ] In grolabs-core admin → Configuration → Search → reindex has been run successfully
- [ ] In grolabs-core admin, the document count for this instance matches the expected product count

### Setup verification

- [ ] Plugin appears in WP admin → Plugins, status "Active"
- [ ] Plugin settings page is accessible at Settings → Scout Search (or current name)
- [ ] GroLabs Core API host is populated and matches deployment URL
- [ ] Instance ID is populated and matches the instance configured in grolabs-core
- [ ] Test Connection button (if available) returns success

### Search results render

In a private browser window with DevTools Network tab open:

- [ ] Trigger the search overlay (depends on theme integration — search icon, URL like `/?s=test`, etc.)
- [ ] Type a known product keyword (e.g., "puppy food" if you have such products)
- [ ] Results appear and match products in the catalog
- [ ] In the Network tab, you see `POST /api/v1/search` to the grolabs-core host
- [ ] The response is 200 OK
- [ ] The response body's `metadata.queryUid` is a non-empty UUID-shaped string (NOT a locally generated one — should match MeiliSearch's format)
- [ ] The response body's `metadata.indexUid` matches the expected `inst_<instance_id>` format

### Result cards have data attributes

- [ ] In the rendered HTML, each product card has a `<div class="scout-product-card">` wrapper
- [ ] Each card has `data-query-uid="..."` populated with the same queryUid as the search response
- [ ] Each card has `data-index-uid="..."` populated
- [ ] Each card has `data-product-id="..."` matching the WC product ID
- [ ] Each card has `data-product-name="..."` populated
- [ ] Each card has `data-position="..."` with the correct zero-based index (0, 1, 2, ...)

### Anonymous session UUID

- [ ] In DevTools Application tab → localStorage, a key `scout_session_id` is present
- [ ] The value is a UUID-shaped string
- [ ] Refreshing the page does NOT change this value (session persists)
- [ ] Opening a different private window creates a DIFFERENT value (sessions are per-browser)

### Click event submission

With DevTools Network tab open, filtered to show all requests:

- [ ] Click a search result card
- [ ] First request: `POST /api/v1/events/token` to grolabs-core → returns 200 with `{token, expires_at, meilisearch_host, index_uid}`
- [ ] Second request: `POST {meilisearch_host}/events` → returns 204 or similar success status
- [ ] The events request payload contains:
  - `eventType: "click"`
  - `eventName: "Search Result Clicked"`
  - `indexUid` matching the card's data attribute
  - `userId` matching the localStorage `scout_session_id`
  - `queryUid` matching the card's data attribute
  - `objectId` matching the product ID
  - `objectName` matching the product name
  - `position` matching the card's position
- [ ] After the events request fires, the browser navigates to the product page (navigation is NOT blocked)

### Token caching

- [ ] Click a second result on the same page
- [ ] The second click does NOT trigger another `POST /api/v1/events/token` request (token is cached in memory)
- [ ] The click event still fires to MeiliSearch

### MeiliSearch analytics dashboard verification

After clicking 10+ results across 3+ different searches, wait 5-10 minutes for MeiliSearch to aggregate, then in the MeiliSearch Cloud dashboard:

- [ ] Navigate to the project's Analytics tab
- [ ] Search events are listed for the queries you ran
- [ ] Click-through rate metric is non-zero
- [ ] Average click position is computed (typically 0-3 range for relevant searches)
- [ ] At least one query shows up in the "Popular searches" or equivalent

### Failure-mode tolerance

These verify the plugin degrades gracefully when something goes wrong:

- [ ] Temporarily set the wrong Instance ID in plugin settings → search still renders (falls back to WC default) without breaking the page
- [ ] Restore Instance ID, then temporarily block the grolabs-core URL in browser → no JavaScript errors thrown, only `GroLabs:` console warnings
- [ ] In the browser, click a result → click navigation proceeds even if event submission failed
- [ ] Restore everything → confirm everything works again

### Common failure modes — verify these don't trigger

- [ ] No JavaScript errors in browser console
- [ ] No vendor names (MeiliSearch, etc.) visible in console messages — all `GroLabs:` prefixed
- [ ] No vendor names visible in DOM, HTML source, or rendered page
- [ ] No duplicate event firing on a single click
- [ ] Token expiry refresh works correctly (wait 15+ minutes, click, verify token refresh fires)

---

## Cross-plugin integration check

After all three plugins are installed and tested individually:

- [ ] Complete a full customer journey in one session:
  1. Load homepage (GA4: page_view fires)
  2. Search for a product (Search plugin: queryUid captured)
  3. Click a search result (Search plugin: click event to MeiliSearch fires)
  4. View the product (GA4: view_item fires)
  5. Add to cart (GA4: add_to_cart fires)
  6. Proceed to checkout
  7. Sign in with Google (Login plugin: SSO completes, form auto-fills)
  8. Complete purchase (GA4: purchase fires client-side AND server-side)
- [ ] Verify in GA4 realtime that the full event sequence is captured
- [ ] Verify in MeiliSearch analytics that the search and click are recorded
- [ ] Verify in WC admin that the order is associated with the SSO-created user

If all of the above pass: this install is verified end-to-end.

---

## Issues log

Use this section to capture anything that fails during the checklist run. Helps diagnose patterns across multiple installs.

| Date | Test set | Item | Symptom | Resolution |
|---|---|---|---|---|
| | | | | |

---

## Verification record

After completing the full checklist, record the result:

- **Date of test run:** _____________
- **Test site URL:** _____________
- **GA4 Property:** _____________
- **grolabs-core deployment URL:** _____________
- **MeiliSearch project:** _____________
- **Tester:** _____________
- **Overall result:** PASS / PASS with notes / FAIL
- **Notes:**

---

*This checklist lives at `docs/onboarding/install-test-checklist.md` in the grolabs-core repository. Update it whenever a plugin's install or behavior materially changes. Run it before every demo, every new tenant install, and every plugin version upgrade.*
