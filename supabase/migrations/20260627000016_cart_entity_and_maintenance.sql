-- Cart as a first-class ENTITY with an explicit status, maintained from the
-- event deltas (DEC-2). Keyed (instance_id, cart_id). recompute_cart folds a
-- cart's deltas (per-product qty since last remove × catalog price); triggers
-- keep it current from BOTH events and orders (source-agnostic).
create table if not exists public.cart (
  instance_id    bigint      not null references public.instance(instance_id) on delete cascade,
  cart_id        text        not null,
  status         text        not null default 'open'
                 check (status in ('open','completed','abandoned','recovered')),
  value          numeric     not null default 0,
  item_count     integer     not null default 0,
  total_quantity integer     not null default 0,
  user_id        text,
  account_id     text,
  order_id       text,
  source         text        not null default 'woocommerce',
  created_at     timestamptz not null default now(),
  last_event_at  timestamptz not null default now(),
  completed_at   timestamptz,
  primary key (instance_id, cart_id)
);

comment on table public.cart is
  'First-class cart entity with a lifecycle status, computed from analytics_event deltas via recompute_cart() + triggers. open → completed (order matched on cart_id) → abandoned/recovered. Source-agnostic.';

create index if not exists cart_instance_status_age_idx on public.cart (instance_id, status, last_event_at);

alter table public.cart enable row level security;
create policy cart_member_read on public.cart
  for select to authenticated
  using (exists (select 1 from public.instance_member im
                 where im.instance_id = cart.instance_id and im.user_id = auth.uid()));

create or replace function public.recompute_cart(p_instance bigint, p_cart_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz; v_last timestamptz;
  v_user text; v_account text;
  v_value numeric := 0; v_items int := 0; v_qty int := 0;
  v_order_id text; v_completed timestamptz; v_status text;
begin
  select min(created_at), max(created_at),
         max(user_id)    filter (where user_id is not null),
         max(account_id) filter (where account_id is not null)
    into v_created, v_last, v_user, v_account
  from analytics_event
  where instance_id = p_instance and cart_id = p_cart_id;

  if v_created is null then return; end if;

  with adds as (
    select object_id, quantity, created_at
    from analytics_event
    where instance_id = p_instance and cart_id = p_cart_id
      and event_name in ('Added to cart','Added to cart from PDP','Added to cart from PLP')
  ),
  removes as (
    select object_id, max(created_at) as last_remove
    from analytics_event
    where instance_id = p_instance and cart_id = p_cart_id and event_name = 'Removed from cart'
    group by object_id
  ),
  qtys as (
    select a.object_id, sum(coalesce(a.quantity,1)) as qty
    from adds a
    left join removes r on r.object_id = a.object_id
    where a.created_at > coalesce(r.last_remove, '-infinity'::timestamptz)
    group by a.object_id
  ),
  priced as (
    select q.qty, coalesce(p.sale_price, p.price, 0) as unit
    from qtys q
    left join product p on p.instance_id = p_instance
      and p.woocommerce_id = (case when q.object_id ~ '^[0-9]+$' then q.object_id::bigint else null end)
    where q.qty > 0
  )
  select coalesce(sum(unit*qty),0), count(*), coalesce(sum(qty),0)
    into v_value, v_items, v_qty
  from priced;

  select so.order_id, so.created_at into v_order_id, v_completed
  from sales_order so
  where so.instance_id = p_instance and so.cart_id = p_cart_id
  order by so.created_at desc limit 1;

  if v_order_id is null then
    select order_id, created_at into v_order_id, v_completed
    from analytics_event
    where instance_id = p_instance and cart_id = p_cart_id
      and event_name = 'Completed order' and order_id is not null
    order by created_at desc limit 1;
  end if;

  v_status := case when v_order_id is not null then 'completed' else 'open' end;

  insert into cart (instance_id, cart_id, status, value, item_count, total_quantity,
                    user_id, account_id, order_id, created_at, last_event_at, completed_at)
  values (p_instance, p_cart_id, v_status, v_value, v_items, v_qty,
          v_user, v_account, v_order_id, v_created, v_last, v_completed)
  on conflict (instance_id, cart_id) do update set
    status         = excluded.status,
    value          = excluded.value,
    item_count     = excluded.item_count,
    total_quantity = excluded.total_quantity,
    user_id        = coalesce(excluded.user_id, cart.user_id),
    account_id     = coalesce(excluded.account_id, cart.account_id),
    order_id       = coalesce(excluded.order_id, cart.order_id),
    created_at     = least(cart.created_at, excluded.created_at),
    last_event_at  = greatest(cart.last_event_at, excluded.last_event_at),
    completed_at   = coalesce(excluded.completed_at, cart.completed_at);
end; $$;

create or replace function public.trg_cart_from_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.cart_id is not null then perform public.recompute_cart(NEW.instance_id, NEW.cart_id); end if;
  return NEW;
end; $$;
drop trigger if exists cart_from_event on public.analytics_event;
create trigger cart_from_event after insert on public.analytics_event
  for each row execute function public.trg_cart_from_event();

create or replace function public.trg_cart_from_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.cart_id is not null then perform public.recompute_cart(NEW.instance_id, NEW.cart_id); end if;
  return NEW;
end; $$;
drop trigger if exists cart_from_order on public.sales_order;
create trigger cart_from_order after insert or update on public.sales_order
  for each row execute function public.trg_cart_from_order();
