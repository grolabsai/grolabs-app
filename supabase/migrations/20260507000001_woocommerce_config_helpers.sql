-- WooCommerce configuration helpers
-- Mirrors the Algolia pattern (migrations 20260426000001 + 20260426000002):
-- three SECURITY DEFINER functions that keep Vault access out of client
-- reach. All verify the caller is an active member of the target instance.
--
-- Secret stored in Vault:    woocommerce_consumer_secret_instance_<id>
-- Public config in instance.integrations_config.woocommerce JSONB:
--   site_url            (e.g. https://shop.example.com)
--   consumer_key        (visible to authenticated users; not a secret per se)
--   last_verified_at    timestamptz
--   last_http_status    int
--   last_verified_latency_ms int

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. woocommerce_save_credentials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.woocommerce_save_credentials(
  p_instance_id      bigint,
  p_site_url         text,
  p_consumer_key     text,
  p_consumer_secret  text
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

  -- Upsert non-secret fields. Strip trailing slash on site_url so callers
  -- don't double up when concatenating /wp-json paths.
  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'woocommerce', COALESCE(integrations_config->'woocommerce', '{}'::jsonb) || jsonb_build_object(
      'site_url',     rtrim(p_site_url, '/'),
      'consumer_key', p_consumer_key
    )
  )
  WHERE instance_id = p_instance_id;

  -- Vault upsert by name
  v_secret_name := 'woocommerce_consumer_secret_instance_' || p_instance_id::text;

  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, p_consumer_secret);
    v_secret_id := v_existing_id;
  ELSE
    v_secret_id := vault.create_secret(p_consumer_secret, v_secret_name);
  END IF;

  RETURN v_secret_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. woocommerce_get_consumer_secret
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.woocommerce_get_consumer_secret(
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
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'woocommerce_consumer_secret_instance_' || p_instance_id::text;

  RETURN v_secret;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. woocommerce_record_verification
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.woocommerce_record_verification(
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
    'woocommerce', COALESCE(integrations_config->'woocommerce', '{}'::jsonb) || jsonb_build_object(
      'last_verified_at',         p_verified_at,
      'last_http_status',         p_http_status,
      'last_verified_latency_ms', p_latency_ms
    )
  )
  WHERE instance_id = p_instance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.woocommerce_save_credentials(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.woocommerce_get_consumer_secret(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.woocommerce_record_verification(bigint, int, int, timestamptz) TO authenticated;

INSERT INTO public.scout_schema_version (version, description)
VALUES ('20260507000001', 'WooCommerce: save_credentials + get_consumer_secret + record_verification RPCs (mirror Algolia pattern)');
