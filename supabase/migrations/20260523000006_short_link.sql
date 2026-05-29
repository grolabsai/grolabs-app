-- Short URLs — self-hosted, scoped per instance.
--
-- Each tenant gets their own namespace: grolabs.com/s/abc12 and
-- wazu.com/s/abc12 are independent records. Host-aware lookup matches
-- the rest of the public blog surface (instanceIdForHost).
--
-- The redirect route increments `click_count` on each hit. No
-- analytics dashboard yet — that's a later read-only screen if traffic
-- demand warrants it.

create table public.short_link (
  short_link_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  code text not null,
  target_url text not null,
  post_id bigint references public.post(post_id) on delete set null,
  click_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index short_link_instance_code_unique
  on public.short_link (instance_id, code);

-- One short link per post (per instance). Posts can have at most one
-- canonical short URL; if you need multiple, mint them with different
-- target_urls (e.g. with UTM params) — that's a separate row.
create unique index short_link_instance_post_unique
  on public.short_link (instance_id, post_id)
  where post_id is not null;

create trigger short_link_set_updated_at
  before update on public.short_link
  for each row execute function public.set_updated_at();

alter table public.short_link enable row level security;

-- Public read: the redirect route runs anon, needs to look up codes.
create policy short_link_select_public on public.short_link
  for select using (true);

-- Writes: members of the instance.
create policy short_link_member_write on public.short_link
  for all to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = short_link.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = short_link.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select on public.short_link to anon, authenticated;
grant insert, update, delete on public.short_link to authenticated;
grant usage, select on sequence public.short_link_short_link_id_seq to authenticated;

-- Atomic click counter — avoids read-modify-write races under traffic
-- spikes. SECURITY DEFINER because anon-facing redirect calls this.
create or replace function public.short_link_record_click(
  p_instance_id bigint,
  p_code text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text;
begin
  update public.short_link
     set click_count = click_count + 1
   where instance_id = p_instance_id
     and code = p_code
  returning target_url into v_target;
  return v_target;
end;
$$;

grant execute on function public.short_link_record_click(bigint, text) to anon, authenticated;
