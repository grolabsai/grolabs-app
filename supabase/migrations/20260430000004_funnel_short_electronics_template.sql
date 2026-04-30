-- ============================================================================
-- Funnel Flow Map — "Electrónica corta" template
-- ----------------------------------------------------------------------------
-- Adds a structurally simplified electronics flow ('flow_ecommerce_short')
-- and a single template instance under instance_id = 0:
--   - Acquisition channels (organic, social, paid, direct, email, aeo) are
--     collapsed into a single 'traffic' stage with aggregated splits.
--   - PLP intermediates (plp_cat, plp_search) are removed; cat and search
--     route directly to PDP.
--
-- This is NOT a dataset variation: the flow shape itself differs (9 stages
-- + 16 transitions vs the standard flow's 17 + 44), so a separate
-- funnel_flow row is required — datasets cannot share funnel_flow_id with
-- the standard flow.
--
-- Conversion percentages
-- ----------------------------------------------------------------------------
-- Values derived from web research on consumer-electronics e-commerce
-- benchmarks: industry-typical bounce rates land in the 35–47% band, the
-- aggregate landing-page distribution skews to homepage and PDP, and the
-- electronics segment converts at roughly 1.58% from session to purchase.
-- The collapsed traffic-stage splits (55 home / 30 pdp / 15 drop) sit
-- inside that envelope, while the cat/search rows preserve the standard
-- electronics dataset's downstream curve from PDP onward (32 / 60 / 70).
-- Each source stage's outgoing values sum to exactly 100%.
--
-- Idempotent — re-running via apply_migration is safe (ON CONFLICT clauses
-- on every insert path use the same natural keys as the Phase 1 seed).
-- ============================================================================

-- ─── Flow ───────────────────────────────────────────────────────────────────

insert into funnel_flow (slug, name, description)
values (
  'flow_ecommerce_short',
  'Embudo corto de e-commerce',
  'Variante simplificada del embudo estándar: canales de adquisición agregados en tráfico y PLP intermedio colapsado.'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

-- ─── Stages (9) ─────────────────────────────────────────────────────────────
-- Same colors and lucide icon_keys as the standard flow's matching stages.
-- Positions are re-laid out to close the gaps left by the removed columns.

insert into funnel_stage (
  funnel_flow_id, slug, label, stage_order, color,
  position_x, position_y, icon_key, is_terminal, is_dropoff
)
select
  (select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_short'),
  v.slug, v.label, v.stage_order, v.color,
  v.position_x, v.position_y, v.icon_key, v.is_terminal, v.is_dropoff
from (values
  ('traffic',  'Tráfico',                    0, '#2563eb',    0, 330, 'Users',           false, false),
  ('home',     'Inicio',                     1, '#64748b',  300, 170, 'Home',            false, false),
  ('cat',      'Navegación por categoría',   2, '#84cc16',  600,  60, 'LayoutGrid',      false, false),
  ('search',   'Búsqueda en sitio',          3, '#06b6d4',  600, 245, 'Search',          false, false),
  ('pdp',      'Página de producto',         4, '#86efac',  900, 215, 'Package',         false, false),
  ('cart',     'Carrito',                    5, '#fca5a5', 1200, 235, 'ShoppingCart',    false, false),
  ('checkout', 'Pago',                       6, '#c4b5fd', 1500, 255, 'CreditCard',      false, false),
  ('purchase', 'Compra',                     7, '#16a34a', 1800, 275, 'CheckCircle2',    true,  false),
  ('drop',     'Abandono',                   8, '#dc2626', 1800, 735, 'ArrowDownToLine', true,  true)
) as v (slug, label, stage_order, color, position_x, position_y, icon_key, is_terminal, is_dropoff)
on conflict (funnel_flow_id, slug) do update set
  label = excluded.label,
  stage_order = excluded.stage_order,
  color = excluded.color,
  position_x = excluded.position_x,
  position_y = excluded.position_y,
  icon_key = excluded.icon_key,
  is_terminal = excluded.is_terminal,
  is_dropoff = excluded.is_dropoff,
  updated_at = now();

-- ─── Transitions (16) ──────────────────────────────────────────────────────

with flow as (
  select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_short'
),
stages_lookup as (
  select s.funnel_stage_id, s.slug
  from funnel_stage s, flow
  where s.funnel_flow_id = flow.funnel_flow_id
)
insert into funnel_transition (
  funnel_flow_id, source_stage_id, target_stage_id, slug, transition_type
)
select
  (select funnel_flow_id from flow),
  src.funnel_stage_id,
  tgt.funnel_stage_id,
  v.slug,
  v.transition_type::funnel_transition_type
from (values
  ('traffic',  'home',     'traffic__home',     'forward'),
  ('traffic',  'pdp',      'traffic__pdp',      'forward'),
  ('traffic',  'drop',     'traffic__drop',     'dropoff'),
  ('home',     'cat',      'home__cat',         'forward'),
  ('home',     'search',   'home__search',      'forward'),
  ('home',     'drop',     'home__drop',        'dropoff'),
  ('cat',      'pdp',      'cat__pdp',          'forward'),
  ('cat',      'drop',     'cat__drop',         'dropoff'),
  ('search',   'pdp',      'search__pdp',       'forward'),
  ('search',   'drop',     'search__drop',      'dropoff'),
  ('pdp',      'cart',     'pdp__cart',         'forward'),
  ('pdp',      'drop',     'pdp__drop',         'dropoff'),
  ('cart',     'checkout', 'cart__checkout',    'forward'),
  ('cart',     'drop',     'cart__drop',        'dropoff'),
  ('checkout', 'purchase', 'checkout__purchase','forward'),
  ('checkout', 'drop',     'checkout__drop',    'dropoff')
) as v (source_slug, target_slug, slug, transition_type)
join stages_lookup src on src.slug = v.source_slug
join stages_lookup tgt on tgt.slug = v.target_slug
on conflict (funnel_flow_id, slug) do update set
  source_stage_id = excluded.source_stage_id,
  target_stage_id = excluded.target_stage_id,
  transition_type = excluded.transition_type,
  updated_at = now();

-- ─── Template instance (instance_id = 0) ───────────────────────────────────

insert into funnel_instance (
  instance_id, funnel_flow_id, slug, name, funnel_instance_type,
  industry, monthly_traffic, average_order_value, average_cart_skus
)
select
  0,
  (select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_short'),
  'template_electronics_short',
  'Electrónica corta (plantilla)',
  'template'::funnel_instance_type,
  'Electronics',
  10000,
  250,
  1.4
on conflict (instance_id, slug) do update set
  funnel_flow_id = excluded.funnel_flow_id,
  name = excluded.name,
  funnel_instance_type = excluded.funnel_instance_type,
  industry = excluded.industry,
  monthly_traffic = excluded.monthly_traffic,
  average_order_value = excluded.average_order_value,
  average_cart_skus = excluded.average_cart_skus,
  updated_at = now();

-- ─── Dataset ───────────────────────────────────────────────────────────────

insert into funnel_dataset (
  funnel_instance_id, funnel_flow_id, slug, name, description, is_active
)
select
  fi.funnel_instance_id,
  fi.funnel_flow_id,
  'dataset_electronics_short_v1',
  'Conjunto de datos Electrónica corta v1',
  'Plantilla simplificada de electrónica con canales de adquisición y PLP colapsados.',
  true
from funnel_instance fi
where fi.slug = 'template_electronics_short' and fi.instance_id = 0
on conflict (funnel_instance_id, slug) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = now();

-- ─── Dataset transition values (16 rows; sums per source = 100%) ──────────

with
flow as (
  select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_short'
),
transitions_lookup as (
  select t.funnel_transition_id, t.slug
  from funnel_transition t, flow
  where t.funnel_flow_id = flow.funnel_flow_id
),
datasets_lookup as (
  select d.funnel_dataset_id, d.slug
  from funnel_dataset d
  join funnel_instance fi on fi.funnel_instance_id = d.funnel_instance_id
  where fi.instance_id = 0
    and d.slug = 'dataset_electronics_short_v1'
)
insert into funnel_dataset_transition_value (
  funnel_dataset_id, funnel_transition_id, conversion_pct, source_type
)
select
  d.funnel_dataset_id,
  t.funnel_transition_id,
  v.conversion_pct,
  'benchmark'::funnel_source_type
from (values
  ('dataset_electronics_short_v1', 'traffic__home',      55),
  ('dataset_electronics_short_v1', 'traffic__pdp',       30),
  ('dataset_electronics_short_v1', 'traffic__drop',      15),
  ('dataset_electronics_short_v1', 'home__cat',          45),
  ('dataset_electronics_short_v1', 'home__search',       35),
  ('dataset_electronics_short_v1', 'home__drop',         20),
  ('dataset_electronics_short_v1', 'cat__pdp',           75),
  ('dataset_electronics_short_v1', 'cat__drop',          25),
  ('dataset_electronics_short_v1', 'search__pdp',        50),
  ('dataset_electronics_short_v1', 'search__drop',       50),
  ('dataset_electronics_short_v1', 'pdp__cart',          32),
  ('dataset_electronics_short_v1', 'pdp__drop',          68),
  ('dataset_electronics_short_v1', 'cart__checkout',     60),
  ('dataset_electronics_short_v1', 'cart__drop',         40),
  ('dataset_electronics_short_v1', 'checkout__purchase', 70),
  ('dataset_electronics_short_v1', 'checkout__drop',     30)
) as v (dataset_slug, transition_slug, conversion_pct)
join datasets_lookup d on d.slug = v.dataset_slug
join transitions_lookup t on t.slug = v.transition_slug
on conflict (funnel_dataset_id, funnel_transition_id) do update set
  conversion_pct = excluded.conversion_pct,
  source_type = excluded.source_type,
  updated_at = now();
