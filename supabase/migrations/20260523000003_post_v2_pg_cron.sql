-- Blog v2 — scheduled publish via Supabase pg_cron, not Vercel cron.
--
-- Why: Vercel Hobby tier only allows daily crons. Scheduled posts need
-- ~5-minute granularity (you scheduled "3pm today", not "tomorrow at
-- 7am"). pg_cron runs inside Postgres at no extra cost and any
-- frequency.
--
-- The /api/v1/blog/publish-due route stays in the codebase as a manual
-- trigger / debug surface, but it is no longer wired to vercel.json.

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'blog-publish-due',
  '*/5 * * * *',
  $$select public.publish_due_posts();$$
);
