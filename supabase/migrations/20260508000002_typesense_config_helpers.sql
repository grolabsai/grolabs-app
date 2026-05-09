-- Typesense configuration helpers
-- Mirrors the Algolia adapter pattern (see 20260426000001 + 20260426000002):
-- three SECURITY DEFINER functions that keep Vault access out of client reach.
-- All functions verify the calling user is an active member of the target instance.
--
-- Stored shape on instance.integrations_config -> typesense (JSONB):
--   {
--     "host":                    "xxx.a1.typesense.net",
--     "port":                    443,
--     "protocol":                "https",
--     "search_only_api_key":     "<public, search-only key>",
--     "primary_collection":      "products",
--     "last_verified_at":        "...",
--     "last_http_status":        200,
--     "last_verified_latency_ms":42
--   }
-- The admin (write) API key lives in Vault under name
-- 'typesense_admin_key_instance_<instance_id>' and is never written to JSONB.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. typesense_save_credentials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.typesense_save_credentials(
  p_instance_id        bigint,
  p_host               text,
  p_port               int,
  p_protocol           text,
  p_search_only_key    text,
  p_admin_key          text,
  p_primary_collection text
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
  -- Verify caller is an active member of the instance
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  -- Upsert non-secret fields into integrations_config
  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'typesense', jsonb_build_object(
      'host',                p_host,
      'port',                p_port,
      'protocol',            p_protocol,
      'search_only_api_key', p_search_only_key,
      'primary_collection',  p_primary_collection
    )
  )
  WHERE instance_id = p_instance_id;

  -- Store admin key in Vault: update if exists, create if new
  v_secret_name := 'typesense_admin_key_instance_' || p_instance_id::text;

  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, p_admin_key);
    v_secret_id := v_existing_id;
  ELSE
    v_secret_id := vault.create_secret(p_admin_key, v_secret_name);
  END IF;

  RETURN v_secret_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. typesense_get_admin_key
--    Returns the decrypted admin key for server-side use only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.typesense_get_admin_key(
  p_instance_id bigint
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
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  v_secret_name := 'typesense_admin_key_instance_' || p_instance_id::text;

  SELECT decrypted_secret INTO v_admin_key
  FROM vault.decrypted_secrets
  WHERE name = v_secret_name;

  RETURN v_admin_key;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. typesense_record_verification
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.typesense_record_verification(
  p_instance_id bigint,
  p_http_status int,
  p_latency_ms  int,
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
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'typesense', COALESCE(integrations_config->'typesense', '{}'::jsonb) || jsonb_build_object(
      'last_verified_at',         p_verified_at,
      'last_http_status',         p_http_status,
      'last_verified_latency_ms', p_latency_ms
    )
  )
  WHERE instance_id = p_instance_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.typesense_save_credentials(bigint, text, int, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.typesense_get_admin_key(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.typesense_record_verification(bigint, int, int, timestamptz) TO authenticated;
