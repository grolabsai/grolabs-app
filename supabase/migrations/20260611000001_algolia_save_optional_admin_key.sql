-- Make the Algolia admin key OPTIONAL when saving credentials.
--
-- Previously algolia_save_credentials always tried to write the admin key to
-- Vault, and the calling server action returned an error ("No admin key on
-- file") when none was provided — so a partial/incomplete config could not be
-- saved at all. Saving must never be interrupted just because the data is
-- incomplete. Now:
--
--   * Non-secret fields (app_id, region, search_api_key, primary_index) are
--     always persisted, merged into any existing algolia config so prior
--     verification metadata is preserved.
--   * The admin key is written to Vault only when one is actually provided.
--     When p_admin_key is NULL or empty, the Vault write is skipped and the
--     function returns NULL (no secret id).

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

  -- Upsert non-secret fields, merging into existing algolia config so we don't
  -- clobber last_verified_* metadata when only saving config fields.
  UPDATE public.instance
  SET integrations_config = integrations_config || jsonb_build_object(
    'algolia', COALESCE(integrations_config->'algolia', '{}'::jsonb) || jsonb_build_object(
      'app_id',         p_app_id,
      'region',         p_region,
      'search_api_key', p_search_key,
      'primary_index',  p_index
    )
  )
  WHERE instance_id = p_instance_id;

  -- Admin key is optional — incomplete configs still save. Skip Vault when absent.
  IF p_admin_key IS NULL OR p_admin_key = '' THEN
    RETURN NULL;
  END IF;

  -- Store admin key in Vault: update if exists, create if new
  v_secret_name := 'algolia_admin_key_instance_' || p_instance_id::text;

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

GRANT EXECUTE ON FUNCTION public.algolia_save_credentials(bigint, text, text, text, text, text) TO authenticated;
