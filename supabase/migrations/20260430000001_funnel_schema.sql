-- ============================================================================
-- Funnel Flow Map — schema
-- ----------------------------------------------------------------------------
-- Companion documents:
--   docs/funnel/spec.md            — product spec (formulas, visual rules)
--   docs/funnel/prototype.tsx.reference
--                                  — interaction/highlight reference
--
-- Sharing model
-- ----------------------------------------------------------------------------
--   SHARED (no instance_id; read-all for authenticated, writes service_role only):
--     funnel_flow, funnel_stage, funnel_transition, funnel_friction_point
--   PER-TENANT (instance_id required; RLS via instance_member + template
--               fallthrough on instance_id = 0):
--     funnel_instance, funnel_dataset, funnel_dataset_transition_value,
--     funnel_benchmark_source, funnel_friction_finding
--
-- Multi-tenancy
-- ----------------------------------------------------------------------------
--   instance_id is denormalised onto every per-tenant table for cheap RLS
--   and indexable lookups. App code does NOT pass instance_id when inserting
--   into child tables — a BEFORE INSERT/UPDATE trigger derives it from the
--   parent FK, so child.instance_id is authoritative-by-derivation.
--
-- Same-flow constraint
-- ----------------------------------------------------------------------------
--   Every funnel_transition's source and target funnel_stage must belong to
--   the same funnel_flow. Enforced by composite FK against
--   funnel_stage(funnel_flow_id, funnel_stage_id) — no trigger needed.
--
-- TODO (Phase 3+)
-- ----------------------------------------------------------------------------
--   clone_funnel_instance_from_template(p_template_funnel_instance_id,
--                                       p_target_instance_id, p_industry)
--                                       returns bigint
--   SECURITY DEFINER RPC that copies a template funnel_instance + its active
--   funnel_dataset + funnel_dataset_transition_values to a customer instance.
--   Needed for copy-on-signup. Deferred until customer flow lands.
-- ============================================================================

-- ─── Enums ──────────────────────────────────────────────────────────────────

do $$ begin
  create type funnel_instance_type as enum ('template', 'customer', 'scenario');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type funnel_severity as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type funnel_source_type as enum (
    'benchmark', 'customer_actual', 'manual_estimate', 'api_extraction'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type funnel_transition_type as enum ('forward', 'dropoff', 'backward');
exception when duplicate_object then null;
end $$;

-- ─── Shared tables ──────────────────────────────────────────────────────────

create table if not exists funnel_flow (
  funnel_flow_id  bigint generated always as identity primary key,
  slug            text unique not null,
  name            text not null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists funnel_stage (
  funnel_stage_id  bigint generated always as identity primary key,
  funnel_flow_id   bigint not null
                   references funnel_flow(funnel_flow_id) on delete cascade,
  slug             text not null,
  label            text not null,
  stage_order      int,
  color            text,
  position_x       numeric not null default 0,
  position_y       numeric not null default 0,
  icon_key         text,
  is_terminal      boolean not null default false,
  is_dropoff       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (funnel_flow_id, slug),
  -- Required so the composite FK from funnel_transition is valid.
  unique (funnel_flow_id, funnel_stage_id)
);

create index if not exists funnel_stage_funnel_flow_id_idx
  on funnel_stage (funnel_flow_id);

create table if not exists funnel_transition (
  funnel_transition_id  bigint generated always as identity primary key,
  funnel_flow_id        bigint not null,
  source_stage_id       bigint not null,
  target_stage_id       bigint not null,
  slug                  text not null,
  transition_type       funnel_transition_type not null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Composite FKs ensure both endpoints belong to the same flow.
  foreign key (funnel_flow_id, source_stage_id)
    references funnel_stage (funnel_flow_id, funnel_stage_id)
    on delete cascade,
  foreign key (funnel_flow_id, target_stage_id)
    references funnel_stage (funnel_flow_id, funnel_stage_id)
    on delete cascade,

  check (source_stage_id <> target_stage_id),
  unique (funnel_flow_id, source_stage_id, target_stage_id),
  unique (funnel_flow_id, slug)
);

create index if not exists funnel_transition_funnel_flow_id_idx
  on funnel_transition (funnel_flow_id);
create index if not exists funnel_transition_source_stage_id_idx
  on funnel_transition (source_stage_id);
create index if not exists funnel_transition_target_stage_id_idx
  on funnel_transition (target_stage_id);

create table if not exists funnel_friction_point (
  funnel_friction_point_id  bigint generated always as identity primary key,
  funnel_stage_id           bigint not null
                            references funnel_stage(funnel_stage_id)
                            on delete cascade,
  slug                      text unique not null,
  name                      text not null,
  description               text,
  category                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists funnel_friction_point_funnel_stage_id_idx
  on funnel_friction_point (funnel_stage_id);

-- ─── Per-tenant tables ──────────────────────────────────────────────────────

create table if not exists funnel_instance (
  funnel_instance_id    bigint generated always as identity primary key,
  instance_id           bigint not null
                        references instance(instance_id),
  funnel_flow_id        bigint not null
                        references funnel_flow(funnel_flow_id),
  slug                  text not null,
  name                  text not null,
  funnel_instance_type  funnel_instance_type not null,
  industry              text,
  monthly_traffic       numeric not null default 10000
                        check (monthly_traffic >= 0),
  average_order_value   numeric not null default 100
                        check (average_order_value >= 0),
  average_cart_skus     numeric not null default 2
                        check (average_cart_skus >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (instance_id, slug)
);

create index if not exists funnel_instance_instance_id_idx
  on funnel_instance (instance_id);
create index if not exists funnel_instance_funnel_flow_id_idx
  on funnel_instance (funnel_flow_id);

create table if not exists funnel_dataset (
  funnel_dataset_id     bigint generated always as identity primary key,
  instance_id           bigint not null,           -- denorm; trigger-derived
  funnel_instance_id    bigint not null
                        references funnel_instance(funnel_instance_id)
                        on delete cascade,
  funnel_flow_id        bigint not null
                        references funnel_flow(funnel_flow_id),
  slug                  text not null,
  name                  text not null,
  description           text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (funnel_instance_id, slug)
);

-- Exactly one active dataset per funnel_instance. Many inactive ones allowed
-- (history, A/B scenarios) without a schema rewrite.
create unique index if not exists funnel_dataset_one_active_per_instance
  on funnel_dataset (funnel_instance_id)
  where is_active = true;

create index if not exists funnel_dataset_funnel_instance_id_idx
  on funnel_dataset (funnel_instance_id);
create index if not exists funnel_dataset_instance_id_idx
  on funnel_dataset (instance_id);

create table if not exists funnel_dataset_transition_value (
  funnel_dataset_transition_value_id  bigint generated always as identity primary key,
  instance_id                         bigint not null, -- denorm; trigger-derived
  funnel_dataset_id                   bigint not null
                                      references funnel_dataset(funnel_dataset_id)
                                      on delete cascade,
  funnel_transition_id                bigint not null
                                      references funnel_transition(funnel_transition_id)
                                      on delete cascade,
  conversion_pct                      numeric not null
                                      check (conversion_pct >= 0
                                             and conversion_pct <= 100),
  source_type                         funnel_source_type not null
                                      default 'manual_estimate',
  notes                               text,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  unique (funnel_dataset_id, funnel_transition_id)
);

create index if not exists funnel_dataset_transition_value_dataset_id_idx
  on funnel_dataset_transition_value (funnel_dataset_id);
create index if not exists funnel_dataset_transition_value_transition_id_idx
  on funnel_dataset_transition_value (funnel_transition_id);
create index if not exists funnel_dataset_transition_value_instance_id_idx
  on funnel_dataset_transition_value (instance_id);

create table if not exists funnel_benchmark_source (
  funnel_benchmark_source_id          bigint generated always as identity primary key,
  instance_id                         bigint not null, -- denorm; trigger-derived
  funnel_dataset_transition_value_id  bigint not null
                                      references funnel_dataset_transition_value(funnel_dataset_transition_value_id)
                                      on delete cascade,
  title                               text not null,
  url                                 text,
  source_name                         text,
  notes                               text,
  observed_value                      numeric,
  confidence_score                    numeric
                                      check (confidence_score is null
                                             or (confidence_score >= 0
                                                 and confidence_score <= 1)),
  created_at                          timestamptz not null default now()
);

create index if not exists funnel_benchmark_source_value_id_idx
  on funnel_benchmark_source (funnel_dataset_transition_value_id);
create index if not exists funnel_benchmark_source_instance_id_idx
  on funnel_benchmark_source (instance_id);

create table if not exists funnel_friction_finding (
  funnel_friction_finding_id  bigint generated always as identity primary key,
  instance_id                 bigint not null,        -- denorm; trigger-derived
  funnel_instance_id          bigint not null
                              references funnel_instance(funnel_instance_id)
                              on delete cascade,
  funnel_friction_point_id    bigint not null
                              references funnel_friction_point(funnel_friction_point_id)
                              on delete cascade,
  slug                        text,
  severity                    funnel_severity not null default 'medium',
  evidence                    text not null,
  source_system               text,
  observed_at                 date,
  source_payload              jsonb,
  created_at                  timestamptz not null default now(),
  unique (funnel_instance_id, slug)
);

create index if not exists funnel_friction_finding_funnel_instance_id_idx
  on funnel_friction_finding (funnel_instance_id);
create index if not exists funnel_friction_finding_friction_point_id_idx
  on funnel_friction_finding (funnel_friction_point_id);
create index if not exists funnel_friction_finding_instance_id_idx
  on funnel_friction_finding (instance_id);

-- ─── instance_id derivation triggers ────────────────────────────────────────
-- App code MUST NOT pass instance_id to child tables. The triggers below
-- derive it from the parent FK so the denorm column is authoritative.

create or replace function funnel_dataset_set_instance_id()
returns trigger
language plpgsql
as $$
declare
  v_instance_id bigint;
begin
  select instance_id into v_instance_id
  from funnel_instance
  where funnel_instance_id = new.funnel_instance_id;

  if v_instance_id is null then
    raise exception 'funnel_instance % not found', new.funnel_instance_id
      using errcode = 'foreign_key_violation';
  end if;

  new.instance_id := v_instance_id;
  return new;
end $$;

drop trigger if exists funnel_dataset_set_instance_id_trg on funnel_dataset;
create trigger funnel_dataset_set_instance_id_trg
  before insert or update of funnel_instance_id on funnel_dataset
  for each row execute function funnel_dataset_set_instance_id();

create or replace function funnel_dataset_transition_value_set_instance_id()
returns trigger
language plpgsql
as $$
declare
  v_instance_id bigint;
begin
  select instance_id into v_instance_id
  from funnel_dataset
  where funnel_dataset_id = new.funnel_dataset_id;

  if v_instance_id is null then
    raise exception 'funnel_dataset % not found', new.funnel_dataset_id
      using errcode = 'foreign_key_violation';
  end if;

  new.instance_id := v_instance_id;
  return new;
end $$;

drop trigger if exists funnel_dataset_transition_value_set_instance_id_trg
  on funnel_dataset_transition_value;
create trigger funnel_dataset_transition_value_set_instance_id_trg
  before insert or update of funnel_dataset_id on funnel_dataset_transition_value
  for each row execute function funnel_dataset_transition_value_set_instance_id();

create or replace function funnel_benchmark_source_set_instance_id()
returns trigger
language plpgsql
as $$
declare
  v_instance_id bigint;
begin
  select instance_id into v_instance_id
  from funnel_dataset_transition_value
  where funnel_dataset_transition_value_id = new.funnel_dataset_transition_value_id;

  if v_instance_id is null then
    raise exception 'funnel_dataset_transition_value % not found',
      new.funnel_dataset_transition_value_id
      using errcode = 'foreign_key_violation';
  end if;

  new.instance_id := v_instance_id;
  return new;
end $$;

drop trigger if exists funnel_benchmark_source_set_instance_id_trg
  on funnel_benchmark_source;
create trigger funnel_benchmark_source_set_instance_id_trg
  before insert or update of funnel_dataset_transition_value_id
  on funnel_benchmark_source
  for each row execute function funnel_benchmark_source_set_instance_id();

create or replace function funnel_friction_finding_set_instance_id()
returns trigger
language plpgsql
as $$
declare
  v_instance_id bigint;
begin
  select instance_id into v_instance_id
  from funnel_instance
  where funnel_instance_id = new.funnel_instance_id;

  if v_instance_id is null then
    raise exception 'funnel_instance % not found', new.funnel_instance_id
      using errcode = 'foreign_key_violation';
  end if;

  new.instance_id := v_instance_id;
  return new;
end $$;

drop trigger if exists funnel_friction_finding_set_instance_id_trg
  on funnel_friction_finding;
create trigger funnel_friction_finding_set_instance_id_trg
  before insert or update of funnel_instance_id on funnel_friction_finding
  for each row execute function funnel_friction_finding_set_instance_id();
