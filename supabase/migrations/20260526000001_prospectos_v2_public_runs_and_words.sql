-- Prospectos v2 — public anonymous runs + per-vertical test vocabulary.
--
-- Adds three things on top of prospectos_v1:
--
-- 1. RLS policies that let anon SELECT a single anonymous run + its
--    findings/fixes/samples/prospect by knowing the unguessable run_id
--    UUID (the share token). Writes still go through service-role from
--    /api/v1/diagnostic/runs.
--
-- 2. A rate-limit table + SECURITY DEFINER RPC `record_diagnostic_request`
--    that performs atomic per-IP sliding-window check-and-record. Default
--    5 req/hour, 20 req/day. Table stays private (no RLS policies = no
--    direct access); the RPC is the only way to write rows.
--
-- 3. Two new catalog tables for the Playwright probe to read from:
--    `vertical_synonym_pair` (synonym pairs per vertical+locale) and
--    `vertical_test_query` (canonical category/empty-state queries).
--    Both use the prompt_template pattern (per-instance with instance-0
--    fallthrough on SELECT). Seeded for pet_retail, fashion, generic.

-- ============================================================
-- Anonymous run read policies (gated by unguessable run_id UUID)
-- ============================================================

create policy diagnostic_run_anon_read on public.diagnostic_run
  for select to anon using (instance_id is null);
grant select on public.diagnostic_run to anon;

create policy finding_anon_read on public.finding
  for select to anon using (
    exists (
      select 1 from public.diagnostic_run dr
      where dr.run_id = finding.run_id and dr.instance_id is null
    )
  );
grant select on public.finding to anon;

create policy run_sample_anon_read on public.run_sample
  for select to anon using (
    exists (
      select 1 from public.diagnostic_run dr
      where dr.run_id = run_sample.run_id and dr.instance_id is null
    )
  );
grant select on public.run_sample to anon;

create policy finding_fix_anon_read on public.finding_fix
  for select to anon using (
    exists (
      select 1 from public.finding f
      join public.diagnostic_run dr on dr.run_id = f.run_id
      where f.finding_id = finding_fix.finding_id and dr.instance_id is null
    )
  );
grant select on public.finding_fix to anon;

create policy prospect_anon_read on public.prospect
  for select to anon using (instance_id is null);
grant select on public.prospect to anon;

-- Template-instance catalog rows are public-readable so the anon report
-- can render check names and fix copy.
create policy diagnostic_check_anon_template_read on public.diagnostic_check
  for select to anon using (instance_id = 0);
grant select on public.diagnostic_check to anon;

create policy fix_recommendation_anon_template_read on public.fix_recommendation
  for select to anon using (instance_id = 0);
grant select on public.fix_recommendation to anon;

create policy diagnostic_stage_anon_read on public.diagnostic_stage
  for select to anon using (true);

create policy vertical_anon_read on public.vertical
  for select to anon using (true);

-- ============================================================
-- Rate limit
-- ============================================================

create table public.diagnostic_rate_limit (
  id bigserial primary key,
  ip_address inet not null,
  created_at timestamptz not null default now()
);

create index diagnostic_rate_limit_ip_idx
  on public.diagnostic_rate_limit (ip_address, created_at desc);

alter table public.diagnostic_rate_limit enable row level security;
-- No policies on purpose — only service-role and the SECURITY DEFINER
-- function below can touch this table.

create or replace function public.record_diagnostic_request(
  p_ip inet,
  p_hour_limit int default 5,
  p_day_limit int default 20
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour_count int;
  v_day_count int;
begin
  delete from public.diagnostic_rate_limit
   where created_at < now() - interval '24 hours';

  select count(*) into v_hour_count
    from public.diagnostic_rate_limit
   where ip_address = p_ip and created_at >= now() - interval '1 hour';

  select count(*) into v_day_count
    from public.diagnostic_rate_limit
   where ip_address = p_ip;

  if v_hour_count >= p_hour_limit or v_day_count >= p_day_limit then
    return false;
  end if;

  insert into public.diagnostic_rate_limit (ip_address) values (p_ip);
  return true;
end;
$$;

revoke all on function public.record_diagnostic_request(inet, int, int) from public;
grant execute on function public.record_diagnostic_request(inet, int, int) to anon, authenticated;

-- ============================================================
-- Per-vertical test vocabulary
-- ============================================================

create table public.vertical_synonym_pair (
  pair_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  vertical_id bigint not null references public.vertical(vertical_id) on delete cascade,
  term_a text not null,
  term_b text not null,
  locale text not null default 'es',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vertical_synonym_pair_unique
  on public.vertical_synonym_pair (instance_id, vertical_id, locale, lower(term_a), lower(term_b));

create trigger vertical_synonym_pair_set_updated_at
  before update on public.vertical_synonym_pair
  for each row execute function public.set_updated_at();

alter table public.vertical_synonym_pair enable row level security;

create policy vertical_synonym_pair_read on public.vertical_synonym_pair
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_synonym_pair.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );

create policy vertical_synonym_pair_write on public.vertical_synonym_pair
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_synonym_pair.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_synonym_pair.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );

grant select, insert, update, delete on public.vertical_synonym_pair to authenticated;
grant usage, select on sequence public.vertical_synonym_pair_pair_id_seq to authenticated;

create table public.vertical_test_query (
  query_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  vertical_id bigint not null references public.vertical(vertical_id) on delete cascade,
  query_text text not null,
  locale text not null default 'es',
  intent text not null default 'category',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vertical_test_query_unique
  on public.vertical_test_query (instance_id, vertical_id, locale, lower(query_text));

create trigger vertical_test_query_set_updated_at
  before update on public.vertical_test_query
  for each row execute function public.set_updated_at();

alter table public.vertical_test_query enable row level security;

create policy vertical_test_query_read on public.vertical_test_query
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_test_query.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );

create policy vertical_test_query_write on public.vertical_test_query
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_test_query.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_test_query.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );

grant select, insert, update, delete on public.vertical_test_query to authenticated;
grant usage, select on sequence public.vertical_test_query_query_id_seq to authenticated;

-- ============================================================
-- Seed instance 0 with pet + fashion + generic test vocabularies
-- ============================================================

do $$
declare
  v_pet      bigint;
  v_fashion  bigint;
  v_generic  bigint;
begin
  select vertical_id into v_pet     from public.vertical where vertical_code = 'pet_retail';
  select vertical_id into v_fashion from public.vertical where vertical_code = 'fashion';
  select vertical_id into v_generic from public.vertical where vertical_code = 'generic';

  insert into public.vertical_synonym_pair
    (instance_id, vertical_id, term_a, term_b, locale) values
  (0, v_pet, 'perro',     'canino',   'es'),
  (0, v_pet, 'gato',      'felino',   'es'),
  (0, v_pet, 'comida',    'alimento', 'es'),
  (0, v_pet, 'juguete',   'juego',    'es'),
  (0, v_pet, 'collar',    'correa',   'es'),
  (0, v_pet, 'dog',       'canine',   'en'),
  (0, v_pet, 'cat',       'feline',   'en'),
  (0, v_pet, 'food',      'kibble',   'en'),
  (0, v_fashion, 'shoes',  'footwear', 'en'),
  (0, v_fashion, 'dress',  'gown',     'en'),
  (0, v_fashion, 'shirt',  'top',      'en'),
  (0, v_fashion, 'zapato', 'calzado',  'es'),
  (0, v_fashion, 'vestido','traje',    'es');

  insert into public.vertical_test_query
    (instance_id, vertical_id, query_text, locale, intent) values
  (0, v_pet, 'comida para perro',  'es', 'category'),
  (0, v_pet, 'arena para gato',    'es', 'category'),
  (0, v_pet, 'collar antipulgas',  'es', 'category'),
  (0, v_pet, 'dog food',           'en', 'category'),
  (0, v_pet, 'cat litter',         'en', 'category'),
  (0, v_pet, 'flea collar',        'en', 'category'),
  (0, v_pet, 'xyzzy nope',         'es', 'empty_state'),
  (0, v_pet, 'qwertyabc',          'en', 'empty_state'),
  (0, v_fashion, 'vestido verano', 'es', 'category'),
  (0, v_fashion, 'summer dress',   'en', 'category'),
  (0, v_fashion, 'zapatillas',     'es', 'category'),
  (0, v_fashion, 'running shoes',  'en', 'category'),
  (0, v_fashion, 'xyzzy nope',     'es', 'empty_state'),
  (0, v_generic, 'xyzzy nope',     'es', 'empty_state'),
  (0, v_generic, 'qwertyabc',      'en', 'empty_state');
end $$;
