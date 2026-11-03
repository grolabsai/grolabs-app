-- Record the reformulation, not just the intent (F-1).
--
-- Found 2026-11-02 tracing event semantics (docs/state/event-semantics-trace.md).
-- `intent_group_id` existed, but assignIntent compared stem SETS for exact
-- equality, which groups none of the four reformulation types the grammar
-- defines (conversion-measurement-foundations.md §3):
--
--   correcting  "snwoboard"          -> "snowboard"           NEW intent
--   narrowing   "snowboard"          -> "complete snowboard"  NEW intent
--   broadening  "ski wax"            -> "wax"                 NEW intent
--   lateral     "ski wax"            -> "snowboard wax"        NEW intent
--
-- Only non-reformulations grouped -- plurals, word order, accents. So the
-- column was in effect a normalised query. Measured on live data before the
-- change: in every user-day in query_log, distinct intents equalled distinct
-- queries; grouping had never collapsed anything.
--
-- Two consequences this migration closes:
--
--   1. `reformulation_rate` (intents needing >=1 rewrite / intents) returned a
--      confident ~0 rather than failing, because every intent held exactly one
--      query. A wrong number that looks right.
--   2. The reformulation TYPE was computed nowhere and stored nowhere, so the
--      Demand-Interpretation agent had no pairs to classify and the synonym
--      candidate generator (every lateral chain ending in success) had no
--      input. There was no `previous_query` either, so the pairs could only be
--      re-derived from row ordering -- which needs the grouping to be right in
--      the first place.
--
-- `previous_query` is the query this one was judged against, not simply the one
-- before it: a chain is built link by link, so the pair stored here is the pair
-- the classification actually describes.
--
-- NOT backfilled. The type is a function of a pair, and historical rows were
-- grouped one-query-per-intent, so there are no pairs to recover. Intents
-- recorded before this migration are query-grained; after it they are
-- demand-grained. Dated here, as v0.9.0's page-relative click positions are
-- dated in event-tracking.md R-4. Any series crossing this date mixes two
-- meanings of "intent" and should be read from it forward.

alter table public.query_log
  add column if not exists reformulation_type text,
  add column if not exists previous_query     text;

-- The classifier's whole vocabulary. A value outside it is a bug, not data:
-- the four types each prescribe a different merchant remedy, so an unknown
-- fifth label would be acted on as though it meant something.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'query_log_reformulation_type_check'
  ) then
    alter table public.query_log
      add constraint query_log_reformulation_type_check
      check (reformulation_type is null or reformulation_type in
             ('same','correcting','narrowing','broadening','lateral'));
  end if;
end $$;

comment on column public.query_log.reformulation_type is
  'How this query rewrites previous_query, within one intent: correcting (typo -> typo tolerance) | narrowing (adds criteria -> faceting) | broadening (removes criteria) | lateral (swaps descriptors -> SYNONYM candidate). ''same'' is a restatement, not a rewrite, and must not count toward reformulation depth. NULL = this query opened the intent, or predates 20261102000007.';

comment on column public.query_log.previous_query is
  'The query this one was classified against -- the other half of the pair reformulation_type describes. NULL when this query opened its intent.';

comment on column public.query_log.intent_group_id is
  'One expressed DEMAND, spanning its reformulations. Bounded to 30 minutes to match session_assignment, so an intent cannot outlive its session. Assigned to committed searches only -- a typeahead probe counts for nothing and must not mint the id a committed search inherits. Query-grained before 20261102000007, demand-grained after.';

-- Reading a chain: every rewrite in one demand, in order.
create index if not exists query_log_intent_chain
  on public.query_log (instance_id, intent_group_id, created_at)
  where intent_group_id is not null;
