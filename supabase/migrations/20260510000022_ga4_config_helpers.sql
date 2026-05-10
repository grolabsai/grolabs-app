-- GA4 configuration helpers.
-- Mirrors the WooCommerce / Algolia patterns: SECURITY DEFINER functions that
-- keep Vault access out of client reach. All verify the caller is an active
-- member of the target instance.
--
-- Secret stored in Vault: ga4_refresh_token_instance_<id>
--
-- Public config in instance.integrations_config.ga4 JSONB:
--   property_id            text     — GA4 property ID (numeric, stored as text)
--   oauth_account_email    text     — connected Google account email
--   connected_at           timestamptz
--   last_pull_at           timestamptz
--   last_pull_status       text     — 'ok' | 'error'
--   last_pull_error        text     — last error message if status='error'
--   last_pull_latency_ms   int

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ga4_save_credentials — called from the OAuth callback after successful
--    code-for-token exchange. Stores refresh token in Vault, public fields in
--    integrations_config.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ga4_save_credentials(
  p_instance_id         bigint,
  p_property_id         text,
  p_oauth_account_email text,
  p_refresh_token       text
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
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  -- Public fields
  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'ga4', COALESCE(integrations_config->'ga4', '{}'::jsonb) || jsonb_build_object(
      'property_id',         p_property_id,
      'oauth_account_email', p_oauth_account_email,
      'connected_at',        now()
    )
  )
  WHERE instance_id = p_instance_id;

  -- Vault upsert by name
  v_secret_name := 'ga4_refresh_token_instance_' || p_instance_id::text;

  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, p_refresh_token);
    v_secret_id := v_existing_id;
  ELSE
    v_secret_id := vault.create_secret(p_refresh_token, v_secret_name);
  END IF;

  RETURN v_secret_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ga4_get_refresh_token — read by the polling job (via service_role) and by
--    the admin page (to test "is a refresh token present?" — boolean only).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ga4_get_refresh_token(
  p_instance_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_secret text;
BEGIN
  -- Allow service_role to bypass the membership check (cron polling job).
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.instance_member
      WHERE user_id = v_uid
        AND instance_id = p_instance_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'not_member';
    END IF;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'ga4_refresh_token_instance_' || p_instance_id::text;

  RETURN v_secret;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ga4_record_pull — called by the polling job after each instance run.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ga4_record_pull(
  p_instance_id bigint,
  p_status      text,
  p_latency_ms  int,
  p_error       text DEFAULT NULL,
  p_pulled_at   timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role (cron) and active members to record.
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.instance_member
      WHERE user_id = auth.uid()
        AND instance_id = p_instance_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'not_member';
    END IF;
  END IF;

  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'ga4', COALESCE(integrations_config->'ga4', '{}'::jsonb) || jsonb_build_object(
      'last_pull_at',         p_pulled_at,
      'last_pull_status',     p_status,
      'last_pull_error',      p_error,
      'last_pull_latency_ms', p_latency_ms
    )
  )
  WHERE instance_id = p_instance_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ga4_clear_credentials — disconnect. Removes the Vault secret and clears
--    the ga4 sub-key from integrations_config.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ga4_clear_credentials(
  p_instance_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_secret_name text;
  v_existing_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  -- Drop public sub-key
  UPDATE public.instance
  SET integrations_config = integrations_config - 'ga4'
  WHERE instance_id = p_instance_id;

  -- Drop Vault secret if present
  v_secret_name := 'ga4_refresh_token_instance_' || p_instance_id::text;
  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_existing_id;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ga4_list_active_instances — used by the cron polling job to find every
--    instance with a connected GA4 property. Service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ga4_list_active_instances()
RETURNS TABLE (
  instance_id bigint,
  property_id text,
  oauth_account_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only';
  END IF;

  RETURN QUERY
  SELECT
    i.instance_id,
    (i.integrations_config->'ga4'->>'property_id')::text,
    (i.integrations_config->'ga4'->>'oauth_account_email')::text
  FROM public.instance i
  WHERE i.integrations_config ? 'ga4'
    AND (i.integrations_config->'ga4'->>'property_id') IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ga4_save_credentials(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_get_refresh_token(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ga4_record_pull(bigint, text, int, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ga4_clear_credentials(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_list_active_instances() TO service_role;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260510000022', 'GA4: save_credentials + get_refresh_token + record_pull + clear_credentials + list_active_instances RPCs (Vault-backed, mirror WooCommerce pattern)');
