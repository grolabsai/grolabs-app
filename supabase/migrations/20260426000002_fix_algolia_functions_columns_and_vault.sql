-- Fix two bugs in algolia helper functions introduced in 20260426000001:
--
-- Fix 1: instance table PK is `instance_id`, not `id`.
--        algolia_save_credentials and algolia_record_verification both had
--        `WHERE id = p_instance_id` which silently matched nothing.
--
-- Fix 2: vault.delete_secret(uuid) does not exist in supabase_vault 0.3.1.
--        algolia_save_credentials was calling it before vault.create_secret.
--        Replaced with vault.update_secret on existing rows, vault.create_secret
--        on new rows, keeping the same secret name for the lifetime of the instance.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. algolia_save_credentials  (fixes: WHERE id → WHERE instance_id, vault upsert)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.algolia_save_credentials(
  p_instance_id bigint,
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
    'algolia', jsonb_build_object(
      'app_id',         p_app_id,
      'region',         p_region,
      'search_api_key', p_search_key,
      'primary_index',  p_index
    )
  )
  WHERE instance_id = p_instance_id;  -- fix 1: was `id`

  -- Store admin key in Vault: update if exists, create if new
  v_secret_name := 'algolia_admin_key_instance_' || p_instance_id::text;

  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_existing_id IS NOT NULL THEN
    -- fix 2: was vault.delete_secret(v_existing_id) which doesn't exist in 0.3.1
    PERFORM vault.update_secret(v_existing_id, p_admin_key);
    v_secret_id := v_existing_id;
  ELSE
    v_secret_id := vault.create_secret(p_admin_key, v_secret_name);
  END IF;

  RETURN v_secret_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. algolia_record_verification  (fix 1: WHERE id → WHERE instance_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.algolia_record_verification(
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
  -- Verify caller is an active member of the instance
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
    'algolia', COALESCE(integrations_config->'algolia', '{}'::jsonb) || jsonb_build_object(
      'last_verified_at',         p_verified_at,
      'last_http_status',         p_http_status,
      'last_verified_latency_ms', p_latency_ms
    )
  )
  WHERE instance_id = p_instance_id;  -- fix 1: was `id`
END;
$$;

-- algolia_get_admin_key is unchanged — no bugs to fix.

-- Re-grant execute (CREATE OR REPLACE preserves grants but explicit is safer)
GRANT EXECUTE ON FUNCTION public.algolia_save_credentials(bigint, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.algolia_record_verification(bigint, int, int, timestamptz) TO authenticated;
