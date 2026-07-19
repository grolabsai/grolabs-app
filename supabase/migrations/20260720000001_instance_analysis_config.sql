-- Per-instance analysis configuration (design session 2026-07-19/20).
-- The DEFAULT carries the ratified presets, so every NEW instance is born
-- configured; existing rows were backfilled by the ADD COLUMN default.
-- Keys: week_end_day (analysis weeks end on this day) · delta_threshold_pct
-- (confirmed decline >= this -> red stroke, below -> yellow) ·
-- min_weekly_denominator (rates with fewer weekly events show counts) ·
-- baseline_weeks (weeks defining "normal") · metric_goals {metric_key:
-- {target, lower_threshold}} — the intentional band per metric (empty preset:
-- targets are business numbers users set; statistical band is the fallback).
-- Applied to production via Supabase MCP on 2026-07-19 and verified.

ALTER TABLE public.instance
  ADD COLUMN IF NOT EXISTS analysis_config jsonb NOT NULL DEFAULT
  '{"week_end_day":"sunday","delta_threshold_pct":5,"min_weekly_denominator":30,"baseline_weeks":8,"metric_goals":{}}'::jsonb;
