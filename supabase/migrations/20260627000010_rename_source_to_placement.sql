-- The unused `source` column on analytics_event becomes `placement`: the on-site
-- surface a product interaction came from (pdp / plp / search_results / related /
-- a raw block heading / ...). Replaces the old two-name add-to-cart split.
alter table public.analytics_event rename column source to placement;

comment on column public.analytics_event.placement is
  'On-site surface a product interaction originated from (pdp, plp, search_results, related, upsell, cross_sell, or a raw merchant block heading). Free dimension; canonical grouping happens in the analysis layer.';
