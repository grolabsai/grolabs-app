-- 20260519000002_copy_template_data.sql
--
-- copy_template_data(source, target): seed a freshly-created instance with the
-- catalog scaffolding + import intelligence from a template instance. Companion
-- to the existing copyInstanceConfig flow (which handles integrations, locale,
-- and currency). Wired into the create-instance dialog.
--
-- Scope of copy (template data = scaffolding + intelligence, never catalog):
--   - species, species_profile, breed, commercial_tag, product_type
--   - category (tree, including parsing_note + margins)
--   - category_species (bridge)
--   - product_attribute (including parsing_hint), product_attribute_option
--   - category_product_attribute (incl. is_variant_axis), product_type_attribute
--   - pet_profile_attribute, pet_profile_attribute_option,
--     species_pet_profile_attribute, pet_product_matching_rule
--   - All 1:1 *_translation tables for the above entities.
--
-- Explicitly NOT copied: products / variants / pricing / media, brands
-- (customer-specific supplier list), sync state (woocommerce_id columns),
-- audit / operational data, integrations_config (already handled separately).
--
-- ID mapping strategy: every entity table in the set already has a
-- `template_ref_id bigint NULL` column. We populate it on insert with the
-- source row's PK. Translations and bridges then look up the new row by
-- joining on (target instance_id, template_ref_id = old PK). No temp tables,
-- no PL/pgSQL loops — every step is a single INSERT...SELECT or UPDATE.
--
-- Category is the one self-referential table: rows insert with
-- parent_category_id = NULL first, then a follow-up UPDATE remaps parents via
-- the template_ref_id map.
--
-- Authorization:
--   - auth.uid() must be set
--   - caller must be an active instance_member of the TARGET instance
--   - SOURCE must be a template (tenant.kind = 'template_owner'); membership
--     on the source is not required because templates are intended to be
--     broadly seedable
--
-- Safety:
--   - target must currently have zero rows in the entity tables we touch;
--     refuses otherwise (the dialog only invokes this on a fresh instance)
--   - source must differ from target
--
-- Returns: jsonb { ok: true, counts: { <table>: <n>, ... }, total: <n> }
-- Raises on auth/state failure with SQLSTATE 'P0001'.

CREATE OR REPLACE FUNCTION public.copy_template_data(
  p_source_instance_id bigint,
  p_target_instance_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_is_member boolean;
  v_source_is_template boolean;
  v_target_dirty boolean;
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_source_instance_id = p_target_instance_id THEN
    RAISE EXCEPTION 'source_equals_target' USING ERRCODE = 'P0001';
  END IF;

  -- Caller must be an active member of the target instance (they're writing to it).
  SELECT EXISTS (
    SELECT 1 FROM public.instance_member
    WHERE user_id = v_user
      AND instance_id = p_target_instance_id
      AND is_active = true
  ) INTO v_is_member;
  IF NOT v_is_member THEN
    RAISE EXCEPTION 'not_a_member_of_target' USING ERRCODE = 'P0001';
  END IF;

  -- Source must be a template (its tenant has kind = 'template_owner').
  SELECT EXISTS (
    SELECT 1
    FROM public.instance i
    JOIN public.tenant t ON t.tenant_id = i.tenant_id
    WHERE i.instance_id = p_source_instance_id
      AND t.kind = 'template_owner'
  ) INTO v_source_is_template;
  IF NOT v_source_is_template THEN
    RAISE EXCEPTION 'source_not_a_template' USING ERRCODE = 'P0001';
  END IF;

  -- Refuse if the target already has any of the data we'd be inserting. Keeps
  -- this function safe to call exactly once on a freshly-created instance and
  -- prevents accidental double-seeding.
  SELECT
    EXISTS (SELECT 1 FROM public.category                WHERE instance_id = p_target_instance_id) OR
    EXISTS (SELECT 1 FROM public.product_attribute       WHERE instance_id = p_target_instance_id) OR
    EXISTS (SELECT 1 FROM public.product_type            WHERE instance_id = p_target_instance_id) OR
    EXISTS (SELECT 1 FROM public.species                 WHERE instance_id = p_target_instance_id) OR
    EXISTS (SELECT 1 FROM public.commercial_tag          WHERE instance_id = p_target_instance_id) OR
    EXISTS (SELECT 1 FROM public.pet_profile_attribute   WHERE instance_id = p_target_instance_id)
  INTO v_target_dirty;
  IF v_target_dirty THEN
    RAISE EXCEPTION 'target_not_empty' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================================
  -- 1. Entity tables (no FKs into this set, except category self-FK).
  -- For each: INSERT...SELECT, setting template_ref_id = source PK.
  -- ============================================================

  -- species
  INSERT INTO public.species (
    instance_id, template_ref_id, name, plural_name, slug, commercial_group,
    description, icon_key, default_banner_key, menu_order, is_active
  )
  SELECT
    p_target_instance_id, src.species_id, src.name, src.plural_name, src.slug,
    src.commercial_group, src.description, src.icon_key, src.default_banner_key,
    src.menu_order, src.is_active
  FROM public.species src
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('species', v_n);

  -- product_type
  INSERT INTO public.product_type (
    instance_id, template_ref_id, type_code, type_name, kind, description,
    has_variants, track_inventory_default, can_be_composite, consumes_supplies,
    sort_order, is_active
  )
  SELECT
    p_target_instance_id, src.product_type_id, src.type_code, src.type_name,
    src.kind, src.description, src.has_variants, src.track_inventory_default,
    src.can_be_composite, src.consumes_supplies, src.sort_order, src.is_active
  FROM public.product_type src
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_type', v_n);

  -- product_attribute (includes parsing_hint — import intelligence)
  INSERT INTO public.product_attribute (
    instance_id, template_ref_id, attribute_code, attribute_name, description,
    data_type, is_multivalue, is_filterable, is_searchable, used_in_pet_matching,
    suggested_unit, example, is_active, dimension, parsing_hint
  )
  SELECT
    p_target_instance_id, src.attribute_id, src.attribute_code, src.attribute_name,
    src.description, src.data_type, src.is_multivalue, src.is_filterable,
    src.is_searchable, src.used_in_pet_matching, src.suggested_unit, src.example,
    src.is_active, src.dimension, src.parsing_hint
  FROM public.product_attribute src
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_attribute', v_n);

  -- commercial_tag
  INSERT INTO public.commercial_tag (
    instance_id, template_ref_id, tag_code, tag_name, tag_type, is_temporary,
    description, is_active
  )
  SELECT
    p_target_instance_id, src.tag_id, src.tag_code, src.tag_name, src.tag_type,
    src.is_temporary, src.description, src.is_active
  FROM public.commercial_tag src
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('commercial_tag', v_n);

  -- pet_profile_attribute
  INSERT INTO public.pet_profile_attribute (
    instance_id, template_ref_id, attribute_code, attribute_name, description,
    data_type, is_multivalue, visible_to_customer, base_required, used_in_matching,
    suggested_unit, example, is_active
  )
  SELECT
    p_target_instance_id, src.profile_attribute_id, src.attribute_code,
    src.attribute_name, src.description, src.data_type, src.is_multivalue,
    src.visible_to_customer, src.base_required, src.used_in_matching,
    src.suggested_unit, src.example, src.is_active
  FROM public.pet_profile_attribute src
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pet_profile_attribute', v_n);

  -- category — insert with NULL parent first; then remap.
  -- Excludes woocommerce_id (sync state, not template data).
  INSERT INTO public.category (
    instance_id, template_ref_id, parent_category_id, category_code,
    category_name, slug, description, level, sort_order, is_active,
    parsing_note, target_margin, min_margin
  )
  SELECT
    p_target_instance_id, src.category_id, NULL, src.category_code,
    src.category_name, src.slug, src.description, src.level, src.sort_order,
    src.is_active, src.parsing_note, src.target_margin, src.min_margin
  FROM public.category src
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('category', v_n);

  -- Remap parent_category_id by joining via template_ref_id (source PK).
  UPDATE public.category tgt
  SET parent_category_id = parent_tgt.category_id
  FROM public.category src
  JOIN public.category parent_tgt
    ON parent_tgt.instance_id = p_target_instance_id
   AND parent_tgt.template_ref_id = src.parent_category_id
  WHERE tgt.instance_id = p_target_instance_id
    AND tgt.template_ref_id = src.category_id
    AND src.instance_id = p_source_instance_id
    AND src.parent_category_id IS NOT NULL;

  -- ============================================================
  -- 2. Level-1 entity tables (FK into level-0 entities) and bridges.
  -- All look up FK targets via template_ref_id on the parent entity.
  -- ============================================================

  -- species_profile (FK→species)
  INSERT INTO public.species_profile (
    instance_id, species_id, plural_name, species_slug, store_title, store_subtitle,
    default_banner_key, icon_key, suggested_hex_color, uses_size_filter,
    uses_life_stage_filter, uses_habitat_filter, uses_water_type_filter,
    uses_coat_filter, uses_activity_filter, operational_note
  )
  SELECT
    p_target_instance_id, sp_species.species_id, src.plural_name, src.species_slug,
    src.store_title, src.store_subtitle, src.default_banner_key, src.icon_key,
    src.suggested_hex_color, src.uses_size_filter, src.uses_life_stage_filter,
    src.uses_habitat_filter, src.uses_water_type_filter, src.uses_coat_filter,
    src.uses_activity_filter, src.operational_note
  FROM public.species_profile src
  JOIN public.species sp_species
    ON sp_species.instance_id = p_target_instance_id
   AND sp_species.template_ref_id = src.species_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('species_profile', v_n);

  -- breed (FK→species)
  INSERT INTO public.breed (
    instance_id, template_ref_id, species_id, breed_code, breed_name, value_type,
    normalized_name, sort_order, is_active, note
  )
  SELECT
    p_target_instance_id, src.breed_id, sp.species_id, src.breed_code,
    src.breed_name, src.value_type, src.normalized_name, src.sort_order,
    src.is_active, src.note
  FROM public.breed src
  JOIN public.species sp
    ON sp.instance_id = p_target_instance_id
   AND sp.template_ref_id = src.species_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('breed', v_n);

  -- product_attribute_option (FK→product_attribute)
  INSERT INTO public.product_attribute_option (
    instance_id, template_ref_id, attribute_id, value_code, value, sort_order, is_active
  )
  SELECT
    p_target_instance_id, src.value_id, pa.attribute_id, src.value_code,
    src.value, src.sort_order, src.is_active
  FROM public.product_attribute_option src
  JOIN public.product_attribute pa
    ON pa.instance_id = p_target_instance_id
   AND pa.template_ref_id = src.attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_attribute_option', v_n);

  -- category_species (FK→category, species)
  INSERT INTO public.category_species (
    instance_id, template_ref_id, category_id, species_id, active_for_species,
    show_in_species_menu, show_in_header, navigation_title, header_title,
    banner_key, visual_order, note
  )
  SELECT
    p_target_instance_id, src.category_species_id, c.category_id, sp.species_id,
    src.active_for_species, src.show_in_species_menu, src.show_in_header,
    src.navigation_title, src.header_title, src.banner_key, src.visual_order, src.note
  FROM public.category_species src
  JOIN public.category c
    ON c.instance_id = p_target_instance_id
   AND c.template_ref_id = src.category_id
  JOIN public.species sp
    ON sp.instance_id = p_target_instance_id
   AND sp.template_ref_id = src.species_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('category_species', v_n);

  -- category_product_attribute (bridge; includes is_variant_axis)
  INSERT INTO public.category_product_attribute (
    instance_id, category_id, attribute_id, requirement_level, visible_in_filter,
    visible_in_product_page, form_order, note, is_variant_axis, variant_axis_order
  )
  SELECT
    p_target_instance_id, c.category_id, pa.attribute_id, src.requirement_level,
    src.visible_in_filter, src.visible_in_product_page, src.form_order, src.note,
    src.is_variant_axis, src.variant_axis_order
  FROM public.category_product_attribute src
  JOIN public.category c
    ON c.instance_id = p_target_instance_id
   AND c.template_ref_id = src.category_id
  JOIN public.product_attribute pa
    ON pa.instance_id = p_target_instance_id
   AND pa.template_ref_id = src.attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('category_product_attribute', v_n);

  -- product_type_attribute (bridge)
  INSERT INTO public.product_type_attribute (
    instance_id, product_type_id, attribute_id, is_required, visible_in_form,
    form_order, note
  )
  SELECT
    p_target_instance_id, pt.product_type_id, pa.attribute_id, src.is_required,
    src.visible_in_form, src.form_order, src.note
  FROM public.product_type_attribute src
  JOIN public.product_type pt
    ON pt.instance_id = p_target_instance_id
   AND pt.template_ref_id = src.product_type_id
  JOIN public.product_attribute pa
    ON pa.instance_id = p_target_instance_id
   AND pa.template_ref_id = src.attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_type_attribute', v_n);

  -- pet_profile_attribute_option (FK→pet_profile_attribute)
  INSERT INTO public.pet_profile_attribute_option (
    instance_id, template_ref_id, profile_attribute_id, value_code, value,
    sort_order, is_active
  )
  SELECT
    p_target_instance_id, src.value_id, ppa.profile_attribute_id, src.value_code,
    src.value, src.sort_order, src.is_active
  FROM public.pet_profile_attribute_option src
  JOIN public.pet_profile_attribute ppa
    ON ppa.instance_id = p_target_instance_id
   AND ppa.template_ref_id = src.profile_attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pet_profile_attribute_option', v_n);

  -- species_pet_profile_attribute (bridge)
  INSERT INTO public.species_pet_profile_attribute (
    instance_id, species_id, profile_attribute_id, applies, required,
    visible_in_onboarding, visible_in_edit, form_order, note
  )
  SELECT
    p_target_instance_id, sp.species_id, ppa.profile_attribute_id, src.applies,
    src.required, src.visible_in_onboarding, src.visible_in_edit, src.form_order, src.note
  FROM public.species_pet_profile_attribute src
  JOIN public.species sp
    ON sp.instance_id = p_target_instance_id
   AND sp.template_ref_id = src.species_id
  JOIN public.pet_profile_attribute ppa
    ON ppa.instance_id = p_target_instance_id
   AND ppa.template_ref_id = src.profile_attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('species_pet_profile_attribute', v_n);

  -- pet_product_matching_rule (FK→pet_profile_attribute, product_attribute)
  INSERT INTO public.pet_product_matching_rule (
    instance_id, template_ref_id, profile_attribute_id, product_attribute_id,
    match_type, priority, note, is_active
  )
  SELECT
    p_target_instance_id, src.mapping_id, ppa.profile_attribute_id, pa.attribute_id,
    src.match_type, src.priority, src.note, src.is_active
  FROM public.pet_product_matching_rule src
  JOIN public.pet_profile_attribute ppa
    ON ppa.instance_id = p_target_instance_id
   AND ppa.template_ref_id = src.profile_attribute_id
  JOIN public.product_attribute pa
    ON pa.instance_id = p_target_instance_id
   AND pa.template_ref_id = src.product_attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pet_product_matching_rule', v_n);

  -- ============================================================
  -- 3. Translation tables. All have UNIQUE (instance_id, parent_id, locale)
  -- and join to their parent via the parent's template_ref_id.
  -- ============================================================

  INSERT INTO public.species_translation (instance_id, species_id, locale, name, plural_name, description)
  SELECT p_target_instance_id, sp.species_id, src.locale, src.name, src.plural_name, src.description
  FROM public.species_translation src
  JOIN public.species sp ON sp.instance_id = p_target_instance_id AND sp.template_ref_id = src.species_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('species_translation', v_n);

  INSERT INTO public.species_profile_translation (instance_id, species_profile_id, locale, plural_name, store_title, store_subtitle, operational_note)
  SELECT p_target_instance_id, spp.species_profile_id, src.locale, src.plural_name, src.store_title, src.store_subtitle, src.operational_note
  FROM public.species_profile_translation src
  JOIN public.species_profile src_sp ON src_sp.species_profile_id = src.species_profile_id
  JOIN public.species sp ON sp.instance_id = p_target_instance_id AND sp.template_ref_id = src_sp.species_id
  JOIN public.species_profile spp ON spp.instance_id = p_target_instance_id AND spp.species_id = sp.species_id
  WHERE src.instance_id = p_source_instance_id
    AND src_sp.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('species_profile_translation', v_n);

  INSERT INTO public.breed_translation (instance_id, breed_id, locale, breed_name, note)
  SELECT p_target_instance_id, b.breed_id, src.locale, src.breed_name, src.note
  FROM public.breed_translation src
  JOIN public.breed b ON b.instance_id = p_target_instance_id AND b.template_ref_id = src.breed_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('breed_translation', v_n);

  INSERT INTO public.commercial_tag_translation (instance_id, tag_id, locale, tag_name, description)
  SELECT p_target_instance_id, ct.tag_id, src.locale, src.tag_name, src.description
  FROM public.commercial_tag_translation src
  JOIN public.commercial_tag ct ON ct.instance_id = p_target_instance_id AND ct.template_ref_id = src.tag_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('commercial_tag_translation', v_n);

  INSERT INTO public.product_type_translation (instance_id, product_type_id, locale, type_name, description)
  SELECT p_target_instance_id, pt.product_type_id, src.locale, src.type_name, src.description
  FROM public.product_type_translation src
  JOIN public.product_type pt ON pt.instance_id = p_target_instance_id AND pt.template_ref_id = src.product_type_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_type_translation', v_n);

  INSERT INTO public.category_translation (instance_id, category_id, locale, category_name, description)
  SELECT p_target_instance_id, c.category_id, src.locale, src.category_name, src.description
  FROM public.category_translation src
  JOIN public.category c ON c.instance_id = p_target_instance_id AND c.template_ref_id = src.category_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('category_translation', v_n);

  INSERT INTO public.category_species_translation (instance_id, category_species_id, locale, navigation_title, header_title)
  SELECT p_target_instance_id, cs.category_species_id, src.locale, src.navigation_title, src.header_title
  FROM public.category_species_translation src
  JOIN public.category_species cs ON cs.instance_id = p_target_instance_id AND cs.template_ref_id = src.category_species_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('category_species_translation', v_n);

  INSERT INTO public.product_attribute_translation (instance_id, attribute_id, locale, attribute_name, description, example)
  SELECT p_target_instance_id, pa.attribute_id, src.locale, src.attribute_name, src.description, src.example
  FROM public.product_attribute_translation src
  JOIN public.product_attribute pa ON pa.instance_id = p_target_instance_id AND pa.template_ref_id = src.attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_attribute_translation', v_n);

  INSERT INTO public.product_attribute_option_translation (instance_id, value_id, locale, value)
  SELECT p_target_instance_id, pao.value_id, src.locale, src.value
  FROM public.product_attribute_option_translation src
  JOIN public.product_attribute_option pao ON pao.instance_id = p_target_instance_id AND pao.template_ref_id = src.value_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_attribute_option_translation', v_n);

  INSERT INTO public.pet_profile_attribute_translation (instance_id, profile_attribute_id, locale, attribute_name, description, example)
  SELECT p_target_instance_id, ppa.profile_attribute_id, src.locale, src.attribute_name, src.description, src.example
  FROM public.pet_profile_attribute_translation src
  JOIN public.pet_profile_attribute ppa ON ppa.instance_id = p_target_instance_id AND ppa.template_ref_id = src.profile_attribute_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pet_profile_attribute_translation', v_n);

  INSERT INTO public.pet_profile_attribute_option_translation (instance_id, value_id, locale, value)
  SELECT p_target_instance_id, ppao.value_id, src.locale, src.value
  FROM public.pet_profile_attribute_option_translation src
  JOIN public.pet_profile_attribute_option ppao ON ppao.instance_id = p_target_instance_id AND ppao.template_ref_id = src.value_id
  WHERE src.instance_id = p_source_instance_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pet_profile_attribute_option_translation', v_n);

  RETURN jsonb_build_object(
    'ok', true,
    'counts', v_counts,
    'total', (SELECT COALESCE(SUM(value::bigint), 0) FROM jsonb_each_text(v_counts))
  );
END;
$$;

COMMENT ON FUNCTION public.copy_template_data(bigint, bigint) IS
  'Seeds a freshly-created instance with the catalog scaffolding + import intelligence (species, categories, attributes, options, bridges, translations, pet-profile config) from a template instance. SECURITY DEFINER. Caller must be an active instance_member of the target; source must be owned by a tenant with kind = ''template_owner''; target must be empty across the seeded tables. Returns jsonb { ok, counts, total }. Per docs/policy/instance-management.md.';

GRANT EXECUTE ON FUNCTION public.copy_template_data(bigint, bigint) TO authenticated;
