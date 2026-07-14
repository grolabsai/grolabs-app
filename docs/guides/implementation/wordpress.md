# Implementation guide — WordPress / WooCommerce

You chose the WordPress track. Four steps, in order. Don't skip the
verification points — every failure mode we know of is silent: pages keep
rendering and searches keep working even when nothing is being collected.

**You'll need:** wp-admin access to your store, your GroLabs owner login,
and your GroLabs **instance ID** (shown in the app's sidebar; the GroLabs
team also includes it in your welcome email).

---

## Step 1 — Connect your catalog

GroLabs pulls your products from WooCommerce; searches can only return
products GroLabs knows about.

1. In wp-admin: **WooCommerce → Settings → Advanced → REST API → Add key.**
   Description "GroLabs", permissions **Read/Write** (write is used only for
   features you explicitly enable later, like price push-back — imports never
   modify your store). Copy the Consumer key (`ck_…`) and Consumer secret
   (`cs_…`) — the secret is shown only once.
2. In the GroLabs app: **Configuration → WooCommerce** — enter your Site URL
   (https, no `/wp-admin`) and the key pair, then **Test** and **Save**. The
   secret is stored encrypted.
3. In the **Import** section, run **Import categories** first, then
   **Import products**. Products, categories, variants, and prices land in
   your GroLabs catalog and the search index syncs automatically.

**Verify:** the app's **Catalog → Products** shows your products with the
counts you expect.

Re-run the import whenever your catalog changes significantly — it is
re-import-safe (existing products update in place; nothing duplicates).

## Step 2 — Search & event collection (the GroLabs Search plugin)

One plugin does both: serves better search results on your storefront AND
records the searches, clicks, carts, and orders that power your dashboards.

1. **Install:** upload the `grolabs-wordpress-search` release zip in
   wp-admin → Plugins → Add New → Upload, and activate it.
   *Updating later? Use the "Replace current with uploaded" flow — deleting
   the plugin first erases its settings.*
2. **Configure:** Settings → GroLabs Search → enter your **instance ID** →
   Save. The plugin renders nothing on your storefront until an instance ID
   is saved — configured-but-silent is by design, so a half-set-up plugin
   can't break your store.
3. **Purge your page cache** — every layer you run (caching plugin AND your
   host's cache, e.g. Hostinger/LiteSpeed). Cached pages carry the plugin's
   *old* configuration for as long as their lifetime; on a page cached before
   step 2, nothing is collected. Repeat this purge after **any** future
   settings change.
4. **If you use another live-search plugin** (FiboSearch, SearchWP,
   Relevanssi, a theme search): the GroLabs typeahead suppresses the common
   ones automatically. If you still see two dropdowns, add your theme's
   dropdown CSS selector under Settings → GroLabs Search → hide selectors.

**Verify, in your storefront (use a private/incognito window):**
- Type 2+ letters in the search box → a GroLabs suggestions dropdown appears.
- Search for something that exists → results page shows products.
- Search for gibberish → a no-results page (this is recorded too — it's one
  of the most valuable signals).
- In the GroLabs app, **Configuration → Search** shows these requests
  arriving within a minute.

**Optional login/SSO:** if you want social login on the storefront, install
**one** GroLabs login plugin — never two at once.

## Step 3 — Traffic analytics (GA4)

Two halves: tagging your storefront, and letting GroLabs read the property.

1. **Tag the storefront:** install the `grolabs-wordpress-ga4` plugin and
   enter your GA4 **Measurement ID** (G-XXXXXXX, from GA4 Admin → Data
   streams). Skip if your site already has the GA4 tag through another
   plugin — don't tag twice.
2. **Connect GroLabs to GA4:** in the app, **Configuration → GA4**. Two
   sub-steps:
   - **Connect Google Analytics** — sign in with the Google account that
     owns (or has viewer access to) the property.
   - Enter your **GA4 property ID** — the **9-digit number** from
     analytics.google.com → Admin (⚙) → Property settings. Careful: this is
     NOT the "G-…" Measurement ID from step 1 — the two are different codes.
     Then **Save ID** and **Test connection**.

   GroLabs reads traffic data only; it never modifies your Analytics.

**Verify:** the app's **Dashboard → Traffic** starts showing sessions
(GA4 data arrives with up to a day's delay — tiles show data through
yesterday by design).

## Step 4 — Final check

Run through this list once, a day after finishing steps 1–3:

- [ ] Products in **Catalog → Products** match your store
- [ ] Storefront search suggestions come from GroLabs (step 2 verify)
- [ ] **Configuration → Search** shows your searches arriving
- [ ] A test click on a search result and an add-to-cart show up in
      **Configuration → Events**
- [ ] **Dashboard → Traffic** shows yesterday's sessions
- [ ] Your search dashboard (**Dashboard → Search**) shows yesterday's
      search volume

All six green: you're fully connected. Anything not green after a cache
purge and a day's wait — contact GroLabs; include which checkbox failed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No suggestions dropdown, storefront otherwise fine | Plugin has no instance ID saved, isn't activated, or a cached page predates configuration | Save the instance ID, activate, purge every cache layer |
| Settings were empty after a plugin update | The plugin was deleted and reinstalled (delete erases settings) | Re-enter settings; next time update in place |
| Searches work but nothing shows in Configuration → Search | Your domain isn't authorized for your instance, or a stale cached page carries an old configuration | Contact GroLabs to confirm your storefront domains; purge caches |
| Repeating the same test search doesn't show up again | Identical searches are served from a short-lived cache (by design) | Test with different words each time |
| Two search dropdowns appear | Another live-search plugin isn't in the hide list | Add its dropdown selector in the plugin settings |
| Search returns no products for anything | Catalog not imported yet, or import ran against a different instance | Run Step 1; confirm the instance ID matches |
