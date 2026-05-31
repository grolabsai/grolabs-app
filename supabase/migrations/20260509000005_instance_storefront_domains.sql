-- Add storefront_domains to instance for search API origin validation.
--
-- Per docs/policy/search-foundations.md (Stage 0): the token-issuing endpoint
-- and (Stage 1) the search proxy endpoint validate the request's Origin header
-- against this list. Domains are stored as bare hostnames without scheme,
-- e.g. "shop.wazu.gt" — the comparison strips scheme and port from the
-- incoming Origin before checking membership.
--
-- Default empty array means a freshly-created instance is locked down by
-- default (token endpoint will return 403 until at least one domain is
-- registered).

alter table public.instance
  add column storefront_domains text[] not null default '{}'::text[];

comment on column public.instance.storefront_domains is
  'Bare hostnames authorized to call RRE search APIs for this instance. Validated against request Origin header. Per docs/policy/search-foundations.md.';
