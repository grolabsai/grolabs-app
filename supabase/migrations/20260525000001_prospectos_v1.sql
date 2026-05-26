-- Prospectos module v1 — diagnostic catalog + run storage.
--
-- Two layers:
--   1. Catalog (rarely changes, seeded then edited via Studio/UI):
--      diagnostic_stage, vertical, diagnostic_check, fix_recommendation,
--      vertical_benchmark. Use the prompt_template pattern: per-instance
--      with instance 0 fallthrough on SELECT, member-only writes.
--   2. Run layer (written every diagnostic): prospect, diagnostic_run,
--      run_sample, finding, finding_fix. instance_id required for Scout
--      users; NULL allowed for anonymous landing-page runs (share by
--      uuid run_id token).
--
-- Naming note: this module's stage taxonomy is `diagnostic_stage`, not
-- `funnel_stage` — the latter already exists for the conversion module.
-- Conceptually adjacent but a different list (Discovery / On-site nav /
-- PDP / Returns vs. the conversion funnel's per-flow stages).

-- ============================================================
-- Catalog layer
-- ============================================================

create table public.diagnostic_stage (
  diagnostic_stage_id bigserial primary key,
  stage_code text not null unique,
  stage_name text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.vertical (
  vertical_id bigserial primary key,
  vertical_code text not null unique,
  vertical_name text not null,
  description text,
  created_at timestamptz not null default now()
);

create type public.diagnostic_probe_type as enum (
  'search', 'pdp', 'site_wide', 'homepage', 'category'
);

create type public.confidence_level as enum ('low', 'medium', 'high');

create type public.effort_level as enum ('low', 'medium', 'high');

create type public.impact_level as enum ('low', 'medium', 'high');

create table public.diagnostic_check (
  diagnostic_check_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  check_code text not null,
  check_name text not null,
  description text,
  diagnostic_stage_id bigint not null references public.diagnostic_stage(diagnostic_stage_id) on delete restrict,
  probe_type public.diagnostic_probe_type not null,
  weight numeric(4,3) not null default 1.000,
  revenue_lever text,
  default_delta_rate numeric(6,4),
  default_confidence public.confidence_level not null default 'medium',
  evidence_schema jsonb,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index diagnostic_check_instance_code_unique
  on public.diagnostic_check (instance_id, check_code);

create table public.fix_recommendation (
  fix_recommendation_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  diagnostic_check_id bigint not null references public.diagnostic_check(diagnostic_check_id) on delete cascade,
  fix_code text not null,
  fix_title text not null,
  fix_body_md text not null,
  trigger_condition jsonb not null default '{}'::jsonb,
  effort public.effort_level not null default 'medium',
  impact public.impact_level not null default 'medium',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index fix_recommendation_check_code_unique
  on public.fix_recommendation (diagnostic_check_id, fix_code);

create table public.vertical_benchmark (
  vertical_benchmark_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  vertical_id bigint not null references public.vertical(vertical_id) on delete cascade,
  diagnostic_stage_id bigint references public.diagnostic_stage(diagnostic_stage_id) on delete cascade,
  diagnostic_check_id bigint references public.diagnostic_check(diagnostic_check_id) on delete cascade,
  baseline_cr numeric(5,4),
  stage_share numeric(5,4),
  delta_rate numeric(6,4),
  default_aov_usd numeric(10,2),
  source text,
  effective_from date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Run layer
-- ============================================================

create type public.maturity_tier as enum ('low', 'medium', 'high');

create type public.run_source as enum ('scout_admin', 'landing_page');

create type public.run_status as enum ('queued', 'running', 'completed', 'failed');

create type public.finding_status as enum ('pass', 'fail', 'partial', 'na', 'error');

create type public.sample_type as enum ('pdp', 'category', 'search_query', 'homepage');

create table public.prospect (
  prospect_id bigserial primary key,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  url text not null,
  display_name text,
  vertical_id bigint references public.vertical(vertical_id) on delete set null,
  platform_detected text,
  engine_detected text,
  est_annual_traffic numeric(12,0),
  est_aov_usd numeric(10,2),
  contact_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One prospect per (owner, url). instance_id NULL = anonymous landing-page
-- prospect; we still deduplicate by url alone in that case so repeat anon
-- runs on the same site don't pile up.
create unique index prospect_instance_url_unique
  on public.prospect (instance_id, url)
  where instance_id is not null;

create unique index prospect_anon_url_unique
  on public.prospect (url)
  where instance_id is null;

create table public.diagnostic_run (
  run_id uuid primary key default gen_random_uuid(),
  prospect_id bigint not null references public.prospect(prospect_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  run_source public.run_source not null default 'scout_admin',
  run_status public.run_status not null default 'queued',
  triggered_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  overall_score int check (overall_score is null or (overall_score between 0 and 100)),
  stage_scores jsonb,
  maturity_tier public.maturity_tier,
  est_annual_uplift_usd numeric(12,2),
  est_confidence public.confidence_level,
  revenue_assumptions jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index diagnostic_run_prospect_idx on public.diagnostic_run (prospect_id);
create index diagnostic_run_instance_idx on public.diagnostic_run (instance_id);
create index diagnostic_run_status_idx on public.diagnostic_run (run_status);

create table public.run_sample (
  sample_id bigserial primary key,
  run_id uuid not null references public.diagnostic_run(run_id) on delete cascade,
  sample_type public.sample_type not null,
  url_or_query text not null,
  selection_reason text,
  captured_at timestamptz not null default now()
);

create index run_sample_run_idx on public.run_sample (run_id);

create table public.finding (
  finding_id bigserial primary key,
  run_id uuid not null references public.diagnostic_run(run_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  diagnostic_check_id bigint not null references public.diagnostic_check(diagnostic_check_id) on delete restrict,
  sample_id bigint references public.run_sample(sample_id) on delete set null,
  score int check (score is null or (score between 0 and 100)),
  result_status public.finding_status not null,
  evidence jsonb,
  est_annual_uplift_usd numeric(12,2),
  est_confidence public.confidence_level,
  measured_at timestamptz not null default now(),
  notes text
);

create index finding_run_idx on public.finding (run_id);
create index finding_check_idx on public.finding (diagnostic_check_id);
create index finding_instance_idx on public.finding (instance_id);

create table public.finding_fix (
  finding_fix_id bigserial primary key,
  finding_id bigint not null references public.finding(finding_id) on delete cascade,
  fix_recommendation_id bigint not null references public.fix_recommendation(fix_recommendation_id) on delete cascade,
  priority int not null default 0,
  created_at timestamptz not null default now()
);

create unique index finding_fix_unique
  on public.finding_fix (finding_id, fix_recommendation_id);

-- ============================================================
-- updated_at triggers
-- ============================================================

create trigger diagnostic_check_set_updated_at
  before update on public.diagnostic_check
  for each row execute function public.set_updated_at();

create trigger fix_recommendation_set_updated_at
  before update on public.fix_recommendation
  for each row execute function public.set_updated_at();

create trigger vertical_benchmark_set_updated_at
  before update on public.vertical_benchmark
  for each row execute function public.set_updated_at();

create trigger prospect_set_updated_at
  before update on public.prospect
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — catalog layer (instance 0 fallthrough on SELECT)
-- ============================================================

-- Reference taxonomies (stage, vertical) are global-read for any auth user.
-- They're effectively a controlled enum exposed as rows so we can add new
-- verticals without a deploy.

alter table public.diagnostic_stage enable row level security;
create policy diagnostic_stage_read on public.diagnostic_stage
  for select to authenticated using (true);
grant select on public.diagnostic_stage to authenticated;

alter table public.vertical enable row level security;
create policy vertical_read on public.vertical
  for select to authenticated using (true);
grant select on public.vertical to authenticated;

-- diagnostic_check + fix_recommendation + vertical_benchmark: per-instance
-- with instance 0 fallthrough on SELECT (same shape as prompt_template).

alter table public.diagnostic_check enable row level security;

create policy diagnostic_check_read on public.diagnostic_check
  for select to authenticated
  using (
    instance_id = 0
    or exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_check.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

create policy diagnostic_check_member_write on public.diagnostic_check
  for all to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_check.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_check.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select, insert, update, delete on public.diagnostic_check to authenticated;
grant usage, select on sequence public.diagnostic_check_diagnostic_check_id_seq to authenticated;

alter table public.fix_recommendation enable row level security;

create policy fix_recommendation_read on public.fix_recommendation
  for select to authenticated
  using (
    instance_id = 0
    or exists (
      select 1 from public.instance_member im
      where im.instance_id = fix_recommendation.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

create policy fix_recommendation_member_write on public.fix_recommendation
  for all to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = fix_recommendation.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = fix_recommendation.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select, insert, update, delete on public.fix_recommendation to authenticated;
grant usage, select on sequence public.fix_recommendation_fix_recommendation_id_seq to authenticated;

alter table public.vertical_benchmark enable row level security;

create policy vertical_benchmark_read on public.vertical_benchmark
  for select to authenticated
  using (
    instance_id = 0
    or exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_benchmark.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

create policy vertical_benchmark_member_write on public.vertical_benchmark
  for all to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_benchmark.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_benchmark.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select, insert, update, delete on public.vertical_benchmark to authenticated;
grant usage, select on sequence public.vertical_benchmark_vertical_benchmark_id_seq to authenticated;

-- ============================================================
-- RLS — run layer
-- ============================================================

-- prospect / diagnostic_run / run_sample / finding / finding_fix:
-- members read+write rows on their instance. Anonymous landing-page rows
-- (instance_id NULL) are written by anon and read back by run_id token
-- via dedicated server actions using service-role (not this RLS path).
-- Anon role gets no SELECT/INSERT here; we keep the API surface narrow
-- and route public-page traffic through service-role helpers.

alter table public.prospect enable row level security;

create policy prospect_member_rw on public.prospect
  for all to authenticated
  using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = prospect.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = prospect.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select, insert, update, delete on public.prospect to authenticated;
grant usage, select on sequence public.prospect_prospect_id_seq to authenticated;

alter table public.diagnostic_run enable row level security;

create policy diagnostic_run_member_rw on public.diagnostic_run
  for all to authenticated
  using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_run.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_run.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select, insert, update, delete on public.diagnostic_run to authenticated;

alter table public.run_sample enable row level security;

create policy run_sample_member_rw on public.run_sample
  for all to authenticated
  using (
    exists (
      select 1 from public.diagnostic_run dr
      join public.instance_member im
        on im.instance_id = dr.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
      where dr.run_id = run_sample.run_id
    )
  )
  with check (
    exists (
      select 1 from public.diagnostic_run dr
      join public.instance_member im
        on im.instance_id = dr.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
      where dr.run_id = run_sample.run_id
    )
  );

grant select, insert, update, delete on public.run_sample to authenticated;
grant usage, select on sequence public.run_sample_sample_id_seq to authenticated;

alter table public.finding enable row level security;

create policy finding_member_rw on public.finding
  for all to authenticated
  using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = finding.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = finding.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select, insert, update, delete on public.finding to authenticated;
grant usage, select on sequence public.finding_finding_id_seq to authenticated;

alter table public.finding_fix enable row level security;

create policy finding_fix_member_rw on public.finding_fix
  for all to authenticated
  using (
    exists (
      select 1 from public.finding f
      join public.instance_member im
        on im.instance_id = f.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
      where f.finding_id = finding_fix.finding_id
    )
  )
  with check (
    exists (
      select 1 from public.finding f
      join public.instance_member im
        on im.instance_id = f.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
      where f.finding_id = finding_fix.finding_id
    )
  );

grant select, insert, update, delete on public.finding_fix to authenticated;
grant usage, select on sequence public.finding_fix_finding_fix_id_seq to authenticated;

-- ============================================================
-- Seed data — diagnostic stages
-- ============================================================

insert into public.diagnostic_stage (stage_code, stage_name, description, sort_order) values
  ('discovery',     'Discovery',     'How visitors arrive: organic SEO, AI/LLM citations, social shares.', 10),
  ('on_site_nav',   'On-site navigation', 'Internal search + category browse + faceting once a visitor lands.', 20),
  ('pdp',           'PDP evaluation', 'Does the product detail page convert a visitor into add-to-cart.', 30),
  ('returns',       'Returns risk',  'Attribute completeness as a leading indicator of "didn''t match" returns.', 40);

-- ============================================================
-- Seed data — verticals
-- ============================================================

insert into public.vertical (vertical_code, vertical_name, description) values
  ('pet_retail',     'Pet retail',     'Pet food, supplies, accessories, grooming, services.'),
  ('fashion',        'Fashion',        'Apparel, footwear, accessories — size/fit-driven returns.'),
  ('electronics',    'Electronics',    'Consumer electronics, components, accessories — spec-driven evaluation.'),
  ('home_garden',    'Home & garden',  'Furniture, decor, tools, plants.'),
  ('beauty',         'Beauty',         'Skincare, cosmetics, fragrance — ingredient and shade-driven.'),
  ('grocery',        'Grocery',        'Food and beverage, often with substitution / out-of-stock dynamics.'),
  ('generic',        'Generic',        'Fallback when vertical is unknown or mixed.');

-- ============================================================
-- Seed data — starter check catalog (instance 0)
-- ============================================================

-- Pull stage IDs once so we can reference them in inserts below.
do $$
declare
  s_discovery   bigint;
  s_on_site_nav bigint;
  s_pdp         bigint;
  s_returns     bigint;
begin
  select diagnostic_stage_id into s_discovery   from public.diagnostic_stage where stage_code = 'discovery';
  select diagnostic_stage_id into s_on_site_nav from public.diagnostic_stage where stage_code = 'on_site_nav';
  select diagnostic_stage_id into s_pdp         from public.diagnostic_stage where stage_code = 'pdp';
  select diagnostic_stage_id into s_returns     from public.diagnostic_stage where stage_code = 'returns';

  insert into public.diagnostic_check
    (instance_id, check_code, check_name, description, diagnostic_stage_id, probe_type, weight, revenue_lever, default_delta_rate, default_confidence) values

  -- Discovery
  (0, 'discovery.product_jsonld_complete',
   'Product JSON-LD complete',
   'PDPs publish Product structured data with name, image, price, brand, sku, availability, aggregateRating.',
   s_discovery, 'pdp', 1.000,
   'Δ organic_sessions × CR × AOV', 0.10, 'high'),

  (0, 'discovery.llms_txt',
   'llms.txt + AI crawler policy',
   'Site exposes llms.txt and does not block major AI crawlers (GPTBot, ClaudeBot, PerplexityBot).',
   s_discovery, 'site_wide', 0.500,
   'Δ AI_referrals × CR × AOV', 0.03, 'low'),

  (0, 'discovery.sitemap_canonical',
   'Sitemap + canonical hygiene',
   'sitemap.xml present, canonical tags on category/PDP, hreflang correct for multi-locale sites.',
   s_discovery, 'site_wide', 0.700,
   'Δ indexed_pages × CTR × CR × AOV', 0.05, 'medium'),

  (0, 'discovery.core_web_vitals',
   'Core Web Vitals on PDP + listing',
   'LCP < 2.5s, INP < 200ms, CLS < 0.1 measured on a sampled PDP and category page.',
   s_discovery, 'pdp', 0.800,
   'Δ sessions × Δ CR × AOV', 0.07, 'medium'),

  (0, 'discovery.og_cards',
   'OG + Twitter share cards on PDP',
   'PDPs render og:title, og:image, og:description and Twitter card meta tags.',
   s_discovery, 'pdp', 0.300,
   'Δ social_CTR × visits', 0.02, 'low'),

  -- On-site nav
  (0, 'on_site_nav.search_engine_id',
   'Search engine identified',
   'Identify the internal search provider (Algolia, Meilisearch, Typesense, default WC/Shopify, etc.). Context, not a score on its own.',
   s_on_site_nav, 'search', 0.000,
   NULL, NULL, 'high'),

  (0, 'on_site_nav.typo_tolerance',
   'Search typo tolerance',
   'A known product title with one character mutated still returns relevant results.',
   s_on_site_nav, 'search', 1.000,
   'search_users × Δ search→cart_CR × AOV', 0.08, 'medium'),

  (0, 'on_site_nav.synonyms',
   'Synonym coverage',
   'Vertical-specific synonym pairs (e.g. perro/canino) return overlapping result sets.',
   s_on_site_nav, 'search', 1.000,
   'search_users × Δ search→cart_CR × AOV', 0.06, 'medium'),

  (0, 'on_site_nav.empty_state',
   'Empty-state behavior',
   'Zero-result queries show a useful fallback (popular products, browse prompts) rather than a dead end.',
   s_on_site_nav, 'search', 0.500,
   'zero_result_rate × Δ recovery × AOV', 0.04, 'low'),

  (0, 'on_site_nav.relevance_brand',
   'Search relevance — brand query',
   'A query for a brand name returns that brand''s products in the top positions.',
   s_on_site_nav, 'search', 0.800,
   'Δ click_position × CR × AOV', 0.05, 'medium'),

  (0, 'on_site_nav.faceting',
   'Faceting depth, ordering, counts',
   'Category page exposes meaningful facets, ordered (price first), with counts, multi-select supported.',
   s_on_site_nav, 'category', 1.000,
   'browse_users × Δ browse→cart × AOV', 0.07, 'medium'),

  -- PDP
  (0, 'pdp.image_count_quality',
   'PDP image count + resolution',
   'Sampled PDPs have 4+ images at min 1200px on the long edge.',
   s_pdp, 'pdp', 0.700,
   'pdp_visits × Δ ATC × AOV', 0.05, 'medium'),

  (0, 'pdp.variant_clarity',
   'Variant selector clarity',
   'Variant axes (size, color, etc.) rendered as labelled controls; swatches for color when applicable.',
   s_pdp, 'pdp', 0.700,
   'pdp × Δ ATC × AOV', 0.05, 'medium'),

  (0, 'pdp.attribute_table',
   'Structured attribute table',
   'PDP exposes attributes in a key/value table rather than buried in prose.',
   s_pdp, 'pdp', 1.000,
   'pdp × Δ ATC × AOV (and Δ return_rate)', 0.08, 'medium'),

  (0, 'pdp.reviews',
   'Reviews block + count',
   'Reviews section present with count and average; ideally feeds aggregateRating in JSON-LD.',
   s_pdp, 'pdp', 0.800,
   'pdp × Δ CR × AOV', 0.07, 'medium'),

  (0, 'pdp.cross_sell',
   'Cross-sell / related products',
   'PDP shows related or frequently-bought-together products.',
   s_pdp, 'pdp', 0.500,
   'orders × Δ items_per_order × unit_price', 0.04, 'low'),

  (0, 'pdp.stock_delivery',
   'Stock + delivery clarity',
   'PDP states stock availability and delivery estimate/cost above the fold.',
   s_pdp, 'pdp', 0.600,
   'pdp × Δ CR × AOV', 0.04, 'medium'),

  -- Returns
  (0, 'returns.attribute_completeness',
   'Attribute completeness (returns risk)',
   'How many of the vertical''s expected attributes are populated on sampled PDPs. Wrong purchases → returns.',
   s_returns, 'pdp', 1.000,
   '(Δ ATC × AOV) − (Δ return_rate × AOV × return_cost_multiplier)', 0.10, 'low');
end $$;

-- Seed a couple of fix recommendations to demonstrate the pattern; the
-- catalog will grow via the UI.

do $$
declare
  c_jsonld bigint;
  c_typo   bigint;
  c_attr   bigint;
begin
  select diagnostic_check_id into c_jsonld
    from public.diagnostic_check
    where instance_id = 0 and check_code = 'discovery.product_jsonld_complete';

  select diagnostic_check_id into c_typo
    from public.diagnostic_check
    where instance_id = 0 and check_code = 'on_site_nav.typo_tolerance';

  select diagnostic_check_id into c_attr
    from public.diagnostic_check
    where instance_id = 0 and check_code = 'pdp.attribute_table';

  insert into public.fix_recommendation
    (instance_id, diagnostic_check_id, fix_code, fix_title, fix_body_md, trigger_condition, effort, impact, sort_order) values

  (0, c_jsonld, 'add_full_product_jsonld',
   'Add complete Product JSON-LD to every PDP',
   E'Emit Product structured data on every PDP with all required fields:\n- `name`, `image[]`, `description`\n- `brand` (as Brand object)\n- `sku`, `gtin` when available\n- `offers` with price, priceCurrency, availability, url\n- `aggregateRating` when reviews exist\n\nValidate with Google Rich Results Test before shipping.',
   '{"result_status": "fail"}'::jsonb, 'medium', 'high', 10),

  (0, c_typo, 'enable_typo_tolerance',
   'Enable typo tolerance on the search engine',
   E'Most modern search engines support typo tolerance out of the box but require configuration:\n- **Algolia**: enabled by default; check `typoTolerance` settings\n- **Meilisearch**: configure `typoTolerance` per index\n- **Default WooCommerce**: switch to a real search engine\n\nTarget: 1 typo for queries < 8 chars, 2 typos for longer.',
   '{"result_status": "fail"}'::jsonb, 'low', 'high', 10),

  (0, c_attr, 'structure_pdp_attributes',
   'Move attributes from prose to a structured table',
   E'PDPs that bury specs in description text lose two things:\n1. Conversion: buyers can''t scan for the spec they need\n2. Returns: wrong purchases because expectations were unclear\n\nMove to a key/value attribute table on the PDP, and surface the same data in the Product JSON-LD where possible.',
   '{"result_status": "fail"}'::jsonb, 'medium', 'high', 10);
end $$;
