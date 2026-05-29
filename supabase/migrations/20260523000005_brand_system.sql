-- Brand system — per-instance design + voice configuration.
--
-- Single row per instance. Powers:
--   - Public reading page CSS (colors + fonts injected as custom props)
--   - OG image fallback card (next/og reads palette + heading font)
--   - AI voice guide (blog.voice_default falls back to this row's
--     voice_guide column; per-post overrides land later with the
--     consulting agent's writing_strategy JSONB)
--
-- Seeds instance 0 with GroLabs's house style (cream + terracotta +
-- serif). Other tenants get a row when they're onboarded — for now,
-- code reads the matching row OR falls back to instance 0.

create table public.brand_system (
  brand_system_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,

  -- Identity
  display_name text not null default '',
  tagline text,
  logo_url text,
  logo_dark_url text,

  -- Colors (hex)
  primary_color text not null default '#9C5530',
  background_color text not null default '#F4F1EA',
  text_color text not null default '#1A1612',
  muted_color text not null default '#5C5247',
  accent_color text not null default '#9C5530',

  -- Typography (CSS font-family strings, web-safe)
  heading_font text not null default 'Georgia, "Times New Roman", serif',
  body_font text not null default 'system-ui, -apple-system, sans-serif',

  -- AI / image
  illustration_style text not null default 'realistic'
    check (illustration_style in ('realistic', 'conceptual', 'isometric', 'flat', 'line')),
  voice_guide text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index brand_system_instance_unique
  on public.brand_system (instance_id);

create trigger brand_system_set_updated_at
  before update on public.brand_system
  for each row execute function public.set_updated_at();

alter table public.brand_system enable row level security;

-- Read: any authenticated user can read their own + instance 0 (template).
-- Anon can also read (public reading page renders themed CSS) — limited to
-- the row that matches the request's hostname via the same lookup pattern
-- as posts (instanceIdForHost on the server reads it via service role).
-- For RLS purposes, anon can read any row; the brand_system doesn't
-- contain secrets — it's literally how the brand looks publicly.
create policy brand_system_select_public on public.brand_system
  for select
  using (true);

create policy brand_system_member_write on public.brand_system
  for all to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = brand_system.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = brand_system.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select on public.brand_system to anon, authenticated;
grant insert, update, delete on public.brand_system to authenticated;
grant usage, select on sequence public.brand_system_brand_system_id_seq to authenticated;

-- Seed GroLabs's house style on instance 0 (the template).
insert into public.brand_system (
  instance_id, display_name, tagline,
  primary_color, background_color, text_color, muted_color, accent_color,
  heading_font, body_font,
  illustration_style, voice_guide
) values (
  0, 'GroLabs', 'Build better systems for the work that matters.',
  '#9C5530', '#F4F1EA', '#1A1612', '#5C5247', '#9C5530',
  'Georgia, "Times New Roman", serif',
  'system-ui, -apple-system, sans-serif',
  'conceptual',
  E'Tone: clear, direct, no fluff. Sentence-level concrete.\nAvoid: marketing-speak, hedging ("perhaps", "might be worth"), filler intros ("In today''s fast-paced…").\nPrefer: concrete examples over abstractions; short paragraphs; second-person ("you") over first-person plural ("we").'
);
