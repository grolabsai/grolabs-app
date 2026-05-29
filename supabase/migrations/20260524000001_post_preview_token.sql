-- Draft preview URLs — share an unpublished post with reviewers via a
-- random token, no auth required.
--
-- Adds a `preview_token` column on `post`. The `/blog/preview/[token]`
-- public route looks up by token (any status), which lets the writer
-- share a draft externally before publishing. The token is set on
-- insert via the column default; if a writer wants to invalidate an
-- already-shared link (or rotate after a leak), they can null it
-- and the trigger regenerates on the next update.
--
-- RLS: the public preview route uses service-role; the token itself
-- is the gate (16 random bytes encoded as 22 url-safe chars). No
-- new policy needed.

create extension if not exists pgcrypto;

alter table public.post
  add column preview_token text not null default replace(replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_'), '=', '');

create unique index post_preview_token_unique on public.post (preview_token);

-- Backfill any pre-existing rows that somehow lack a token (shouldn't
-- happen — the column is NOT NULL with a default — but be defensive).
update public.post
   set preview_token = replace(replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_'), '=', '')
 where preview_token is null or preview_token = '';
