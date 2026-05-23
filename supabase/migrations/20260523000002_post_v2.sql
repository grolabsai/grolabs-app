-- Blog v2 — Tiptap (HTML) content, scheduled publish, tags, domain routing.
-- Schema is forward-compatible with v1 markdown posts: content_format
-- distinguishes how to render. Existing v1 rows are backfilled to 'markdown'
-- before the new default ('html') applies to fresh writes.

-- 1. content_format — distinguish v1 markdown from v2 Tiptap HTML
alter table public.post
  add column content_format text not null default 'html'
  check (content_format in ('markdown', 'html'));

update public.post set content_format = 'markdown' where created_at < now();

-- 2. tags — text[] with GIN index for "posts tagged X" filtering
alter table public.post
  add column tags text[] not null default '{}';

create index post_tags_gin_idx on public.post using gin (tags);

-- 3. 'scheduled' status — for future-dated publishes flipped by cron
alter table public.post drop constraint post_status_check;
alter table public.post
  add constraint post_status_check
  check (status in ('draft', 'scheduled', 'published'));

-- 4. instance.domain — public hostname for v3 multi-tenant /blog routing
alter table public.instance add column domain text;
create unique index instance_domain_unique on public.instance (domain)
  where domain is not null;

-- 5. publish_due_posts() — called by Vercel cron each minute, flips
-- scheduled→published for any post whose published_at has arrived.
-- SECURITY DEFINER because cron runs unauthenticated.
create or replace function public.publish_due_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.post
     set status = 'published'
   where status = 'scheduled'
     and published_at is not null
     and published_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.publish_due_posts() to anon, authenticated;
