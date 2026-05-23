-- Blog v1 — single-table post model.
-- v1 ships: write hello world, upload images, publish. Markdown content,
-- one author (current user), one cover image URL. Tags + JSONB editor doc
-- come in v2/v3; the column types are sized for that future.

create table public.post (
  post_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,

  slug text not null,
  title text not null,
  summary text,
  content text not null default '',
  cover_image_url text,

  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index post_instance_slug_unique on public.post (instance_id, slug);
create index post_instance_status_idx on public.post (instance_id, status, published_at desc nulls last);
create index post_published_at_idx on public.post (published_at desc) where status = 'published';

-- updated_at trigger (follows existing convention in the schema)
create trigger post_set_updated_at
  before update on public.post
  for each row execute function public.set_updated_at();

-- RLS: members read/write their instance; anon + authenticated can SELECT
-- published rows from any instance (public blog surface).
alter table public.post enable row level security;

create policy post_select_published on public.post
  for select
  using (status = 'published');

create policy post_member_all on public.post
  for all
  to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = post.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = post.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select on public.post to anon, authenticated;
grant insert, update, delete on public.post to authenticated;
grant usage, select on sequence public.post_post_id_seq to authenticated;

-- Storage bucket for blog images (cover + inline). Public read so OG/IMG tags
-- work without signed URLs. Writes gated to authenticated users; the path
-- convention is `{instance_id}/{post_id_or_draft}/{filename}`.
insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', true)
on conflict (id) do nothing;

create policy blog_images_public_read on storage.objects
  for select
  using (bucket_id = 'blog-images');

create policy blog_images_member_write on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'blog-images'
    and exists (
      select 1 from public.instance_member im
      where im.user_id = auth.uid()
        and im.is_active = true
        and im.instance_id::text = (storage.foldername(name))[1]
    )
  );

create policy blog_images_member_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'blog-images'
    and exists (
      select 1 from public.instance_member im
      where im.user_id = auth.uid()
        and im.is_active = true
        and im.instance_id::text = (storage.foldername(name))[1]
    )
  );
