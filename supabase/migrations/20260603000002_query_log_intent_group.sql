-- PostHog Analytics MVP — Prompt 5 (intent skeleton).
--
-- A "search journey" is a run of consecutive queries from one anonymous session
-- that mean roughly the same thing ("running shoe" -> "running shoes" -> "trail
-- running shoe"). intent_group_id labels that run so the analytics layer can
-- count distinct *intents* instead of distinct keystrokes.
--
-- This is structure-over-accuracy: the id is assigned by a cheap head-noun/stem
-- heuristic in assignIntent() (src/lib/analytics/intent.ts), NOT by embeddings.
-- Embeddings are deferred. The column is nullable + backfill-free — older rows
-- and any search without a session simply stay NULL.

ALTER TABLE public.query_log
  ADD COLUMN IF NOT EXISTS intent_group_id text NULL;

-- The heuristic groups within (instance_id, user_id); index that lookup so the
-- per-session "recent queries" read the log path does stays cheap.
CREATE INDEX IF NOT EXISTS query_log_instance_user_intent_idx
  ON public.query_log (instance_id, user_id, intent_group_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.query_log.intent_group_id IS
  'Heuristic search-intent label (head-noun/stem) grouping consecutive same-meaning queries from one anonymous session. Assigned by src/lib/analytics/intent.ts. NULL when no session id or no prior context. Embeddings deferred.';

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260603000002',
  'PostHog Analytics MVP P5: add intent_group_id to query_log (+ partial index on instance_id, user_id, intent_group_id)'
)
ON CONFLICT (version) DO NOTHING;
