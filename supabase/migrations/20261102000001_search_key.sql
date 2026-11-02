-- Per-instance permanent Meilisearch search keys.
--
-- Per docs/design/direct-meilisearch-search.md Phase 1 (R-4, R-6, R-9).
--
-- The storefront queries Meilisearch directly, so it needs a credential of
-- its own. That credential is ONE permanent, search-only Meilisearch API key
-- per instance -- actions ["search"], indexes ["inst_N"], expiresAt null --
-- named `grolabs-inst-N` so an operator can find and delete it by hand in the
-- Meilisearch console. Manual deletion IS the enforcement path: there is no
-- expiry and no refresher (R-2).
--
-- Why an API key and not a tenant token: Meilisearch has no tenant-token API.
-- Tokens are JWTs signed locally from a parent key, cannot be listed, and
-- cannot be revoked individually -- only by deleting the parent key, which
-- would cut off every tenant signed with it. API keys have full CRUD (R-3).
--
-- Why the key VALUE is stored in plaintext, unlike byo_write_key's hash: this
-- key is public by design. It is read-only, scoped to one index, and ends up
-- in the storefront's page source, exactly like an Algolia search key. The
-- merchant must be able to re-read it to paste into their Shopify block
-- settings, so a one-way hash would defeat the purpose. It still must never
-- be served to `anon` from our database -- hence deny-all RLS below.
--
-- History is preserved rather than overwritten: the plan's first sketch keyed
-- the table on instance_id alone, but then a revoked key leaves no trace, and
-- R-9 requires manual enforcement to be visible after the fact. So rows are
-- append-only with a partial unique index guaranteeing at most one LIVE key
-- per instance; revoked rows stay as the audit trail of who was cut off when.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_key (
  search_key_id bigserial PRIMARY KEY,
  instance_id   bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  key_uid       text NOT NULL,
  key_value     text NOT NULL,
  key_name      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  revoked_at    timestamptz,
  revoked_by    uuid
);

-- At most one live key per instance. Revoked rows are unconstrained so the
-- audit trail can hold as many as it needs.
CREATE UNIQUE INDEX IF NOT EXISTS search_key_one_live_per_instance
  ON public.search_key (instance_id)
  WHERE revoked_at IS NULL;

-- The provisioning path looks a key up by instance; the status panel reads
-- the history newest-first.
CREATE INDEX IF NOT EXISTS search_key_instance_created
  ON public.search_key (instance_id, created_at DESC);

COMMENT ON TABLE public.search_key IS
  'Permanent per-instance Meilisearch search keys (actions=[search], one index, no expiry). Append-only; at most one row per instance with revoked_at IS NULL. key_value is plaintext on purpose -- it is a public, read-only storefront credential. See docs/design/direct-meilisearch-search.md.';

COMMENT ON COLUMN public.search_key.key_uid IS
  'Meilisearch key uid. The revocation target: DELETE /keys/{uid}.';
COMMENT ON COLUMN public.search_key.key_value IS
  'The key itself. Public by design (ships in storefront page source); never serve to anon from here.';
COMMENT ON COLUMN public.search_key.revoked_at IS
  'Set when the key is deleted in Meilisearch, by the app or by hand. NULL = live.';

-- ---------------------------------------------------------------------------
-- 2. RLS -- deny-all
-- ---------------------------------------------------------------------------
-- No policies on purpose. Every read and write goes through the service-role
-- client in server actions, which check instance_member first. Provisioning
-- and revocation both have to call the Meilisearch HTTP API in the same
-- operation as the DB write, so a SECURITY DEFINER RPC (the byo_write_key
-- pattern) cannot own this flow -- the app layer does.
ALTER TABLE public.search_key ENABLE ROW LEVEL SECURITY;
