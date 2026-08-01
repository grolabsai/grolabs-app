-- GA4: reconnect-preserving credential save + reauth-needed state.
-- Per docs/policy/ga4-integration.md operational notes (2026-08-01).
--
-- Two problems fixed:
--
-- 1. ga4_save_credentials always overwrote integrations_config.ga4.property_id
--    with p_property_id, unconditionally. The OAuth callback always calls it
--    with p_property_id = '' (Google's consent screen doesn't return a
--    property -- the user picks one afterwards on /configuration/ga4). That
--    means a RECONNECT (dead refresh token -> fresh consent -> callback fires
--    again) silently blanked an already-configured property_id, orphaning the
--    instance's snapshot history. Fixed: only overwrite property_id when
--    p_property_id is non-empty; otherwise keep whatever was already stored.
--
-- 2. There was no durable state for "the stored refresh token is dead and the
--    user must reconnect" (Google returns invalid_grant on revoke/expiry/lost
--    access). Adds three new keys under integrations_config.ga4:
--      needs_reauth   boolean  -- true once a refresh call gets invalid_grant
--      reauth_reason  text     -- Google's error description, for the UI
--      reauth_at      timestamptz -- when it was first detected
--    ga4_set_reauth_state is the single write path for these three keys,
--    callable by any active instance member or the service-role poller.
--    ga4_save_credentials clears all three on every successful save (covers
--    both a fresh connect and a reconnect of a lapsed token).

-- 1. ga4_save_credentials -- preserve property_id on empty input, clear reauth
--    state on every successful save.
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
  v_uid          uuid := auth.uid();
  v_secret_name  text;
  v_secret_id    uuid;
  v_existing_id  uuid;
  v_existing_ga4 jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_uid
      AND instance_id = p_instance_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  SELECT COALESCE(integrations_config->'ga4', '{}'::jsonb) INTO v_existing_ga4
  FROM public.instance
  WHERE instance_id = p_instance_id;

  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'ga4', v_existing_ga4 || jsonb_build_object(
      'property_id',         COALESCE(NULLIF(p_property_id, ''), v_existing_ga4->>'property_id'),
      'oauth_account_email', p_oauth_account_email,
      'connected_at',        now(),
      'needs_reauth',        false,
      'reauth_reason',       NULL,
      'reauth_at',           NULL
    )
  )
  WHERE instance_id = p_instance_id;

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

-- 2. ga4_set_reauth_state -- single write path for needs_reauth/reauth_reason/
--    reauth_at.
CREATE OR REPLACE FUNCTION public.ga4_set_reauth_state(
  p_instance_id  bigint,
  p_needs_reauth boolean,
  p_reason       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
      'needs_reauth',  p_needs_reauth,
      'reauth_reason', CASE WHEN p_needs_reauth THEN p_reason ELSE NULL END,
      'reauth_at',     CASE WHEN p_needs_reauth THEN now() ELSE NULL END
    )
  )
  WHERE instance_id = p_instance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ga4_set_reauth_state(bigint, boolean, text) TO authenticated, service_role;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260801000001', 'GA4: ga4_save_credentials preserves property_id on reconnect + clears reauth state; new ga4_set_reauth_state RPC for expired/revoked-token tracking');
