-- Prospectos v5 — atomic rubric schema (BRIDGE mode, additive).
--
-- DRAFT FOR REVIEW — not yet applied. Adds the atomic-rubric layer designed in
-- docs/policy/prospectos.draft.md:
--   * scored Category layer (diagnostic_category) under existing stages
--   * page_type + evidence_source lookups
--   * diagnostic_check: category, page, DEPENDENCY (self-FK), metric_kind,
--     scoring_rubric, capability_tier, finding_class, revenue_lever (enum)
--   * diagnostic_check_source (M2M), diagnostic_category_contribution (derived)
--   * diagnostic_copy (localized report copy — measure vs communicate split)
--   * diagnostic_profile (+ membership), diagnostic_run.profile_id
--   * run_category_score (normalized per-category rollup)
--   * finding_status += 'blocked' (dependency-gated → score 0, fix prereq first)
--
-- BRIDGE: keeps the diagnostic_* tables independent of funnel_*; FKs to
-- funnel_stage / funnel_friction_point are deferred to a later bridge migration.
-- All catalog tables follow the prompt_template pattern (per-instance rows +
-- instance-0 fallthrough on SELECT, member-only writes; anon reads instance 0).
--
-- Stage CODES are preserved (discovery / on_site_nav / pdp / returns) so the
-- shipped runner + existing checks keep working; only display names move and
-- three new stages are added. See the seed migration for data.

-- ============================================================
-- 1. Enums + enum extension
-- ============================================================

create type public.metric_kind as enum ('binary', 'graded', 'derived');

create type public.finding_class as enum ('revenue_leak', 'ux_issue', 'value_prop');

create type public.revenue_lever as enum ('traffic', 'conversion', 'aov', 'returns');

-- Dependency-gated zero: prerequisite unmet → dependent scored 0, fix prereq first.
-- (Separate file from any DDL that consumes it, so the new value is committed.)
alter type public.finding_status add value if not exists 'blocked';

-- ============================================================
-- 2. Global reference lookups (read-all, service-role write — like diagnostic_stage)
-- ============================================================

create table public.page_type (
  page_type_id bigserial primary key,
  page_code text not null unique,          -- SITE_WIDE, HOME, SEARCH_RESULTS, CATEGORY, PDP, LOGIN, CART, CHECKOUT
  label text not null,
  discovery_hint text,                     -- how the runner locates this page from a PDP entry
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.evidence_source (
  evidence_source_id bigserial primary key,
  source_code text not null unique,        -- ASE_PDP, ASE_SITE, BROWSER, FETCH, PSI, LLM, DB
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.page_type enable row level security;
alter table public.evidence_source enable row level security;
create policy page_type_read on public.page_type for select to authenticated, anon using (true);
create policy evidence_source_read on public.evidence_source for select to authenticated, anon using (true);
grant select on public.page_type, public.evidence_source to authenticated, anon;
grant usage, select on sequence public.page_type_page_type_id_seq to authenticated;
grant usage, select on sequence public.evidence_source_evidence_source_id_seq to authenticated;

-- ============================================================
-- 3. diagnostic_category — the scored layer under a stage
-- ============================================================

create table public.diagnostic_category (
  diagnostic_category_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  category_code text not null,             -- seo, aeo, page_performance, internal_search, ...
  name text not null,
  diagnostic_stage_id bigint not null references public.diagnostic_stage(diagnostic_stage_id) on delete restrict,
  default_finding_class public.finding_class,
  default_revenue_lever public.revenue_lever,
  icon_name text,                          -- Lucide icon (visual categorization)
  color text,
  is_derived boolean not null default false, -- returns_risk: score derived from other checks' findings
  weight numeric(6,3) not null default 1.000, -- category share of its stage
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index diagnostic_category_instance_code_unique
  on public.diagnostic_category (instance_id, category_code);
create index diagnostic_category_stage_idx on public.diagnostic_category (diagnostic_stage_id);

create trigger diagnostic_category_set_updated_at
  before update on public.diagnostic_category
  for each row execute function public.set_updated_at();

alter table public.diagnostic_category enable row level security;
create policy diagnostic_category_read on public.diagnostic_category
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_category.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy diagnostic_category_anon_read on public.diagnostic_category
  for select to anon using (instance_id = 0);
create policy diagnostic_category_member_write on public.diagnostic_category
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_category.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_category.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
grant select, insert, update, delete on public.diagnostic_category to authenticated;
grant select on public.diagnostic_category to anon;
grant usage, select on sequence public.diagnostic_category_diagnostic_category_id_seq to authenticated;

-- ============================================================
-- 4. diagnostic_check — atomic-rubric columns
-- ============================================================

alter table public.diagnostic_check
  add column if not exists diagnostic_category_id bigint references public.diagnostic_category(diagnostic_category_id) on delete set null,
  add column if not exists page_type_id bigint references public.page_type(page_type_id) on delete set null,
  add column if not exists depends_on_check_id bigint references public.diagnostic_check(diagnostic_check_id) on delete set null,
  add column if not exists metric_kind public.metric_kind,
  add column if not exists scoring_rubric jsonb,           -- credit components, sum to 100
  add column if not exists capability_tier smallint check (capability_tier between 1 and 3),
  add column if not exists finding_class public.finding_class,
  add column if not exists revenue_lever_kind public.revenue_lever; -- replaces legacy text `revenue_lever`

create index if not exists diagnostic_check_category_idx on public.diagnostic_check (diagnostic_category_id);
create index if not exists diagnostic_check_depends_on_idx on public.diagnostic_check (depends_on_check_id);

-- M2M: a check can draw on several evidence sources (e.g. OG = FETCH + ASE_PDP)
create table public.diagnostic_check_source (
  diagnostic_check_source_id bigserial primary key,
  diagnostic_check_id bigint not null references public.diagnostic_check(diagnostic_check_id) on delete cascade,
  evidence_source_id bigint not null references public.evidence_source(evidence_source_id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index diagnostic_check_source_unique
  on public.diagnostic_check_source (diagnostic_check_id, evidence_source_id);

alter table public.diagnostic_check_source enable row level security;
create policy diagnostic_check_source_read on public.diagnostic_check_source
  for select to authenticated, anon using (
    exists (
      select 1 from public.diagnostic_check dc
      where dc.diagnostic_check_id = diagnostic_check_source.diagnostic_check_id
        and (dc.instance_id = 0 or exists (
          select 1 from public.instance_member im
          where im.instance_id = dc.instance_id and im.user_id = auth.uid() and im.is_active = true
        ))
    )
  );
create policy diagnostic_check_source_member_write on public.diagnostic_check_source
  for all to authenticated using (
    exists (
      select 1 from public.diagnostic_check dc
      join public.instance_member im on im.instance_id = dc.instance_id
      where dc.diagnostic_check_id = diagnostic_check_source.diagnostic_check_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (true);
grant select, insert, update, delete on public.diagnostic_check_source to authenticated;
grant select on public.diagnostic_check_source to anon;
grant usage, select on sequence public.diagnostic_check_source_diagnostic_check_source_id_seq to authenticated;

-- Derived categories: returns_risk score = weighted combo of other checks' findings
create table public.diagnostic_category_contribution (
  contribution_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  diagnostic_category_id bigint not null references public.diagnostic_category(diagnostic_category_id) on delete cascade,
  source_check_id bigint not null references public.diagnostic_check(diagnostic_check_id) on delete cascade,
  weight numeric(6,3) not null default 1.000,
  lever_override public.revenue_lever,
  created_at timestamptz not null default now()
);
create unique index diagnostic_category_contribution_unique
  on public.diagnostic_category_contribution (diagnostic_category_id, source_check_id);

alter table public.diagnostic_category_contribution enable row level security;
create policy diagnostic_category_contribution_read on public.diagnostic_category_contribution
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_category_contribution.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy diagnostic_category_contribution_anon_read on public.diagnostic_category_contribution
  for select to anon using (instance_id = 0);
create policy diagnostic_category_contribution_member_write on public.diagnostic_category_contribution
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_category_contribution.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_category_contribution.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
grant select, insert, update, delete on public.diagnostic_category_contribution to authenticated;
grant select on public.diagnostic_category_contribution to anon;
grant usage, select on sequence public.diagnostic_category_contribution_contribution_id_seq to authenticated;

-- ============================================================
-- 5. diagnostic_copy — report-facing localized copy (measure vs communicate)
-- ============================================================

create table public.diagnostic_copy (
  diagnostic_copy_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  scope text not null check (scope in ('stage', 'category', 'check', 'band')),
  ref_code text not null,                  -- stage_code / category_code / check_code
  locale text not null default 'es',
  result_band text,                        -- only for scope='band' (pass/partial/fail/blocked/na)
  label text,                              -- report display name
  summary text,                            -- what it measures / why it matters
  grading_note text,                       -- what the score means + what full credit looks like
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index diagnostic_copy_unique
  on public.diagnostic_copy (instance_id, scope, ref_code, locale, coalesce(result_band, ''));

create trigger diagnostic_copy_set_updated_at
  before update on public.diagnostic_copy
  for each row execute function public.set_updated_at();

alter table public.diagnostic_copy enable row level security;
create policy diagnostic_copy_read on public.diagnostic_copy
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_copy.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy diagnostic_copy_anon_read on public.diagnostic_copy
  for select to anon using (instance_id = 0);
create policy diagnostic_copy_member_write on public.diagnostic_copy
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_copy.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_copy.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
grant select, insert, update, delete on public.diagnostic_copy to authenticated;
grant select on public.diagnostic_copy to anon;
grant usage, select on sequence public.diagnostic_copy_diagnostic_copy_id_seq to authenticated;

-- ============================================================
-- 6. diagnostic_profile (+ membership) + run.profile_id
-- ============================================================

create table public.diagnostic_profile (
  diagnostic_profile_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  profile_code text not null,              -- anonymous_landing_audit, continuous_monitoring, ...
  name text not null,
  is_anonymous boolean not null default false,
  is_interactive boolean not null default false,
  cadence text not null default 'one_shot', -- one_shot | recurring
  data_source text not null default 'probed', -- probed | real_telemetry
  funnel_flow_id bigint references public.funnel_flow(funnel_flow_id) on delete set null, -- bridge: structure
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index diagnostic_profile_instance_code_unique
  on public.diagnostic_profile (instance_id, profile_code);

create trigger diagnostic_profile_set_updated_at
  before update on public.diagnostic_profile
  for each row execute function public.set_updated_at();

create table public.diagnostic_profile_check (
  diagnostic_profile_check_id bigserial primary key,
  diagnostic_profile_id bigint not null references public.diagnostic_profile(diagnostic_profile_id) on delete cascade,
  diagnostic_check_id bigint not null references public.diagnostic_check(diagnostic_check_id) on delete cascade,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index diagnostic_profile_check_unique
  on public.diagnostic_profile_check (diagnostic_profile_id, diagnostic_check_id);

alter table public.diagnostic_run
  add column if not exists profile_id bigint references public.diagnostic_profile(diagnostic_profile_id) on delete set null;

alter table public.diagnostic_profile enable row level security;
create policy diagnostic_profile_read on public.diagnostic_profile
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_profile.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy diagnostic_profile_anon_read on public.diagnostic_profile
  for select to anon using (instance_id = 0);
create policy diagnostic_profile_member_write on public.diagnostic_profile
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_profile.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = diagnostic_profile.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
grant select, insert, update, delete on public.diagnostic_profile to authenticated;
grant select on public.diagnostic_profile to anon;
grant usage, select on sequence public.diagnostic_profile_diagnostic_profile_id_seq to authenticated;

alter table public.diagnostic_profile_check enable row level security;
create policy diagnostic_profile_check_read on public.diagnostic_profile_check
  for select to authenticated, anon using (
    exists (
      select 1 from public.diagnostic_profile dp
      where dp.diagnostic_profile_id = diagnostic_profile_check.diagnostic_profile_id
        and (dp.instance_id = 0 or exists (
          select 1 from public.instance_member im
          where im.instance_id = dp.instance_id and im.user_id = auth.uid() and im.is_active = true
        ))
    )
  );
create policy diagnostic_profile_check_member_write on public.diagnostic_profile_check
  for all to authenticated using (
    exists (
      select 1 from public.diagnostic_profile dp
      join public.instance_member im on im.instance_id = dp.instance_id
      where dp.diagnostic_profile_id = diagnostic_profile_check.diagnostic_profile_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (true);
grant select, insert, update, delete on public.diagnostic_profile_check to authenticated;
grant select on public.diagnostic_profile_check to anon;
grant usage, select on sequence public.diagnostic_profile_diagnostic_profile_id_seq to authenticated;
grant usage, select on sequence public.diagnostic_profile_check_diagnostic_profile_check_id_seq to authenticated;

-- ============================================================
-- 7. run_category_score — normalized per-category rollup (progress series)
-- ============================================================

create table public.run_category_score (
  run_category_score_id bigserial primary key,
  run_id uuid not null references public.diagnostic_run(run_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  diagnostic_category_id bigint not null references public.diagnostic_category(diagnostic_category_id) on delete cascade,
  score int check (score is null or (score between 0 and 100)),
  est_annual_uplift_usd numeric(12,2),
  est_confidence public.confidence_level,
  created_at timestamptz not null default now()
);
create unique index run_category_score_unique on public.run_category_score (run_id, diagnostic_category_id);
create index run_category_score_instance_idx on public.run_category_score (instance_id);

alter table public.run_category_score enable row level security;
create policy run_category_score_member_rw on public.run_category_score
  for all to authenticated using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = run_category_score.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = run_category_score.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy run_category_score_anon_read on public.run_category_score
  for select to anon using (
    exists (select 1 from public.diagnostic_run dr
            where dr.run_id = run_category_score.run_id and dr.instance_id is null)
  );
grant select, insert, update, delete on public.run_category_score to authenticated;
grant select on public.run_category_score to anon;
grant usage, select on sequence public.run_category_score_run_category_score_id_seq to authenticated;
