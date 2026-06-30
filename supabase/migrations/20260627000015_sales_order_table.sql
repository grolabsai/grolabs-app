-- Orders as an ENTITY (not events): keyed on (instance_id, order_id) so the same
-- order can never be double-counted, regardless of source (WooCommerce or our SDK).
-- Ingestion upserts on the key (idempotent). Revenue KPIs read from here.
-- "order" is a reserved word → sales_order.
create table if not exists public.sales_order (
  instance_id     bigint      not null references public.instance(instance_id) on delete cascade,
  order_id        text        not null,                 -- the platform's order id (the key)
  amount          numeric     not null default 0,       -- net product revenue (line totals, ex-tax/shipping, post-discount)
  currency        text        not null default 'USD',
  item_count      integer,                              -- number of line-item rows
  total_quantity  integer,                              -- total units across lines
  user_id         text,                                 -- anonymous browser id
  account_id      text,                                 -- hashed customer identity (login OR billing-email hash); null only if neither is available
  cart_id         text,                                 -- the cart this order came from
  source          text        not null default 'woocommerce',  -- woocommerce | sdk | ...
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (instance_id, order_id)
);

comment on table public.sales_order is
  'Canonical order entity keyed on (instance_id, order_id). Idempotent upsert target for WooCommerce + SDK. Source of truth for revenue (amount), distinct from the analytics_event behavioral log.';

create index if not exists sales_order_instance_account_idx on public.sales_order (instance_id, account_id);
create index if not exists sales_order_instance_created_idx on public.sales_order (instance_id, created_at);

alter table public.sales_order enable row level security;

create policy sales_order_member_read on public.sales_order
  for select to authenticated
  using (exists (
    select 1 from public.instance_member im
    where im.instance_id = sales_order.instance_id and im.user_id = auth.uid()
  ));

-- writes are service-role only (ingestion endpoints); service_role bypasses RLS.
