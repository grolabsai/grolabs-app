-- Prospectos v5 — atomic rubric seed (instance 0 = GroLabs canonical).
--
-- DRAFT FOR REVIEW — not yet applied. Depends on 20260605000001.
-- Seeds the ~55 atomic checks designed in docs/policy/prospectos.draft.md:
-- categories, page/source lookups, checks (code/category/page/metric/weight/
-- tier/class/lever), dependency edges, primary evidence source per check, the
-- derived returns-risk contributions, and the Anonymous Landing Audit profile.
--
-- NOT seeded here (TBD — do not invent): per-check `scoring_rubric` JSONB and
-- the full es/en `diagnostic_copy` (labels/summaries/grading_note). A few copy
-- rows are seeded as examples; the rest are TODO.
--
-- Legacy v1–v3 checks (no diagnostic_category_id) are left ACTIVE and untouched
-- so the running widget keeps working; deactivate them at engine cutover once
-- the new per-check scorers exist (separate migration).

-- ── Stages: relabel (codes preserved) + add three ───────────────────────
update public.diagnostic_stage set stage_name = 'Discovery',       sort_order = 1 where stage_code = 'discovery';
update public.diagnostic_stage set stage_name = 'Internal search', sort_order = 2 where stage_code = 'on_site_nav';
update public.diagnostic_stage set stage_name = 'Decision',        sort_order = 3 where stage_code = 'pdp';
update public.diagnostic_stage set stage_name = 'Return risk',     sort_order = 7 where stage_code = 'returns';
insert into public.diagnostic_stage (stage_code, stage_name, sort_order) values
  ('cart', 'Cart', 4), ('checkout', 'Checkout', 5), ('authentication', 'Authentication', 6)
on conflict (stage_code) do nothing;

-- ── page_type ───────────────────────────────────────────────────────────
insert into public.page_type (page_code, label, sort_order, discovery_hint) values
  ('SITE_WIDE',      'Site-wide',      1, 'root domain: robots.txt / sitemap.xml / llms.txt'),
  ('HOME',           'Home',           2, 'strip the submitted URL to its root'),
  ('SEARCH_RESULTS', 'Search results', 3, 'trigger a search from the home page'),
  ('CATEGORY',       'Category',       4, 'follow a category / collection link'),
  ('PDP',            'Product detail', 5, 'the submitted URL'),
  ('LOGIN',          'Login',          6, 'discover login/account link; ask the user if not found'),
  ('CART',           'Cart',           7, 'add-to-cart then cart (not in the anon profile)'),
  ('CHECKOUT',       'Checkout',       8, 'checkout (not in the anon profile)')
on conflict (page_code) do nothing;

-- ── evidence_source ─────────────────────────────────────────────────────
insert into public.evidence_source (source_code, label) values
  ('ASE_PDP',  'ASE /tools/pdp-signals'),
  ('ASE_SITE', 'ASE /tools/site-signals'),
  ('BROWSER',  'Browser probe (Playwright)'),
  ('FETCH',    'RRE HTTP fetch'),
  ('PSI',      'Google PageSpeed Insights'),
  ('LLM',      'Claude (Haiku)'),
  ('DB',       'Vertical vocab (DB)')
on conflict (source_code) do nothing;

-- ── diagnostic_category (instance 0) ────────────────────────────────────
insert into public.diagnostic_category
  (instance_id, category_code, name, diagnostic_stage_id, default_finding_class, default_revenue_lever, icon_name, is_derived, weight, sort_order)
select 0, v.code, v.name, s.diagnostic_stage_id, v.class::public.finding_class, v.lever::public.revenue_lever, v.icon, v.derived, v.weight, v.ord
from (values
  ('seo',              'SEO',              'discovery',      'revenue_leak', 'traffic',    'Globe',       false, 45, 1),
  ('aeo',              'AEO',              'discovery',      'revenue_leak', 'traffic',    'Bot',         false, 30, 2),
  ('page_performance', 'Page performance', 'discovery',     'revenue_leak', 'traffic',    'Gauge',       false, 25, 3),
  ('internal_search',  'Internal search',  'on_site_nav',   'revenue_leak', 'conversion', 'Search',      false, 100, 1),
  ('pdp_quality',      'PDP quality',      'pdp',           'revenue_leak', 'conversion', 'Package',     false, 64, 1),
  ('data_completeness','Data completeness','pdp',           'revenue_leak', 'conversion', 'ListChecks',  false, 36, 2),
  ('authentication',   'Authentication',   'authentication','revenue_leak', 'conversion', 'LogIn',       false, 100, 1),
  ('returns_risk',     'Return risk',      'returns',       'revenue_leak', 'returns',    'Undo2',       true,  100, 1),
  ('site_trust',       'Site trust',       'pdp',           'revenue_leak', 'conversion', 'ShieldCheck', false, 0,  9)
) as v(code, name, stage, class, lever, icon, derived, weight, ord)
join public.diagnostic_stage s on s.stage_code = v.stage
on conflict (instance_id, category_code) do nothing;

-- ── diagnostic_check (instance 0) — the 55 atomic checks ────────────────
-- probe_type is the legacy enum (approximate); page_type_id is authoritative.
insert into public.diagnostic_check
  (instance_id, check_code, check_name, diagnostic_stage_id, probe_type, weight,
   diagnostic_category_id, page_type_id, metric_kind, capability_tier, finding_class, revenue_lever_kind, is_active)
-- BRIDGE: new v5 checks seeded is_active=false so the live legacy runner
-- (selects WHERE is_active=true) ignores them. The v5 profile-driven runner
-- loads them via diagnostic_profile_check; flip to active at legacy cutover.
select 0, v.code, v.name, c.diagnostic_stage_id, v.probe::public.diagnostic_probe_type, v.weight,
       c.diagnostic_category_id, p.page_type_id, v.metric::public.metric_kind, v.tier,
       v.class::public.finding_class, v.lever::public.revenue_lever, false
from (values
  -- Discovery / seo
  ('seo.jsonld.present',           'Product JSON-LD present',        'seo','PDP','pdp','binary',  8,1,'revenue_leak','traffic'),
  ('seo.jsonld.required_complete', 'JSON-LD required fields',        'seo','PDP','pdp','graded', 10,1,'revenue_leak','traffic'),
  ('seo.jsonld.bonus',             'JSON-LD bonus fields',           'seo','PDP','pdp','graded',  4,1,'value_prop','traffic'),
  ('seo.sitemap.present',          'sitemap.xml present',            'seo','SITE_WIDE','site_wide','binary', 6,1,'revenue_leak','traffic'),
  ('seo.sitemap.valid',            'sitemap valid + fresh',          'seo','SITE_WIDE','site_wide','graded', 3,1,'revenue_leak','traffic'),
  ('seo.og.title',                 'og:title present',               'seo','SITE_WIDE','site_wide','binary', 3,1,'revenue_leak','traffic'),
  ('seo.og.description',           'og:description present',         'seo','SITE_WIDE','site_wide','binary', 3,1,'revenue_leak','traffic'),
  ('seo.og.image',                 'og:image present',               'seo','SITE_WIDE','site_wide','binary', 4,1,'revenue_leak','traffic'),
  ('seo.canonical.present',        'canonical tag present',          'seo','PDP','pdp','binary',  4,1,'revenue_leak','traffic'),
  -- Discovery / aeo
  ('aeo.llms_txt.present',         'llms.txt present',               'aeo','SITE_WIDE','site_wide','binary',10,3,'revenue_leak','traffic'),
  ('aeo.llms_txt.quality',         'llms.txt quality',               'aeo','SITE_WIDE','site_wide','graded', 8,3,'revenue_leak','traffic'),
  ('aeo.robots.ai_policy',         'robots AI-bot policy',           'aeo','SITE_WIDE','site_wide','graded', 7,3,'revenue_leak','traffic'),
  ('aeo.faq_schema.present',       'FAQ / Q&A schema present',       'aeo','SITE_WIDE','site_wide','binary', 3,3,'value_prop','traffic'),
  ('aeo.answerable.structure',     'answer-structured content',      'aeo','PDP','pdp','graded',  2,3,'value_prop','traffic'),
  -- Discovery / page_performance
  ('perf.cwv.lcp',                 'Largest Contentful Paint',       'page_performance','PDP','pdp','graded',10,1,'revenue_leak','traffic'),
  ('perf.cwv.inp',                 'Interaction to Next Paint',      'page_performance','PDP','pdp','graded', 8,1,'revenue_leak','traffic'),
  ('perf.cwv.cls',                 'Cumulative Layout Shift',        'page_performance','PDP','pdp','graded', 7,1,'revenue_leak','traffic'),
  -- Internal search
  ('search.box.present',           'search box present',             'internal_search','HOME','homepage','binary',12,1,'ux_issue','conversion'),
  ('search.speed.latency',         'search response latency',        'internal_search','HOME','homepage','graded', 7,1,'revenue_leak','conversion'),
  ('search.typo.tolerance',        'typo tolerance',                 'internal_search','HOME','homepage','graded',10,1,'revenue_leak','conversion'),
  ('search.synonym.coverage',      'synonym coverage',               'internal_search','HOME','homepage','graded',10,1,'revenue_leak','conversion'),
  ('search.autocomplete.present',  'autocomplete present',           'internal_search','HOME','homepage','binary', 5,1,'revenue_leak','conversion'),
  ('search.autocomplete.quality',  'autocomplete relevance',         'internal_search','HOME','homepage','graded', 3,2,'value_prop','conversion'),
  ('search.semantic.present',      'semantic search',                'internal_search','HOME','homepage','binary', 4,2,'value_prop','conversion'),
  ('search.conversational.present','conversational search',          'internal_search','HOME','homepage','binary', 2,2,'value_prop','conversion'),
  ('search.image.present',         'image-based search',             'internal_search','HOME','homepage','binary', 2,3,'value_prop','conversion'),
  ('search.recent.persistence',    'recent-search persistence',      'internal_search','HOME','homepage','binary', 2,1,'value_prop','conversion'),
  ('reco.home.present',            'product recommendations present','internal_search','HOME','homepage','binary', 3,2,'value_prop','conversion'),
  ('reco.home.quality',            'recommendation relevance',       'internal_search','HOME','homepage','graded', 2,2,'value_prop','conversion'),
  ('search.empty_state',           'empty-state handling',           'internal_search','SEARCH_RESULTS','search','graded', 7,1,'revenue_leak','conversion'),
  ('search.brand_relevance',       'brand-query relevance',          'internal_search','SEARCH_RESULTS','search','graded', 7,1,'revenue_leak','conversion'),
  ('facet.present',                'facet filtering present',        'internal_search','SEARCH_RESULTS','search','binary', 8,1,'ux_issue','conversion'),
  ('facet.depth',                  'facet depth / usefulness',       'internal_search','SEARCH_RESULTS','search','graded', 5,1,'ux_issue','conversion'),
  ('nav.category.usability',       'category-nav usability',         'internal_search','CATEGORY','category','graded', 6,1,'ux_issue','conversion'),
  ('nav.tags.present',             'product tags present',           'internal_search','PDP','pdp','binary', 2,1,'ux_issue','conversion'),
  ('nav.breadcrumb.present',       'breadcrumb present',             'internal_search','PDP','pdp','binary', 3,1,'ux_issue','conversion'),
  -- Decision / pdp_quality
  ('pdp.images.present',           'has product images',             'pdp_quality','PDP','pdp','binary', 8,1,'revenue_leak','conversion'),
  ('pdp.images.count',             'sufficient image count',         'pdp_quality','PDP','pdp','graded', 6,1,'revenue_leak','conversion'),
  ('pdp.images.alt_quality',       'image alt-text quality',         'pdp_quality','PDP','pdp','graded', 5,1,'revenue_leak','conversion'),
  ('pdp.variants.present',         'variant selector present',       'pdp_quality','PDP','pdp','binary', 6,1,'revenue_leak','conversion'),
  ('pdp.variants.clarity',         'variant clarity',                'pdp_quality','PDP','pdp','graded', 5,1,'revenue_leak','conversion'),
  ('pdp.description.present',      'descriptive paragraph present',  'pdp_quality','PDP','pdp','binary', 7,1,'revenue_leak','conversion'),
  ('pdp.description.quality',      'description richness',           'pdp_quality','PDP','pdp','graded', 8,1,'revenue_leak','conversion'),
  ('pdp.reviews.present',          'reviews present',                'pdp_quality','PDP','pdp','binary', 6,1,'revenue_leak','conversion'),
  ('pdp.stock.clarity',            'stock + delivery clarity',       'pdp_quality','PDP','pdp','graded', 6,1,'revenue_leak','conversion'),
  ('pdp.crosssell.present',        'cross-sell present',             'pdp_quality','PDP','pdp','binary', 4,1,'value_prop','aov'),
  ('pdp.upsell.present',           'upsell present',                 'pdp_quality','PDP','pdp','binary', 3,1,'value_prop','aov'),
  -- Decision / data_completeness
  ('pdp.attributes.present',       'structured attribute table',     'data_completeness','PDP','pdp','binary',12,1,'revenue_leak','conversion'),
  ('pdp.attributes.completeness',  'expected-attribute coverage',    'data_completeness','PDP','pdp','graded',24,1,'revenue_leak','conversion'),
  -- Authentication
  ('auth.gating.browse',           'no forced login to browse/buy',  'authentication','SITE_WIDE','site_wide','binary',30,1,'revenue_leak','conversion'),
  ('auth.mobile.login_overlay',    'mobile login button not obscured','authentication','LOGIN','site_wide','binary',20,1,'revenue_leak','conversion'),
  ('auth.sso.google',              'SSO Google present',             'authentication','LOGIN','site_wide','binary',18,1,'revenue_leak','conversion'),
  ('auth.sso.apple',               'SSO Apple present',              'authentication','LOGIN','site_wide','binary',14,1,'revenue_leak','conversion'),
  ('auth.sso.meta',                'SSO Meta present',               'authentication','LOGIN','site_wide','binary',10,1,'revenue_leak','conversion'),
  ('auth.sso.microsoft',           'SSO Microsoft present',          'authentication','LOGIN','site_wide','binary', 8,1,'revenue_leak','conversion')
) as v(code, name, category, page, probe, metric, weight, tier, class, lever)
join public.diagnostic_category c on c.category_code = v.category and c.instance_id = 0
join public.page_type p on p.page_code = v.page
on conflict (instance_id, check_code) do nothing;

-- ── Dependency edges (depends_on_check_id) ──────────────────────────────
update public.diagnostic_check ch
set depends_on_check_id = parent.diagnostic_check_id
from (values
  ('seo.jsonld.required_complete', 'seo.jsonld.present'),
  ('seo.jsonld.bonus',             'seo.jsonld.present'),
  ('seo.sitemap.valid',            'seo.sitemap.present'),
  ('aeo.llms_txt.quality',         'aeo.llms_txt.present'),
  ('search.speed.latency',         'search.box.present'),
  ('search.typo.tolerance',        'search.box.present'),
  ('search.synonym.coverage',      'search.box.present'),
  ('search.autocomplete.present',  'search.box.present'),
  ('search.autocomplete.quality',  'search.autocomplete.present'),
  ('search.semantic.present',      'search.box.present'),
  ('search.conversational.present','search.box.present'),
  ('search.recent.persistence',    'search.box.present'),
  ('search.empty_state',           'search.box.present'),
  ('search.brand_relevance',       'search.box.present'),
  ('reco.home.quality',            'reco.home.present'),
  ('facet.depth',                  'facet.present'),
  ('pdp.images.count',             'pdp.images.present'),
  ('pdp.images.alt_quality',       'pdp.images.present'),
  ('pdp.variants.clarity',         'pdp.variants.present'),
  ('pdp.description.quality',      'pdp.description.present')
) as d(child, parent_code)
join public.diagnostic_check parent on parent.check_code = d.parent_code and parent.instance_id = 0
where ch.check_code = d.child and ch.instance_id = 0;

-- ── Primary evidence source per check (secondary LLM/DB sources = TODO) ──
insert into public.diagnostic_check_source (diagnostic_check_id, evidence_source_id, is_primary)
select ch.diagnostic_check_id, es.evidence_source_id, true
from (values
  ('seo.jsonld.present','ASE_PDP'),('seo.jsonld.required_complete','ASE_PDP'),('seo.jsonld.bonus','ASE_PDP'),
  ('seo.sitemap.present','FETCH'),('seo.sitemap.valid','FETCH'),
  ('seo.og.title','FETCH'),('seo.og.description','FETCH'),('seo.og.image','FETCH'),('seo.canonical.present','ASE_PDP'),
  ('aeo.llms_txt.present','FETCH'),('aeo.llms_txt.quality','FETCH'),('aeo.robots.ai_policy','FETCH'),
  ('aeo.faq_schema.present','ASE_PDP'),('aeo.answerable.structure','ASE_PDP'),
  ('perf.cwv.lcp','PSI'),('perf.cwv.inp','PSI'),('perf.cwv.cls','PSI'),
  ('search.box.present','ASE_SITE'),('search.speed.latency','BROWSER'),('search.typo.tolerance','BROWSER'),
  ('search.synonym.coverage','BROWSER'),('search.autocomplete.present','BROWSER'),('search.autocomplete.quality','BROWSER'),
  ('search.semantic.present','BROWSER'),('search.conversational.present','BROWSER'),('search.image.present','ASE_SITE'),
  ('search.recent.persistence','BROWSER'),('reco.home.present','ASE_SITE'),('reco.home.quality','ASE_SITE'),
  ('search.empty_state','BROWSER'),('search.brand_relevance','BROWSER'),('facet.present','ASE_SITE'),('facet.depth','ASE_SITE'),
  ('nav.category.usability','ASE_SITE'),('nav.tags.present','ASE_PDP'),('nav.breadcrumb.present','ASE_PDP'),
  ('pdp.images.present','ASE_PDP'),('pdp.images.count','ASE_PDP'),('pdp.images.alt_quality','ASE_PDP'),
  ('pdp.variants.present','ASE_PDP'),('pdp.variants.clarity','ASE_PDP'),('pdp.description.present','ASE_PDP'),
  ('pdp.description.quality','ASE_PDP'),('pdp.reviews.present','ASE_PDP'),('pdp.stock.clarity','ASE_PDP'),
  ('pdp.crosssell.present','ASE_PDP'),('pdp.upsell.present','ASE_PDP'),
  ('pdp.attributes.present','ASE_PDP'),('pdp.attributes.completeness','ASE_PDP'),
  ('auth.gating.browse','BROWSER'),('auth.mobile.login_overlay','BROWSER'),
  ('auth.sso.google','ASE_SITE'),('auth.sso.apple','ASE_SITE'),('auth.sso.meta','ASE_SITE'),('auth.sso.microsoft','ASE_SITE')
) as m(code, source)
join public.diagnostic_check ch on ch.check_code = m.code and ch.instance_id = 0
join public.evidence_source es on es.source_code = m.source
on conflict (diagnostic_check_id, evidence_source_id) do nothing;

-- ── Derived returns_risk: re-weight existing PDP findings ───────────────
insert into public.diagnostic_category_contribution
  (instance_id, diagnostic_category_id, source_check_id, weight, lever_override)
select 0, cat.diagnostic_category_id, ch.diagnostic_check_id, m.weight, 'returns'::public.revenue_lever
from (values
  ('returns_risk','pdp.attributes.completeness',45),
  ('returns_risk','pdp.description.quality',30),
  ('returns_risk','pdp.images.alt_quality',25)
) as m(cat_code, check_code, weight)
join public.diagnostic_category cat on cat.category_code = m.cat_code and cat.instance_id = 0
join public.diagnostic_check ch on ch.check_code = m.check_code and ch.instance_id = 0
on conflict (diagnostic_category_id, source_check_id) do nothing;

-- ── Anonymous Landing Audit profile + membership (all non-cart/checkout) ─
insert into public.diagnostic_profile
  (instance_id, profile_code, name, is_anonymous, is_interactive, cadence, data_source)
values (0, 'anonymous_landing_audit', 'Anonymous Landing Audit', true, false, 'one_shot', 'probed')
on conflict (instance_id, profile_code) do nothing;

insert into public.diagnostic_profile_check (diagnostic_profile_id, diagnostic_check_id, is_enabled)
select dp.diagnostic_profile_id, ch.diagnostic_check_id, true
from public.diagnostic_profile dp
join public.diagnostic_check ch on ch.instance_id = 0 and ch.diagnostic_category_id is not null
join public.diagnostic_category cat on cat.diagnostic_category_id = ch.diagnostic_category_id
join public.diagnostic_stage st on st.diagnostic_stage_id = cat.diagnostic_stage_id
where dp.instance_id = 0 and dp.profile_code = 'anonymous_landing_audit'
  and st.stage_code not in ('cart', 'checkout')
on conflict (diagnostic_profile_id, diagnostic_check_id) do nothing;

-- ── diagnostic_copy — EXAMPLES ONLY (full es/en authoring is TODO) ──────
insert into public.diagnostic_copy (instance_id, scope, ref_code, locale, label, summary, grading_note) values
  (0,'category','seo','es','SEO','Qué tan visible eres para los buscadores tradicionales.','100 = datos estructurados, sitemap, OG y canonical completos.'),
  (0,'category','aeo','es','AEO','Qué tan legible eres para los motores de respuesta con IA.','100 = llms.txt presente y de calidad + política de bots de IA permisiva.'),
  (0,'check','aeo.llms_txt.present','es','Archivo llms.txt','¿Existe /llms.txt en tu dominio?','Sí = 100, No = 0. Sin él, no hay calidad que evaluar (la dependiente queda en 0).')
on conflict (instance_id, scope, ref_code, locale, coalesce(result_band, '')) do nothing;
-- TODO: author label + summary + grading_note for every stage / category /
-- check, in es and en. TODO: per-check scoring_rubric JSONB (credit components).
