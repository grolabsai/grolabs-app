-- ============================================================================
-- Funnel Flow Map — seed
-- ----------------------------------------------------------------------------
-- Seeds the canonical e-commerce funnel flow + 17 stages + 43 transitions +
-- 5 friction points + 3 industry templates (jewelry, clothing, electronics)
-- under instance_id = 0 (template instance) + their datasets and transition
-- values + 4 sample friction findings.
--
-- Idempotent for entries with natural slug keys (flow, stage, transition,
-- friction_point, instance, dataset, finding). Re-running this migration
-- via apply_migration is safe.
--
-- IMPORTANT: applying this migration assumes `instance` row with
-- instance_id = 0 already exists. Verify before applying:
--   SELECT instance_id, name FROM instance WHERE instance_id = 0;
-- ============================================================================

-- ─── Flow ───────────────────────────────────────────────────────────────────

insert into funnel_flow (slug, name, description)
values (
  'flow_ecommerce_standard',
  'Embudo estándar de e-commerce',
  'Embudo reutilizable con adquisición, descubrimiento, PLP, PDP, carrito, pago, compra y abandono.'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

-- ─── Stages ─────────────────────────────────────────────────────────────────
-- Spanish-first labels per conventions doc. icon_key = lucide PascalCase.

insert into funnel_stage (
  funnel_flow_id, slug, label, stage_order, color,
  position_x, position_y, icon_key, is_terminal, is_dropoff
)
select
  (select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_standard'),
  v.slug, v.label, v.stage_order, v.color,
  v.position_x, v.position_y, v.icon_key, v.is_terminal, v.is_dropoff
from (values
  ('traffic',    'Tráfico',                     0,  '#2563eb',    0, 330, 'Users',           false, false),
  ('organic',    'Búsqueda orgánica',           1,  '#f97316',  290,   0, 'Search',          false, false),
  ('social',     'Redes sociales',              2,  '#22c55e',  290, 118, 'Share2',          false, false),
  ('paid',       'Búsqueda pagada',             3,  '#ef4444',  290, 236, 'DollarSign',      false, false),
  ('direct',     'Directo',                     4,  '#8b5cf6',  290, 354, 'Globe',           false, false),
  ('email',      'Correo',                      5,  '#92400e',  290, 472, 'Mail',            false, false),
  ('aeo',        'AEO (IA)',                    6,  '#ec4899',  290, 590, 'Sparkles',        false, false),
  ('home',       'Inicio',                      7,  '#64748b',  600, 170, 'Home',            false, false),
  ('cat',        'Navegación por categoría',    8,  '#84cc16',  900,  60, 'LayoutGrid',      false, false),
  ('search',     'Búsqueda en sitio',           9,  '#06b6d4',  900, 245, 'Search',          false, false),
  ('plp_cat',    'PLP por categoría',          10,  '#fb923c', 1210, 140, 'List',            false, false),
  ('plp_search', 'PLP por búsqueda',           11,  '#f59e0b', 1210, 320, 'ListFilter',      false, false),
  ('pdp',        'Página de producto',         12,  '#86efac', 1510, 215, 'Package',         false, false),
  ('cart',       'Carrito',                    13,  '#fca5a5', 1810, 235, 'ShoppingCart',    false, false),
  ('checkout',   'Pago',                       14,  '#c4b5fd', 2110, 255, 'CreditCard',      false, false),
  ('purchase',   'Compra',                     15,  '#16a34a', 2410, 275, 'CheckCircle2',    true,  false),
  ('drop',       'Abandono',                   16,  '#dc2626', 2410, 735, 'ArrowDownToLine', true,  true)
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

-- ─── Transitions ────────────────────────────────────────────────────────────

with flow as (
  select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_standard'
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
  ('traffic',    'organic',    'traffic__organic',    'forward'),
  ('traffic',    'social',     'traffic__social',     'forward'),
  ('traffic',    'paid',       'traffic__paid',       'forward'),
  ('traffic',    'direct',     'traffic__direct',     'forward'),
  ('traffic',    'email',      'traffic__email',      'forward'),
  ('traffic',    'aeo',        'traffic__aeo',        'forward'),
  ('organic',    'home',       'organic__home',       'forward'),
  ('organic',    'pdp',        'organic__pdp',        'forward'),
  ('organic',    'drop',       'organic__drop',       'dropoff'),
  ('paid',       'home',       'paid__home',          'forward'),
  ('paid',       'pdp',        'paid__pdp',           'forward'),
  ('paid',       'drop',       'paid__drop',          'dropoff'),
  ('social',     'home',       'social__home',        'forward'),
  ('social',     'pdp',        'social__pdp',         'forward'),
  ('social',     'drop',       'social__drop',        'dropoff'),
  ('direct',     'home',       'direct__home',        'forward'),
  ('direct',     'pdp',        'direct__pdp',         'forward'),
  ('direct',     'drop',       'direct__drop',        'dropoff'),
  ('email',      'pdp',        'email__pdp',          'forward'),
  ('email',      'home',       'email__home',         'forward'),
  ('email',      'drop',       'email__drop',         'dropoff'),
  ('aeo',        'home',       'aeo__home',           'forward'),
  ('aeo',        'drop',       'aeo__drop',           'dropoff'),
  ('home',       'cat',        'home__cat',           'forward'),
  ('home',       'search',     'home__search',        'forward'),
  ('home',       'drop',       'home__drop',          'dropoff'),
  ('cat',        'plp_cat',    'cat__plp_cat',        'forward'),
  ('cat',        'drop',       'cat__drop',           'dropoff'),
  ('search',     'plp_search', 'search__plp_search',  'forward'),
  ('search',     'pdp',        'search__pdp',         'forward'),
  ('search',     'drop',       'search__drop',        'dropoff'),
  ('plp_cat',    'pdp',        'plp_cat__pdp',        'forward'),
  ('plp_cat',    'cart',       'plp_cat__cart',       'forward'),
  ('plp_cat',    'drop',       'plp_cat__drop',       'dropoff'),
  ('plp_search', 'pdp',        'plp_search__pdp',     'forward'),
  ('plp_search', 'cart',       'plp_search__cart',    'forward'),
  ('plp_search', 'search',     'plp_search__search',  'backward'),
  ('plp_search', 'drop',       'plp_search__drop',    'dropoff'),
  ('pdp',        'cart',       'pdp__cart',           'forward'),
  ('pdp',        'drop',       'pdp__drop',           'dropoff'),
  ('cart',       'checkout',   'cart__checkout',      'forward'),
  ('cart',       'drop',       'cart__drop',          'dropoff'),
  ('checkout',   'purchase',   'checkout__purchase',  'forward'),
  ('checkout',   'drop',       'checkout__drop',      'dropoff')
) as v (source_slug, target_slug, slug, transition_type)
join stages_lookup src on src.slug = v.source_slug
join stages_lookup tgt on tgt.slug = v.target_slug
on conflict (funnel_flow_id, slug) do update set
  source_stage_id = excluded.source_stage_id,
  target_stage_id = excluded.target_stage_id,
  transition_type = excluded.transition_type,
  updated_at = now();

-- ─── Friction points ────────────────────────────────────────────────────────

with stages_lookup as (
  select s.funnel_stage_id, s.slug
  from funnel_stage s
  where s.funnel_flow_id = (
    select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_standard'
  )
)
insert into funnel_friction_point (funnel_stage_id, slug, name, description, category)
select
  s.funnel_stage_id,
  v.slug,
  v.name,
  v.description,
  v.category
from (values
  ('search',   'fp_search_no_results', 'Búsqueda sin resultados',
   'Una consulta retorna cero productos o sin clics útiles.', 'search'),
  ('search',   'fp_search_synonyms',   'Manejo débil de sinónimos',
   'Los términos del catálogo no coinciden con el lenguaje del comprador.', 'search'),
  ('checkout', 'fp_forced_account',    'Creación de cuenta forzada',
   'El usuario debe crear una cuenta antes de completar el pago.', 'checkout'),
  ('cart',     'fp_unexpected_costs',  'Costos inesperados',
   'Costos de envío, impuestos o cargos aparecen tarde.', 'cart'),
  ('pdp',      'fp_variant_friction',  'Fricción al elegir variante',
   'La selección de talla, color o modelo crea incertidumbre.', 'pdp')
) as v (stage_slug, slug, name, description, category)
join stages_lookup s on s.slug = v.stage_slug
on conflict (slug) do update set
  funnel_stage_id = excluded.funnel_stage_id,
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  updated_at = now();

-- ─── Template instances (instance_id = 0) ───────────────────────────────────

insert into funnel_instance (
  instance_id, funnel_flow_id, slug, name, funnel_instance_type,
  industry, monthly_traffic, average_order_value, average_cart_skus
)
select
  0,
  (select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_standard'),
  v.slug, v.name, v.funnel_instance_type::funnel_instance_type,
  v.industry, v.monthly_traffic, v.average_order_value, v.average_cart_skus
from (values
  ('template_jewelry',     'Plantilla benchmark — Joyería',     'template', 'Joyería',     10000, 180,   1.6),
  ('template_clothing',    'Plantilla benchmark — Ropa',        'template', 'Ropa',        10000, 100,   2.3),
  ('template_electronics', 'Plantilla benchmark — Electrónica', 'template', 'Electrónica', 10000, 250,   1.4)
) as v (slug, name, funnel_instance_type, industry, monthly_traffic, average_order_value, average_cart_skus)
on conflict (instance_id, slug) do update set
  name = excluded.name,
  funnel_instance_type = excluded.funnel_instance_type,
  industry = excluded.industry,
  monthly_traffic = excluded.monthly_traffic,
  average_order_value = excluded.average_order_value,
  average_cart_skus = excluded.average_cart_skus,
  updated_at = now();

-- ─── Datasets (one active per template instance) ───────────────────────────

insert into funnel_dataset (
  funnel_instance_id, funnel_flow_id, slug, name, description, is_active
)
select
  fi.funnel_instance_id,
  fi.funnel_flow_id,
  v.dataset_slug,
  v.dataset_name,
  v.description,
  true
from (values
  ('template_jewelry',     'dataset_jewelry_benchmark_v1',
   'Dataset benchmark — Joyería',     'Valores de conversión benchmark para joyería.'),
  ('template_clothing',    'dataset_clothing_benchmark_v1',
   'Dataset benchmark — Ropa',        'Valores de conversión benchmark para ropa.'),
  ('template_electronics', 'dataset_electronics_benchmark_v1',
   'Dataset benchmark — Electrónica', 'Valores de conversión benchmark para electrónica.')
) as v (instance_slug, dataset_slug, dataset_name, description)
join funnel_instance fi
  on fi.slug = v.instance_slug and fi.instance_id = 0
on conflict (funnel_instance_id, slug) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = now();

-- ─── Dataset transition values ─────────────────────────────────────────────
-- 43 transitions × 3 datasets = 129 rows. Values from prototype.

with
flow as (
  select funnel_flow_id from funnel_flow where slug = 'flow_ecommerce_standard'
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
  -- Jewelry
  ('dataset_jewelry_benchmark_v1', 'traffic__organic',    30),
  ('dataset_jewelry_benchmark_v1', 'traffic__social',     25),
  ('dataset_jewelry_benchmark_v1', 'traffic__paid',       25),
  ('dataset_jewelry_benchmark_v1', 'traffic__direct',     10),
  ('dataset_jewelry_benchmark_v1', 'traffic__email',       7),
  ('dataset_jewelry_benchmark_v1', 'traffic__aeo',         3),
  ('dataset_jewelry_benchmark_v1', 'organic__home',       65),
  ('dataset_jewelry_benchmark_v1', 'organic__pdp',        25),
  ('dataset_jewelry_benchmark_v1', 'organic__drop',       10),
  ('dataset_jewelry_benchmark_v1', 'paid__home',          50),
  ('dataset_jewelry_benchmark_v1', 'paid__pdp',           30),
  ('dataset_jewelry_benchmark_v1', 'paid__drop',          20),
  ('dataset_jewelry_benchmark_v1', 'social__home',        58),
  ('dataset_jewelry_benchmark_v1', 'social__pdp',         12),
  ('dataset_jewelry_benchmark_v1', 'social__drop',        30),
  ('dataset_jewelry_benchmark_v1', 'direct__home',        65),
  ('dataset_jewelry_benchmark_v1', 'direct__pdp',         15),
  ('dataset_jewelry_benchmark_v1', 'direct__drop',        20),
  ('dataset_jewelry_benchmark_v1', 'email__pdp',          55),
  ('dataset_jewelry_benchmark_v1', 'email__home',         25),
  ('dataset_jewelry_benchmark_v1', 'email__drop',         20),
  ('dataset_jewelry_benchmark_v1', 'aeo__home',           70),
  ('dataset_jewelry_benchmark_v1', 'aeo__drop',           30),
  ('dataset_jewelry_benchmark_v1', 'home__cat',           50),
  ('dataset_jewelry_benchmark_v1', 'home__search',        30),
  ('dataset_jewelry_benchmark_v1', 'home__drop',          20),
  ('dataset_jewelry_benchmark_v1', 'cat__plp_cat',        70),
  ('dataset_jewelry_benchmark_v1', 'cat__drop',           30),
  ('dataset_jewelry_benchmark_v1', 'search__plp_search',  22),
  ('dataset_jewelry_benchmark_v1', 'search__pdp',         12),
  ('dataset_jewelry_benchmark_v1', 'search__drop',        66),
  ('dataset_jewelry_benchmark_v1', 'plp_cat__pdp',        58),
  ('dataset_jewelry_benchmark_v1', 'plp_cat__cart',       12),
  ('dataset_jewelry_benchmark_v1', 'plp_cat__drop',       30),
  ('dataset_jewelry_benchmark_v1', 'plp_search__pdp',     52),
  ('dataset_jewelry_benchmark_v1', 'plp_search__cart',     8),
  ('dataset_jewelry_benchmark_v1', 'plp_search__search',  10),
  ('dataset_jewelry_benchmark_v1', 'plp_search__drop',    30),
  ('dataset_jewelry_benchmark_v1', 'pdp__cart',           28),
  ('dataset_jewelry_benchmark_v1', 'pdp__drop',           72),
  ('dataset_jewelry_benchmark_v1', 'cart__checkout',      50),
  ('dataset_jewelry_benchmark_v1', 'cart__drop',          50),
  ('dataset_jewelry_benchmark_v1', 'checkout__purchase',  60),
  ('dataset_jewelry_benchmark_v1', 'checkout__drop',      40),
  -- Clothing
  ('dataset_clothing_benchmark_v1', 'traffic__organic',    35),
  ('dataset_clothing_benchmark_v1', 'traffic__social',     25),
  ('dataset_clothing_benchmark_v1', 'traffic__paid',       20),
  ('dataset_clothing_benchmark_v1', 'traffic__direct',     10),
  ('dataset_clothing_benchmark_v1', 'traffic__email',       7),
  ('dataset_clothing_benchmark_v1', 'traffic__aeo',         3),
  ('dataset_clothing_benchmark_v1', 'organic__home',       70),
  ('dataset_clothing_benchmark_v1', 'organic__pdp',        20),
  ('dataset_clothing_benchmark_v1', 'organic__drop',       10),
  ('dataset_clothing_benchmark_v1', 'paid__home',          60),
  ('dataset_clothing_benchmark_v1', 'paid__pdp',           20),
  ('dataset_clothing_benchmark_v1', 'paid__drop',          20),
  ('dataset_clothing_benchmark_v1', 'social__home',        60),
  ('dataset_clothing_benchmark_v1', 'social__pdp',         10),
  ('dataset_clothing_benchmark_v1', 'social__drop',        30),
  ('dataset_clothing_benchmark_v1', 'direct__home',        70),
  ('dataset_clothing_benchmark_v1', 'direct__pdp',         10),
  ('dataset_clothing_benchmark_v1', 'direct__drop',        20),
  ('dataset_clothing_benchmark_v1', 'email__pdp',          50),
  ('dataset_clothing_benchmark_v1', 'email__home',         30),
  ('dataset_clothing_benchmark_v1', 'email__drop',         20),
  ('dataset_clothing_benchmark_v1', 'aeo__home',           70),
  ('dataset_clothing_benchmark_v1', 'aeo__drop',           30),
  ('dataset_clothing_benchmark_v1', 'home__cat',           55),
  ('dataset_clothing_benchmark_v1', 'home__search',        25),
  ('dataset_clothing_benchmark_v1', 'home__drop',          20),
  ('dataset_clothing_benchmark_v1', 'cat__plp_cat',        75),
  ('dataset_clothing_benchmark_v1', 'cat__drop',           25),
  ('dataset_clothing_benchmark_v1', 'search__plp_search',  20),
  ('dataset_clothing_benchmark_v1', 'search__pdp',         10),
  ('dataset_clothing_benchmark_v1', 'search__drop',        70),
  ('dataset_clothing_benchmark_v1', 'plp_cat__pdp',        65),
  ('dataset_clothing_benchmark_v1', 'plp_cat__cart',       17),
  ('dataset_clothing_benchmark_v1', 'plp_cat__drop',       18),
  ('dataset_clothing_benchmark_v1', 'plp_search__pdp',     58),
  ('dataset_clothing_benchmark_v1', 'plp_search__cart',    10),
  ('dataset_clothing_benchmark_v1', 'plp_search__search',   7),
  ('dataset_clothing_benchmark_v1', 'plp_search__drop',    25),
  ('dataset_clothing_benchmark_v1', 'pdp__cart',           40),
  ('dataset_clothing_benchmark_v1', 'pdp__drop',           60),
  ('dataset_clothing_benchmark_v1', 'cart__checkout',      55),
  ('dataset_clothing_benchmark_v1', 'cart__drop',          45),
  ('dataset_clothing_benchmark_v1', 'checkout__purchase',  65),
  ('dataset_clothing_benchmark_v1', 'checkout__drop',      35),
  -- Electronics
  ('dataset_electronics_benchmark_v1', 'traffic__organic',    32),
  ('dataset_electronics_benchmark_v1', 'traffic__social',     15),
  ('dataset_electronics_benchmark_v1', 'traffic__paid',       30),
  ('dataset_electronics_benchmark_v1', 'traffic__direct',     13),
  ('dataset_electronics_benchmark_v1', 'traffic__email',       7),
  ('dataset_electronics_benchmark_v1', 'traffic__aeo',         3),
  ('dataset_electronics_benchmark_v1', 'organic__home',       55),
  ('dataset_electronics_benchmark_v1', 'organic__pdp',        35),
  ('dataset_electronics_benchmark_v1', 'organic__drop',       10),
  ('dataset_electronics_benchmark_v1', 'paid__home',          45),
  ('dataset_electronics_benchmark_v1', 'paid__pdp',           40),
  ('dataset_electronics_benchmark_v1', 'paid__drop',          15),
  ('dataset_electronics_benchmark_v1', 'social__home',        55),
  ('dataset_electronics_benchmark_v1', 'social__pdp',         15),
  ('dataset_electronics_benchmark_v1', 'social__drop',        30),
  ('dataset_electronics_benchmark_v1', 'direct__home',        55),
  ('dataset_electronics_benchmark_v1', 'direct__pdp',         25),
  ('dataset_electronics_benchmark_v1', 'direct__drop',        20),
  ('dataset_electronics_benchmark_v1', 'email__pdp',          60),
  ('dataset_electronics_benchmark_v1', 'email__home',         20),
  ('dataset_electronics_benchmark_v1', 'email__drop',         20),
  ('dataset_electronics_benchmark_v1', 'aeo__home',           60),
  ('dataset_electronics_benchmark_v1', 'aeo__drop',           40),
  ('dataset_electronics_benchmark_v1', 'home__cat',           45),
  ('dataset_electronics_benchmark_v1', 'home__search',        35),
  ('dataset_electronics_benchmark_v1', 'home__drop',          20),
  ('dataset_electronics_benchmark_v1', 'cat__plp_cat',        72),
  ('dataset_electronics_benchmark_v1', 'cat__drop',           28),
  ('dataset_electronics_benchmark_v1', 'search__plp_search',  28),
  ('dataset_electronics_benchmark_v1', 'search__pdp',         22),
  ('dataset_electronics_benchmark_v1', 'search__drop',        50),
  ('dataset_electronics_benchmark_v1', 'plp_cat__pdp',        70),
  ('dataset_electronics_benchmark_v1', 'plp_cat__cart',       12),
  ('dataset_electronics_benchmark_v1', 'plp_cat__drop',       18),
  ('dataset_electronics_benchmark_v1', 'plp_search__pdp',     60),
  ('dataset_electronics_benchmark_v1', 'plp_search__cart',     6),
  ('dataset_electronics_benchmark_v1', 'plp_search__search',  10),
  ('dataset_electronics_benchmark_v1', 'plp_search__drop',    24),
  ('dataset_electronics_benchmark_v1', 'pdp__cart',           32),
  ('dataset_electronics_benchmark_v1', 'pdp__drop',           68),
  ('dataset_electronics_benchmark_v1', 'cart__checkout',      60),
  ('dataset_electronics_benchmark_v1', 'cart__drop',          40),
  ('dataset_electronics_benchmark_v1', 'checkout__purchase',  70),
  ('dataset_electronics_benchmark_v1', 'checkout__drop',      30)
) as v (dataset_slug, transition_slug, conversion_pct)
join datasets_lookup d on d.slug = v.dataset_slug
join transitions_lookup t on t.slug = v.transition_slug
on conflict (funnel_dataset_id, funnel_transition_id) do update set
  conversion_pct = excluded.conversion_pct,
  source_type = excluded.source_type,
  updated_at = now();

-- ─── Sample friction findings ──────────────────────────────────────────────

with
templates as (
  select fi.funnel_instance_id, fi.slug
  from funnel_instance fi
  where fi.instance_id = 0
),
fp as (
  select funnel_friction_point_id, slug from funnel_friction_point
)
insert into funnel_friction_finding (
  funnel_instance_id, funnel_friction_point_id, slug,
  severity, evidence, source_system, observed_at
)
select
  t.funnel_instance_id,
  fp.funnel_friction_point_id,
  v.slug,
  v.severity::funnel_severity,
  v.evidence,
  v.source_system,
  v.observed_at::date
from (values
  ('template_clothing',    'fp_search_no_results', 'ff_001',
   'high',
   'La extracción de Algolia detectó que la consulta "cuckoo" no retornó resultados.',
   'Algolia API', '2026-04-29'),
  ('template_clothing',    'fp_search_synonyms',   'ff_002',
   'high',
   'Usuarios buscando "sneakers" no llegan consistentemente a productos "tennis shoes".',
   'Algolia API', '2026-04-29'),
  ('template_electronics', 'fp_forced_account',    'ff_003',
   'medium',
   'Las grabaciones de checkout muestran abandono cuando se requiere crear cuenta.',
   'Session Recording', '2026-04-29'),
  ('template_jewelry',     'fp_variant_friction',  'ff_004',
   'medium',
   'Usuarios en PDP dudan al elegir talla de anillo y tipo de metal antes del carrito.',
   'GA4 + UX Review', '2026-04-29')
) as v (instance_slug, friction_point_slug, slug, severity, evidence, source_system, observed_at)
join templates t on t.slug = v.instance_slug
join fp on fp.slug = v.friction_point_slug
on conflict (funnel_instance_id, slug) do update set
  funnel_friction_point_id = excluded.funnel_friction_point_id,
  severity = excluded.severity,
  evidence = excluded.evidence,
  source_system = excluded.source_system,
  observed_at = excluded.observed_at;
