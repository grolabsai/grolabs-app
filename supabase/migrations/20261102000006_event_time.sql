-- Event time: keep the shopper's clock, not the drain's (R-33).
--
-- The defect, found 2026-11-02 while tracing event semantics end to end
-- (docs/state/event-semantics-trace.md, F-3): nothing on the wire carried a
-- time. The storefront stamped event_id / kind / seq / session_id and no
-- timestamp; event_inbox recorded only received_at; and the drain's inserts
-- omitted created_at, so it took the column default -- now() AT DRAIN TIME.
--
-- Why that is worse than it sounds. `created_at` is not decoration:
--   * session_assignment splits sessions on a gap of more than 30 minutes
--     between consecutive created_at values. Stamp a whole batch at one
--     instant and every gap inside it disappears -- a visit with a real
--     45-minute break becomes one session.
--   * instance_day(instance_id, created_at) decides which store-local day a
--     KPI lands on. With the retry queue holding events across page views,
--     a shopper's Monday evening could be counted on Wednesday.
--   * time_to_first_click is a difference between two of them, so it trends
--     toward zero.
-- None of this fails loudly. It produces plausible numbers that are wrong,
-- which is the expensive kind.
--
-- The fix is an AGE, not a timestamp. The storefront reports how long ago the
-- event happened (age_ms); the receiver computes occurred_at = received_at -
-- age_ms against our own clock. Both readings behind that age come from the
-- device's clock, so the device's error cancels and a phone set to the wrong
-- year still reports a correct age. An absolute client timestamp would have
-- imported every broken clock on the internet into the KPI series.
--
-- Deliberately NOT backfilled. Rows written before this migration carry drain
-- time and there is no way to recover what they should have said -- the
-- information was never sent. The discontinuity is dated here, the same way
-- v0.9.0's page-relative click positions are dated in event-tracking.md R-4.
-- Historical session and day figures are approximations; later ones are not.

alter table public.event_inbox
  add column if not exists occurred_at timestamptz;

comment on column public.event_inbox.occurred_at is
  'When the shopper did it: received_at minus the client-reported age_ms, anchored to our clock (R-33). NULL from a client too old to report an age, in which case the drain falls back to received_at. Never a raw client timestamp -- a wrong device clock must not reach the KPI series.';

comment on column public.event_inbox.received_at is
  'When the batch reached us. Was the only time this table held, which is why created_at on the destination rows used to mean "when the drain ran" (R-33).';
