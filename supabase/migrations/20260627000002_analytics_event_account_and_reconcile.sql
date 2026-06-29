-- Conversion-Measurement Foundations (B1) — analytics_event: identity + drift reconcile.
--
-- See docs/design/event-tracking.md.
--
-- Part A — ADD account_id (genuinely missing). Option B identity on the event
-- atom: stamped when the storefront shopper is logged in, so a journey can be
-- attributed to a human (device tier v1). Anonymous events stay on user_id.
--
-- Part B — RECONCILE DRIFT (Constitution Art. 10: repo is the source of truth).
-- The live `scout` DB already carries cart_id / order_id / source on
-- analytics_event, but there is NO migration file and NO scout_schema_version
-- row that introduced them — they were added out-of-band (likely during the
-- BYO/SDK work, ~2026-06-05; the SDK README's "journey keys" the event payload
-- never actually sent). These ADD COLUMN IF NOT EXISTS statements are a no-op
-- against the live DB but make a fresh build match reality and put the columns
-- under version control. Their semantics:
--   - order_id : the WC order id on a Completed-order event (purchase grain).
--   - cart_id  : best-effort WC session/cart identity threading add→checkout→order.
--   - source   : pre-existing, purpose UNCONFIRMED (left as-is; do NOT populate
--                until the BYO/SDK work that introduced it is consulted).

ALTER TABLE public.analytics_event
  ADD COLUMN IF NOT EXISTS cart_id    text NULL,
  ADD COLUMN IF NOT EXISTS order_id   text NULL,
  ADD COLUMN IF NOT EXISTS source     text NULL,
  ADD COLUMN IF NOT EXISTS account_id text NULL;

-- Journey-by-human lookups.
CREATE INDEX IF NOT EXISTS idx_analytics_event_instance_account
  ON public.analytics_event (instance_id, account_id)
  WHERE account_id IS NOT NULL;

-- Purchase-grain lookups (orders).
CREATE INDEX IF NOT EXISTS idx_analytics_event_instance_order
  ON public.analytics_event (instance_id, order_id)
  WHERE order_id IS NOT NULL;

COMMENT ON COLUMN public.analytics_event.account_id IS
  'Opaque, stable id for a logged-in storefront customer (hashed WC user id, never raw, never PII). Soft-joins to query_log.account_id. NULL for anonymous events (use user_id). Option B identity, device tier.';
COMMENT ON COLUMN public.analytics_event.order_id IS
  'WC order id for Completed-order events (purchase grain). NULL for non-order events. Formalized 2026-06-27 (column pre-existed as untracked drift).';
COMMENT ON COLUMN public.analytics_event.cart_id IS
  'Best-effort WC session/cart identity threading add→checkout→order into one journey. NULL when unavailable. Formalized 2026-06-27 (column pre-existed as untracked drift).';
COMMENT ON COLUMN public.analytics_event.source IS
  'Pre-existing column (untracked drift, formalized 2026-06-27). Purpose UNCONFIRMED — likely platform source from the BYO/SDK work. Left unpopulated until that work is consulted.';

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260627000002',
  'B1 conversion-measurement: analytics_event gains account_id (Option B identity); reconcile untracked cart_id/order_id/source drift into version control (Art. 10)'
)
ON CONFLICT (version) DO NOTHING;
