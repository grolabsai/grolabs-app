-- Search test entries: replaces the flat vertical_test_query + vertical_synonym_pair
-- with a parent (entry) → many (variants) shape. Each entry represents one
-- "intent" the user wants to test against the prospect's site search; each
-- variant is one query string we actually type into the search box.
--
-- Variant types:
--   canonical → the intended query (e.g. "running shoes"). Expects results.
--   typo      → a misspelling (e.g. "runing shoes"). Expects results iff
--               the site has typo tolerance.
--   synonym   → an alternate phrasing (e.g. "sneakers"). Expects overlap
--               with canonical.
--   plural    → singular/plural switch (e.g. "shoe" vs "shoes").
--   partial   → prefix/partial (e.g. "runn"). Expects autocomplete-style hits.
--
-- Results live in search_test_result, one row per (page_scan, variant).
-- The probe captures top result names + count + optional screenshot URL.
-- Judgment (good / bad / unclear) is computed in app code from
-- (variant_type, results_returned, overlap_count).

-- ── Entries ────────────────────────────────────────────────────────────────

create table if not exists public.search_test_entry (
  entry_id bigserial primary key,
  -- One of vertical_id OR prospect_id must be set, not both. NULL on the
  -- other side. Vertical-scoped entries are templates visible to every
  -- prospect in that vertical; prospect-scoped entries are overrides
  -- specific to one prospect.
  vertical_id bigint references public.vertical(vertical_id) on delete cascade,
  prospect_id bigint references public.prospect(prospect_id) on delete cascade,
  instance_id bigint references public.instance(instance_id) on delete cascade,
  intent_label text not null,
  locale text not null default 'en',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (vertical_id is not null and prospect_id is null) or
    (vertical_id is null and prospect_id is not null)
  )
);

create index if not exists search_test_entry_vertical_idx
  on public.search_test_entry (vertical_id)
  where vertical_id is not null;
create index if not exists search_test_entry_prospect_idx
  on public.search_test_entry (prospect_id)
  where prospect_id is not null;
create index if not exists search_test_entry_instance_idx
  on public.search_test_entry (instance_id);

-- ── Variants ───────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'search_variant_type') then
    create type public.search_variant_type as enum (
      'canonical', 'typo', 'synonym', 'plural', 'partial'
    );
  end if;
end$$;

create table if not exists public.search_test_variant (
  variant_id bigserial primary key,
  entry_id bigint not null references public.search_test_entry(entry_id) on delete cascade,
  variant_type public.search_variant_type not null,
  query_text text not null,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, variant_type, query_text)
);

create index if not exists search_test_variant_entry_idx
  on public.search_test_variant (entry_id);

-- ── Results ────────────────────────────────────────────────────────────────

create table if not exists public.search_test_result (
  result_id bigserial primary key,
  variant_id bigint not null references public.search_test_variant(variant_id) on delete cascade,
  -- Either page_scan_id (the modern path) or diagnostic_run_id (legacy /
  -- non-page-scoped runs) ties this back to the diagnostic that produced it.
  page_scan_id bigint references public.page_scan(scan_id) on delete cascade,
  run_id uuid references public.diagnostic_run(run_id) on delete cascade,
  results_returned boolean not null,
  result_count_estimate int,
  top_result_names text[] not null default array[]::text[],
  screenshot_url text,
  latency_ms int,
  notes text,
  measured_at timestamptz not null default now()
);

create index if not exists search_test_result_variant_idx
  on public.search_test_result (variant_id);
create index if not exists search_test_result_scan_idx
  on public.search_test_result (page_scan_id)
  where page_scan_id is not null;
create index if not exists search_test_result_run_idx
  on public.search_test_result (run_id)
  where run_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.search_test_entry enable row level security;
alter table public.search_test_variant enable row level security;
alter table public.search_test_result enable row level security;

-- Entry: same pattern as the rest of the catalog — authenticated users
-- see their instance's rows + the template (instance_id = 0).
drop policy if exists "entry_select" on public.search_test_entry;
create policy "entry_select" on public.search_test_entry
  for select using (
    instance_id = 0 or
    instance_id in (
      select instance_id from public.instance_member where user_id = auth.uid()
    )
  );

drop policy if exists "entry_write" on public.search_test_entry;
create policy "entry_write" on public.search_test_entry
  for all using (
    instance_id in (
      select instance_id from public.instance_member where user_id = auth.uid()
    )
  ) with check (
    instance_id in (
      select instance_id from public.instance_member where user_id = auth.uid()
    )
  );

-- Variant: piggybacks on entry's RLS via subquery
drop policy if exists "variant_select" on public.search_test_variant;
create policy "variant_select" on public.search_test_variant
  for select using (
    entry_id in (
      select entry_id from public.search_test_entry
      where instance_id = 0 or instance_id in (
        select instance_id from public.instance_member where user_id = auth.uid()
      )
    )
  );

drop policy if exists "variant_write" on public.search_test_variant;
create policy "variant_write" on public.search_test_variant
  for all using (
    entry_id in (
      select entry_id from public.search_test_entry
      where instance_id in (
        select instance_id from public.instance_member where user_id = auth.uid()
      )
    )
  ) with check (
    entry_id in (
      select entry_id from public.search_test_entry
      where instance_id in (
        select instance_id from public.instance_member where user_id = auth.uid()
      )
    )
  );

-- Result: visible whenever the parent run is visible. Anon can read
-- via the unguessable run_id (same model as the public report page).
drop policy if exists "result_select" on public.search_test_result;
create policy "result_select" on public.search_test_result
  for select using (true);

-- Writes go through service-role (the runner). No RLS-bearing write
-- policy is needed since service_role bypasses RLS.

-- ── Updated_at triggers ────────────────────────────────────────────────────

create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists search_test_entry_touch on public.search_test_entry;
create trigger search_test_entry_touch
  before update on public.search_test_entry
  for each row execute function public.touch_updated_at();

drop trigger if exists search_test_variant_touch on public.search_test_variant;
create trigger search_test_variant_touch
  before update on public.search_test_variant
  for each row execute function public.touch_updated_at();
