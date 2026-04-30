-- ============================================================================
-- Funnel Flow Map — RLS policies
-- ----------------------------------------------------------------------------
-- Two policy shapes:
--
--   SHARED tables (funnel_flow, funnel_stage, funnel_transition,
--                  funnel_friction_point):
--     · authenticated users may SELECT all rows
--     · only service_role may INSERT/UPDATE/DELETE
--
--   PER-TENANT tables (funnel_instance, funnel_dataset,
--                      funnel_dataset_transition_value,
--                      funnel_benchmark_source, funnel_friction_finding):
--     · authenticated SELECT: instance_id = 0 (templates) OR membership
--     · authenticated INSERT/UPDATE/DELETE: only own instances (no template
--       fallthrough — templates are read-only via RLS; service_role bypasses)
--
-- Role-gating
-- ----------------------------------------------------------------------------
-- The conventions doc reserves a future role-based check (owner/editor/viewer)
-- on instance_member.role. Until that lands, write policies authorise any
-- member of the instance. Tighten when role-gating ships.
-- ============================================================================

-- ─── Shared tables ──────────────────────────────────────────────────────────

alter table funnel_flow            enable row level security;
alter table funnel_stage           enable row level security;
alter table funnel_transition      enable row level security;
alter table funnel_friction_point  enable row level security;

drop policy if exists shared_read_all_authenticated on funnel_flow;
create policy shared_read_all_authenticated on funnel_flow
  for select to authenticated
  using (true);

drop policy if exists shared_write_service_role_only on funnel_flow;
create policy shared_write_service_role_only on funnel_flow
  for all to service_role
  using (true) with check (true);

drop policy if exists shared_read_all_authenticated on funnel_stage;
create policy shared_read_all_authenticated on funnel_stage
  for select to authenticated
  using (true);

drop policy if exists shared_write_service_role_only on funnel_stage;
create policy shared_write_service_role_only on funnel_stage
  for all to service_role
  using (true) with check (true);

drop policy if exists shared_read_all_authenticated on funnel_transition;
create policy shared_read_all_authenticated on funnel_transition
  for select to authenticated
  using (true);

drop policy if exists shared_write_service_role_only on funnel_transition;
create policy shared_write_service_role_only on funnel_transition
  for all to service_role
  using (true) with check (true);

drop policy if exists shared_read_all_authenticated on funnel_friction_point;
create policy shared_read_all_authenticated on funnel_friction_point
  for select to authenticated
  using (true);

drop policy if exists shared_write_service_role_only on funnel_friction_point;
create policy shared_write_service_role_only on funnel_friction_point
  for all to service_role
  using (true) with check (true);

-- ─── Per-tenant tables ──────────────────────────────────────────────────────

alter table funnel_instance                    enable row level security;
alter table funnel_dataset                     enable row level security;
alter table funnel_dataset_transition_value    enable row level security;
alter table funnel_benchmark_source            enable row level security;
alter table funnel_friction_finding            enable row level security;

-- funnel_instance ------------------------------------------------------------

drop policy if exists tenant_read on funnel_instance;
create policy tenant_read on funnel_instance
  for select to authenticated
  using (
    instance_id = 0
    or instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

drop policy if exists tenant_write_all on funnel_instance;
create policy tenant_write_all on funnel_instance
  for all to authenticated
  using (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  )
  with check (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

-- funnel_dataset -------------------------------------------------------------

drop policy if exists tenant_read on funnel_dataset;
create policy tenant_read on funnel_dataset
  for select to authenticated
  using (
    instance_id = 0
    or instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

drop policy if exists tenant_write_all on funnel_dataset;
create policy tenant_write_all on funnel_dataset
  for all to authenticated
  using (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  )
  with check (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

-- funnel_dataset_transition_value --------------------------------------------

drop policy if exists tenant_read on funnel_dataset_transition_value;
create policy tenant_read on funnel_dataset_transition_value
  for select to authenticated
  using (
    instance_id = 0
    or instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

drop policy if exists tenant_write_all on funnel_dataset_transition_value;
create policy tenant_write_all on funnel_dataset_transition_value
  for all to authenticated
  using (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  )
  with check (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

-- funnel_benchmark_source ----------------------------------------------------

drop policy if exists tenant_read on funnel_benchmark_source;
create policy tenant_read on funnel_benchmark_source
  for select to authenticated
  using (
    instance_id = 0
    or instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

drop policy if exists tenant_write_all on funnel_benchmark_source;
create policy tenant_write_all on funnel_benchmark_source
  for all to authenticated
  using (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  )
  with check (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

-- funnel_friction_finding ----------------------------------------------------

drop policy if exists tenant_read on funnel_friction_finding;
create policy tenant_read on funnel_friction_finding
  for select to authenticated
  using (
    instance_id = 0
    or instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );

drop policy if exists tenant_write_all on funnel_friction_finding;
create policy tenant_write_all on funnel_friction_finding
  for all to authenticated
  using (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  )
  with check (
    instance_id in (
      select instance_id from instance_member where user_id = auth.uid()
    )
  );
