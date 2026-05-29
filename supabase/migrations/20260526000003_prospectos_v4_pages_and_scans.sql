-- Prospectos v4 — page-centric model.
--
-- Adds the layer the run-centric v1-v3 schema was missing: persistent
-- pages owned by a prospect, plus one scan record per page per
-- diagnostic_run. URLs no longer live only as run_sample strings.
--
-- Shape:
--   prospect ──< prospect_page ──< page_scan ──< finding
--                     │
--                     └──< page_group_membership ──> prospect_page_group
--
-- Unlocks: re-scan a page with one click, scan a group, see scan
-- history per page, compare latest vs. previous on a page. The
-- legacy run_sample table is kept so existing report pages keep
-- rendering, but new code goes through page_scan.

alter table public.prospect
  add column if not exists contact_first_name text,
  add column if not exists contact_last_name text,
  add column if not exists contact_position text;

-- ── prospect_page ─────────────────────────────────────────────────────
create table public.prospect_page (
  prospect_page_id bigserial primary key,
  prospect_id bigint not null references public.prospect(prospect_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  url text not null,
  page_type text not null default 'other',
  label text,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  discovered_via text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index prospect_page_unique on public.prospect_page (prospect_id, url);
create index prospect_page_instance_idx on public.prospect_page (instance_id);
create index prospect_page_type_idx on public.prospect_page (prospect_id, page_type);

create trigger prospect_page_set_updated_at
  before update on public.prospect_page
  for each row execute function public.set_updated_at();

alter table public.prospect_page enable row level security;

create policy prospect_page_member_rw on public.prospect_page
  for all to authenticated
  using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = prospect_page.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = prospect_page.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy prospect_page_anon_read on public.prospect_page
  for select to anon using (instance_id is null);

grant select, insert, update, delete on public.prospect_page to authenticated;
grant select on public.prospect_page to anon;
grant usage, select on sequence public.prospect_page_prospect_page_id_seq to authenticated;

-- ── prospect_page_group + page_group_membership ──────────────────────
create table public.prospect_page_group (
  group_id bigserial primary key,
  prospect_id bigint not null references public.prospect(prospect_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index prospect_page_group_unique on public.prospect_page_group (prospect_id, name);

create trigger prospect_page_group_set_updated_at
  before update on public.prospect_page_group
  for each row execute function public.set_updated_at();

alter table public.prospect_page_group enable row level security;
create policy prospect_page_group_rw on public.prospect_page_group
  for all to authenticated using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = prospect_page_group.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = prospect_page_group.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
grant select, insert, update, delete on public.prospect_page_group to authenticated;
grant usage, select on sequence public.prospect_page_group_group_id_seq to authenticated;

create table public.page_group_membership (
  membership_id bigserial primary key,
  group_id bigint not null references public.prospect_page_group(group_id) on delete cascade,
  prospect_page_id bigint not null references public.prospect_page(prospect_page_id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index page_group_membership_unique on public.page_group_membership (group_id, prospect_page_id);

alter table public.page_group_membership enable row level security;
create policy page_group_membership_rw on public.page_group_membership
  for all to authenticated using (
    exists (
      select 1 from public.prospect_page_group g
      join public.instance_member im on im.instance_id = g.instance_id
      where g.group_id = page_group_membership.group_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.prospect_page_group g
      join public.instance_member im on im.instance_id = g.instance_id
      where g.group_id = page_group_membership.group_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
grant select, insert, update, delete on public.page_group_membership to authenticated;
grant usage, select on sequence public.page_group_membership_membership_id_seq to authenticated;

-- ── page_scan ────────────────────────────────────────────────────────
create table public.page_scan (
  scan_id bigserial primary key,
  prospect_page_id bigint not null references public.prospect_page(prospect_page_id) on delete cascade,
  run_id uuid not null references public.diagnostic_run(run_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  status text not null default 'completed',
  started_at timestamptz,
  completed_at timestamptz,
  signals jsonb,
  overall_score int check (overall_score is null or (overall_score between 0 and 100)),
  est_annual_uplift_usd numeric(12,2),
  error_message text,
  created_at timestamptz not null default now()
);
create index page_scan_page_idx on public.page_scan (prospect_page_id, started_at desc);
create index page_scan_run_idx on public.page_scan (run_id);
create index page_scan_instance_idx on public.page_scan (instance_id);

alter table public.page_scan enable row level security;
create policy page_scan_member_rw on public.page_scan
  for all to authenticated using (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = page_scan.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    instance_id is not null and exists (
      select 1 from public.instance_member im
      where im.instance_id = page_scan.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );
create policy page_scan_anon_read on public.page_scan
  for select to anon using (
    exists (
      select 1 from public.diagnostic_run dr
      where dr.run_id = page_scan.run_id and dr.instance_id is null
    )
  );
grant select, insert, update, delete on public.page_scan to authenticated;
grant select on public.page_scan to anon;
grant usage, select on sequence public.page_scan_scan_id_seq to authenticated;

-- ── finding: add page_scan_id (optional) ─────────────────────────────
alter table public.finding
  add column if not exists page_scan_id bigint references public.page_scan(scan_id) on delete set null;
create index finding_page_scan_idx on public.finding (page_scan_id);

-- ── diagnostic_run: optional page_group_id (which group did we run) ──
alter table public.diagnostic_run
  add column if not exists page_group_id bigint references public.prospect_page_group(group_id) on delete set null;

-- ── Backfill ─────────────────────────────────────────────────────────
-- Populate prospect_page + page_scan from existing run_sample rows so
-- prospects with prior runs already have pages + scan history.

insert into public.prospect_page (prospect_id, instance_id, url, page_type, discovered_via)
select distinct
  dr.prospect_id,
  dr.instance_id,
  rs.url_or_query,
  rs.sample_type,
  'backfill_run_sample'
from public.run_sample rs
join public.diagnostic_run dr on dr.run_id = rs.run_id
where rs.sample_type in ('homepage','pdp','category','search_query')
  and rs.url_or_query like 'http%'
on conflict (prospect_id, url) do nothing;

insert into public.page_scan (
  prospect_page_id, run_id, instance_id, status,
  started_at, completed_at, overall_score, est_annual_uplift_usd, error_message
)
select
  pp.prospect_page_id,
  rs.run_id,
  dr.instance_id,
  case when dr.run_status = 'completed' then 'completed'
       when dr.run_status = 'failed' then 'failed'
       else 'completed' end,
  dr.started_at,
  dr.completed_at,
  dr.overall_score,
  dr.est_annual_uplift_usd,
  dr.error_message
from public.run_sample rs
join public.diagnostic_run dr on dr.run_id = rs.run_id
join public.prospect_page pp on pp.prospect_id = dr.prospect_id and pp.url = rs.url_or_query
where rs.url_or_query like 'http%'
on conflict do nothing;

-- Wire existing findings: prefer the PDP scan, fall back to any scan in the run.
update public.finding f
set page_scan_id = ps.scan_id
from public.page_scan ps
join public.prospect_page pp on pp.prospect_page_id = ps.prospect_page_id
where f.run_id = ps.run_id
  and f.page_scan_id is null
  and pp.page_type = 'pdp';

update public.finding f
set page_scan_id = ps.scan_id
from public.page_scan ps
where f.run_id = ps.run_id and f.page_scan_id is null;
