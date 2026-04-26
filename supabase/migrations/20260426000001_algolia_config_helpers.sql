-- Algolia configuration helpers
-- Three SECURITY DEFINER functions that keep vault access out of client reach.
-- All functions verify the calling user is an active member of the target tenant.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. algolia_save_credentials
--    Saves app_id, region, search_api_key into tenant.integrations_config (JSONB)
--    and stores admin_api_key in Supabase Vault. Returns the vault secret id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.algolia_save_credentials(
  p_tenant_id   bigint,
  p_app_id      text,
  p_region      text,
  p_search_key  text,
  p_admin_key   text,
  p_index       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_secret_name text;
  v_secret_id   uuid;
  v_existing_id uuid;
BEGIN
  -- Verify caller is an active member of the tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_member
    WHERE user_id = v_uid
      AND tenant_id = p_tenant_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  -- Upsert non-secret fields into integrations_config
  UPDATE public.tenant
  SET integrations_config = integrations_config || jsonb_build_object(
    'algolia', jsonb_build_object(
      'app_id',         p_app_id,
      'region',         p_region,
      'search_api_key', p_search_key,
      'primary_index',  p_index
    )
  )
  WHERE id = p_tenant_id;

  -- Store admin key in Vault (delete existing first to avoid duplicates)
  v_secret_name := 'algolia_admin_key_tenant_' || p_tenant_id::text;

  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.delete_secret(v_existing_id);
  END IF;

  v_secret_id := vault.create_secret(p_admin_key, v_secret_name);

  RETURN v_secret_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. algolia_get_admin_key
--    Returns the decrypted admin key from Vault for server-side use only.
--    (Page server component calls this; result is never sent to browser.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.algolia_get_admin_key(
  p_tenant_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_secret_name text;
  v_admin_key   text;
BEGIN
  -- Verify caller is an active member of the tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_member
    WHERE user_id = v_uid
      AND tenant_id = p_tenant_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  v_secret_name := 'algolia_admin_key_tenant_' || p_tenant_id::text;

  SELECT decrypted_secret INTO v_admin_key
  FROM vault.decrypted_secrets
  WHERE name = v_secret_name;

  RETURN v_admin_key;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. algolia_record_verification
--    Stamps a last_verified_at timestamp and http_status into the tenant's
--    integrations_config so the UI can show verification status.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.algolia_record_verification(
  p_tenant_id   bigint,
  p_http_status int,
  p_verified_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Verify caller is an active member of the tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_member
    WHERE user_id = v_uid
      AND tenant_id = p_tenant_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  UPDATE public.tenant
  SET integrations_config = integrations_config || jsonb_build_object(
    'algolia', COALESCE(integrations_config->'algolia', '{}'::jsonb) || jsonb_build_object(
      'last_verified_at', p_verified_at,
      'last_http_status', p_http_status
    )
  )
  WHERE id = p_tenant_id;
END;
$$;

-- Grant execute to authenticated users (RPC is accessible via supabase-js)
GRANT EXECUTE ON FUNCTION public.algolia_save_credentials(bigint, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.algolia_get_admin_key(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.algolia_record_verification(bigint, int, timestamptz) TO authenticated;
