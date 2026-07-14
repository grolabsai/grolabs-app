# GroLabs implementation guide

Everything you connect to GroLabs follows the same four steps: **catalog →
search & events → traffic analytics → verify**. What changes is *how* — and
that depends on one decision you make before anything else.

## First: which kind of store do you run?

**→ WordPress / WooCommerce** (`wordpress.md`)
Your storefront runs on WordPress with WooCommerce. GroLabs connects through
plugins you install in wp-admin plus a one-time catalog import — no code on
your side.

**→ Proprietary e-commerce** (`proprietary.md`)
Your storefront is your own platform (custom build, headless, or any
non-WordPress stack). GroLabs connects through a public API and JavaScript
SDK — your developers integrate three endpoints: catalog ingest, search, and
events.

Pick your track and follow it top to bottom; each one is self-contained from
this point on. If you run both (e.g. a WordPress store today, migrating to a
custom build), do the track that matches the storefront your shoppers
actually use.

## What you'll need before starting (both tracks)

- Your GroLabs account and instance (provisioned by the GroLabs team — you
  received an owner login).
- Admin access to your storefront (wp-admin, or your platform's deploy
  pipeline).
- If you want traffic analytics: access to the Google account that owns your
  GA4 property.

