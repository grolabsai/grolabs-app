---
application: core-app
module: Funnel
title: "Funnel Flow Map — Production Spec for Next.js"
status: Draft
owner: "Tuncho"
scope: "The production implementation for the Funnel Flow Map — a React Flow visualization that models, analyzes, and simulates e-commerce funnels. Defines the domain entities (flow/stage/transition/instance/dataset/friction), the visual language and highlight rules, the reach/conversion/revenue formulas, the schema, the seed flow (17 stages, 44 transitions, 3 industry templates), and validation rules."
audience: "Anyone implementing or maintaining the funnel canvas, its computeModel/revenue logic, or its maintenance CRUD screens."

actors:
  - name: Flow
    type: system
    definition: A reusable graph definition (flow_ecommerce_standard) containing stages and transitions. Every flow must have traffic, purchase, and drop-off.
  - name: Stage
    type: system
    definition: A node in the diagram (Traffic, Homepage, PDP, Cart, Checkout, Purchase, Drop-off, ...). May be terminal (purchase) or a drop-off sink.
  - name: Transition
    type: system
    definition: A directed edge between stages, typed forward / dropoff / backward(rework) / standard. Carries a per-dataset conversion percentage of its source stage.
  - name: Instance
    type: system
    definition: 'A customer, tenant, scenario, or template using a flow + dataset. Holds monthly_traffic, average_order_value, and average_cart_skus (default 2.0). Three seeded templates: jewelry, clothing, electronics.'
  - name: Dataset
    type: system
    definition: The set of transition conversion values and assumptions for one flow/instance. Seeded as one benchmark dataset per industry template (132 = 44 transitions × 3).
  - name: Friction Point / Finding
    type: system
    definition: A known UX/business issue on a stage (friction point) and concrete severity-rated evidence of it (friction finding), backed by benchmark sources for conversion values.

users:
  - name: Analyst / operator
    description: Hovers/clicks stages to trace forward paths, edits conversion values and assumptions, and manages flows/stages/transitions/instances/datasets/friction via the nine DB-backed maintenance screens.

integrations:
  - name: "@xyflow/react (React Flow)"
    kind: external-service
    target: Funnel canvas
    direction: out
    purpose: Renders the diagram (nodes, smart edges, Controls, MiniMap); highlighted transitions animate; the dotted background is intentionally not rendered.
  - name: PostgreSQL / Supabase
    kind: external-service
    target: flows, stages, transitions, instances, datasets, dataset_transition_values, benchmark_sources, friction_points, friction_findings
    direction: both
    purpose: Stores the graph definition, per-dataset values, and friction evidence. Live schema at supabase/migrations/20260430000001_funnel_schema.sql (the spec's SQL block is historical).

rules:
  - id: R-1
    statement: Transition color encodes meaning — green forward (value/progress), red drop-off (loss), gray backward/rework (friction), light gray not-highlighted (context). Highlighted forward transitions are 3.5px; all others 1.15px. Highlighted transitions animate; the React Flow background dots are not rendered.
    truth: true
    rationale: §"visual language" + thickness/animation/background. Product rules remain canonical even though the SQL block is historical.
  - id: R-2
    statement: Hovering/clicking a stage highlights it, its incoming transitions + immediate sources, its outgoing transitions + immediate targets, and then continues only along forward paths until purchase — never expanding through backward/rework or drop-off transitions; everything else stays faded. Hovering a transition highlights only that edge, its two stages, and its percentage label.
    truth: true
    rationale: §"UI highlight rules".
  - id: R-3
    statement: A transition value is a percentage of its source stage; a stage's reach is the cumulative percentage of original traffic reaching it; downstream_conversion = purchase_reach / selected_stage_reach (purchase=100%, drop-off=0%) and downstream_loss = 100% − downstream_conversion.
    truth: true
    rationale: §"key calculations".
  - id: R-4
    statement: From a selected stage, scenario_revenue = monthly_traffic × downstream_conversion × average_order_value and scenario_lost_revenue uses downstream_loss; with average_cart_skus (default 2.0), estimated_sku_items_purchased = converted_orders × average_cart_skus and estimated_sku_items_lost = lost_orders × average_cart_skus. The UI shows these beside revenue/lost revenue.
    truth: true
    rationale: §"key calculations" + revenue.ts helper.
  - id: R-5
    statement: The seed flow flow_ecommerce_standard has 17 stages and 44 transitions (PLP Cat Nav → Site Search removed; PLP Search → Site Search kept as backward/rework), seeded across 3 industry templates (jewelry AOV 180/1.6 SKU, clothing 100/2.3, electronics 250/1.4) giving 132 dataset transition values.
    truth: true
    rationale: §"current flow" + seed SQL + historical note. The seeded counts are the reconciled figures.
  - id: R-6
    statement: Validation — every transition's source and target must exist; every flow must contain traffic, purchase, and drop-off; for each source stage the sum of outgoing conversion_pct must be 100% (tolerance 99.5–100.5); and monthly_traffic, average_order_value, average_cart_skus must each be ≥ 0.
    truth: true
    rationale: §"validation rules".
  - id: R-7
    statement: Nine DB-backed CRUD maintenance screens exist (flow, stage, transition, instance, dataset, dataset transition values, benchmark source, friction point, friction finding); adding a transition prompts whether to also add dataset values for all / selected / no datasets.
    truth: true
    rationale: §"maintenance screens".
  - id: R-8
    statement: The SQL schema block in this spec is historical and predates the GroLabs-conventions reconciliation — the live schema is the migration file; only the product rules (visual language, highlight rules, formulas, validation) remain canonical.
    truth: false
    rationale: Historical note at top. The in-doc schema/seed no longer reflect the live schema (see PR #25 reconciliation). See [[in-flight]].

useCases:
  - id: T-1
    title: Trace forward conversion from a stage
    given: An analyst viewing the standard funnel
    when: They click the PDP stage
    then: The canvas highlights PDP, its incoming/outgoing transitions and immediate neighbors, and continues along forward paths to purchase, stopping at backward and drop-off edges; the rest fades
    verifies: [R-2]
  - id: T-2
    title: Dataset rejects outgoing values that don't sum to 100
    given: A source stage whose outgoing transition conversion percentages sum to 97%
    when: The dataset is validated
    then: Validation fails because the sum is outside the 99.5–100.5 tolerance
    verifies: [R-6]
  - id: T-3
    title: Scenario revenue from a selected stage
    given: An instance with monthly_traffic, average_order_value, and average_cart_skus set
    when: A stage is selected as the starting point
    then: The UI shows scenario revenue, lost revenue, and estimated SKU items purchased/lost computed from that stage's downstream conversion and loss
    verifies: [R-3, R-4]
---

# Funnel Flow Map — Production Spec for Next.js

> **Note:** the SQL schema block below is historical and predates the GroLabs-conventions reconciliation. The live schema is at `supabase/migrations/20260430000001_funnel_schema.sql`. See PR #25 for the reconciliation log. The spec's product rules (visual language, highlight rules, formulas, validation rules) remain canonical. The seeded counts are **17 stages, 44 transitions, 132 dataset values** (44 transitions × 3 templates).

## Purpose

This document defines the production implementation for the Funnel Flow Map application.

Stack target:

```txt
Next.js App Router
React + TypeScript
@xyflow/react / React Flow
Tailwind CSS
shadcn/ui
PostgreSQL / Supabase
```

The application visualizes, analyzes, and simulates e-commerce funnel flows using:

- **Stages**: nodes in the diagram.
- **Transitions**: arrows/lines between stages.
- **Flow**: reusable graph definition containing stages and transitions.
- **Dataset**: transition conversion values and assumptions for one flow.
- **Instance**: customer, tenant, scenario, or template using a flow and dataset.
- **Friction Point**: known UX/business issue that may block progress.
- **Friction Finding**: concrete evidence of a friction point.
- **Benchmark Source**: evidence/source for benchmark conversion values.

---

## Current Product Rules

### Visual language

| Transition type | Color | Meaning |
|---|---:|---|
| Forward toward purchase | Green | Value/progress |
| Drop-off | Red | Loss |
| Backward/rework | Gray | Friction/rework |
| Not highlighted | Light gray | Context only |

### Thickness

```txt
Default transition: 1.15px
Highlighted forward transition: 3.5px
Drop-off transition: 1.15px
Backward transition: 1.15px
```

### Animation

Highlighted transitions should show directional animation. In React Flow this can start as:

```tsx
animated: highlighted
```

### Background

Do not render React Flow background dots.

```tsx
// Do not use <Background />
<Controls />
<MiniMap />
```

---

## Current Flow

Flow ID:

```txt
flow_ecommerce_standard
```

Stages:

| Stage ID | Label |
|---|---|
| traffic | Traffic |
| organic | Organic Search |
| social | Paid Social |
| paid | Paid Search |
| direct | Direct |
| email | Email |
| aeo | AEO (AI) |
| home | Homepage |
| cat | Category Nav |
| search | Site Search |
| plp_cat | PLP Cat Nav |
| plp_search | PLP Search |
| pdp | PDP |
| cart | Cart |
| checkout | Checkout |
| purchase | Purchase |
| drop | Drop-off |

Transitions:

```txt
traffic → organic
traffic → social
traffic → paid
traffic → direct
traffic → email
traffic → aeo

organic → home
organic → pdp
organic → drop

paid → home
paid → pdp
paid → drop

social → home
social → pdp
social → drop

direct → home
direct → pdp
direct → drop

email → pdp
email → home
email → drop

aeo → home
aeo → drop

home → cat
home → search
home → drop

cat → plp_cat
cat → drop

search → plp_search
search → pdp
search → drop

plp_cat → pdp
plp_cat → cart
plp_cat → drop

plp_search → pdp
plp_search → cart
plp_search → search
plp_search → drop

pdp → cart
pdp → drop

cart → checkout
cart → drop

checkout → purchase
checkout → drop
```

Important modeling decision:

```txt
PLP Cat Nav → Site Search was removed.
PLP Search → Site Search remains as a backward/rework transition.
```

---

## UI Highlight Rules

### Stage hover/click behavior

When a user hovers or clicks a stage:

1. Highlight the selected stage.
2. Highlight transitions going into the selected stage.
3. Highlight immediate source stages for those incoming transitions.
4. Highlight transitions going out of the selected stage.
5. Highlight immediate target stages for those outgoing transitions.
6. Continue highlighting only forward paths from those targets until `purchase`.
7. Do not expand through backward/rework transitions.
8. Do not expand through drop-off transitions.
9. Everything else remains visible but light gray/faded.

### Transition hover behavior

When a user hovers a transition:

1. Highlight only that transition.
2. Highlight only its source and target stages.
3. Show only that transition's percentage label.
4. Keep everything else faded.

---

## Key Calculations

### Transition conversion percentage

Each transition value is a percentage of the source stage.

```txt
pdp → cart = 40%
```

means:

```txt
40% of PDP users move to Cart.
```

### Stage reach percentage

A stage's reach is the cumulative percentage of original traffic reaching that stage.

```txt
Site Search = 21.7%
```

means:

```txt
21.7% of original traffic reaches Site Search.
```

### Downstream conversion from selected stage

```txt
downstream_conversion = purchase_reach / selected_stage_reach
```

Special cases:

```txt
Purchase = 100%
Drop-off = 0%
```

### Downstream loss

```txt
downstream_loss = 100% - downstream_conversion
```

### Scenario revenue from selected stage

The selected stage is treated as the starting point.

```txt
scenario_revenue = monthly_traffic × downstream_conversion × average_order_value
```

### Scenario lost revenue

```txt
scenario_lost_revenue = monthly_traffic × downstream_loss × average_order_value
```

### Average cart SKUs

Add a third editable variable:

```txt
average_cart_skus
```

Default:

```txt
2.0
```

Meaning:

```txt
Average quantity of unique SKUs in the cart/order.
```

Formulas:

```txt
converted_orders = monthly_traffic × downstream_conversion
lost_orders = monthly_traffic × downstream_loss

estimated_sku_items_purchased = converted_orders × average_cart_skus
estimated_sku_items_lost = lost_orders × average_cart_skus
```

The UI should show these values next to revenue/lost revenue.

---

## PostgreSQL Schema

```sql
create extension if not exists pgcrypto;

do $$ begin
  create type instance_type as enum ('template', 'customer', 'scenario');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type source_type as enum ('benchmark', 'customer_actual', 'manual_estimate', 'api_extraction');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type severity_level as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null;
end $$;
```

```sql
create table if not exists flows (
  flow_id text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

```sql
create table if not exists stages (
  stage_id text primary key,
  flow_id text not null references flows(flow_id) on delete cascade,
  label text not null,
  stage_order integer,
  color text,
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  icon_key text,
  is_terminal boolean not null default false,
  is_dropoff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(flow_id, stage_id)
);
```

```sql
create table if not exists transitions (
  transition_id text primary key,
  flow_id text not null references flows(flow_id) on delete cascade,
  source_stage_id text not null references stages(stage_id) on delete cascade,
  target_stage_id text not null references stages(stage_id) on delete cascade,
  transition_type text not null default 'standard',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(flow_id, source_stage_id, target_stage_id)
);
```

```sql
create table if not exists instances (
  instance_id text primary key,
  flow_id text not null references flows(flow_id),
  name text not null,
  instance_type instance_type not null,
  industry text,
  monthly_traffic numeric not null default 10000,
  average_order_value numeric not null default 100,
  average_cart_skus numeric not null default 2,
  tenant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

```sql
create table if not exists datasets (
  dataset_id text primary key,
  instance_id text not null references instances(instance_id) on delete cascade,
  flow_id text not null references flows(flow_id),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

```sql
create table if not exists dataset_transition_values (
  dataset_transition_value_id uuid primary key default gen_random_uuid(),
  dataset_id text not null references datasets(dataset_id) on delete cascade,
  transition_id text not null references transitions(transition_id) on delete cascade,
  conversion_pct numeric not null check (conversion_pct >= 0 and conversion_pct <= 100),
  source_type source_type not null default 'manual_estimate',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(dataset_id, transition_id)
);
```

```sql
create table if not exists benchmark_sources (
  benchmark_source_id uuid primary key default gen_random_uuid(),
  dataset_transition_value_id uuid not null references dataset_transition_values(dataset_transition_value_id) on delete cascade,
  title text not null,
  url text,
  source_name text,
  notes text,
  observed_value numeric,
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  created_at timestamptz not null default now()
);
```

```sql
create table if not exists friction_points (
  friction_point_id text primary key,
  stage_id text not null references stages(stage_id) on delete cascade,
  name text not null,
  description text,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

```sql
create table if not exists friction_findings (
  friction_finding_id text primary key,
  friction_point_id text not null references friction_points(friction_point_id) on delete cascade,
  instance_id text not null references instances(instance_id) on delete cascade,
  severity severity_level not null default 'medium',
  evidence text not null,
  source_system text,
  observed_at date,
  source_payload jsonb,
  created_at timestamptz not null default now()
);
```

---

## Seed SQL

### Flow

```sql
insert into flows (flow_id, name, description)
values (
  'flow_ecommerce_standard',
  'Standard E-commerce Funnel',
  'Reusable e-commerce funnel with acquisition, discovery, PLP, PDP, cart, checkout, purchase and drop-off.'
)
on conflict (flow_id) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();
```

### Stages

```sql
insert into stages (stage_id, flow_id, label, color, position_x, position_y, icon_key, is_terminal, is_dropoff)
values
  ('traffic', 'flow_ecommerce_standard', 'Traffic', '#2563eb', 0, 330, 'T', false, false),
  ('organic', 'flow_ecommerce_standard', 'Organic Search', '#f97316', 290, 0, 'S', false, false),
  ('social', 'flow_ecommerce_standard', 'Paid Social', '#22c55e', 290, 118, 'M', false, false),
  ('paid', 'flow_ecommerce_standard', 'Paid Search', '#ef4444', 290, 236, '$', false, false),
  ('direct', 'flow_ecommerce_standard', 'Direct', '#8b5cf6', 290, 354, 'D', false, false),
  ('email', 'flow_ecommerce_standard', 'Email', '#92400e', 290, 472, 'E', false, false),
  ('aeo', 'flow_ecommerce_standard', 'AEO (AI)', '#ec4899', 290, 590, 'AI', false, false),
  ('home', 'flow_ecommerce_standard', 'Homepage', '#64748b', 600, 170, 'H', false, false),
  ('cat', 'flow_ecommerce_standard', 'Category Nav', '#84cc16', 900, 60, 'C', false, false),
  ('search', 'flow_ecommerce_standard', 'Site Search', '#06b6d4', 900, 245, 'S', false, false),
  ('plp_cat', 'flow_ecommerce_standard', 'PLP Cat Nav', '#fb923c', 1210, 140, 'PC', false, false),
  ('plp_search', 'flow_ecommerce_standard', 'PLP Search', '#f59e0b', 1210, 320, 'PS', false, false),
  ('pdp', 'flow_ecommerce_standard', 'PDP', '#86efac', 1510, 215, 'D', false, false),
  ('cart', 'flow_ecommerce_standard', 'Cart', '#fca5a5', 1810, 235, 'C', false, false),
  ('checkout', 'flow_ecommerce_standard', 'Checkout', '#c4b5fd', 2110, 255, '$', false, false),
  ('purchase', 'flow_ecommerce_standard', 'Purchase', '#16a34a', 2410, 275, '✓', true, false),
  ('drop', 'flow_ecommerce_standard', 'Drop-off', '#dc2626', 2410, 735, '↓', true, true)
on conflict (stage_id) do update set
  label = excluded.label,
  color = excluded.color,
  position_x = excluded.position_x,
  position_y = excluded.position_y,
  icon_key = excluded.icon_key,
  is_terminal = excluded.is_terminal,
  is_dropoff = excluded.is_dropoff,
  updated_at = now();
```

### Transitions

```sql
insert into transitions (transition_id, flow_id, source_stage_id, target_stage_id, transition_type)
values
  ('traffic__organic', 'flow_ecommerce_standard', 'traffic', 'organic', 'forward'),
  ('traffic__social', 'flow_ecommerce_standard', 'traffic', 'social', 'forward'),
  ('traffic__paid', 'flow_ecommerce_standard', 'traffic', 'paid', 'forward'),
  ('traffic__direct', 'flow_ecommerce_standard', 'traffic', 'direct', 'forward'),
  ('traffic__email', 'flow_ecommerce_standard', 'traffic', 'email', 'forward'),
  ('traffic__aeo', 'flow_ecommerce_standard', 'traffic', 'aeo', 'forward'),
  ('organic__home', 'flow_ecommerce_standard', 'organic', 'home', 'forward'),
  ('organic__pdp', 'flow_ecommerce_standard', 'organic', 'pdp', 'forward'),
  ('organic__drop', 'flow_ecommerce_standard', 'organic', 'drop', 'dropoff'),
  ('paid__home', 'flow_ecommerce_standard', 'paid', 'home', 'forward'),
  ('paid__pdp', 'flow_ecommerce_standard', 'paid', 'pdp', 'forward'),
  ('paid__drop', 'flow_ecommerce_standard', 'paid', 'drop', 'dropoff'),
  ('social__home', 'flow_ecommerce_standard', 'social', 'home', 'forward'),
  ('social__pdp', 'flow_ecommerce_standard', 'social', 'pdp', 'forward'),
  ('social__drop', 'flow_ecommerce_standard', 'social', 'drop', 'dropoff'),
  ('direct__home', 'flow_ecommerce_standard', 'direct', 'home', 'forward'),
  ('direct__pdp', 'flow_ecommerce_standard', 'direct', 'pdp', 'forward'),
  ('direct__drop', 'flow_ecommerce_standard', 'direct', 'drop', 'dropoff'),
  ('email__pdp', 'flow_ecommerce_standard', 'email', 'pdp', 'forward'),
  ('email__home', 'flow_ecommerce_standard', 'email', 'home', 'forward'),
  ('email__drop', 'flow_ecommerce_standard', 'email', 'drop', 'dropoff'),
  ('aeo__home', 'flow_ecommerce_standard', 'aeo', 'home', 'forward'),
  ('aeo__drop', 'flow_ecommerce_standard', 'aeo', 'drop', 'dropoff'),
  ('home__cat', 'flow_ecommerce_standard', 'home', 'cat', 'forward'),
  ('home__search', 'flow_ecommerce_standard', 'home', 'search', 'forward'),
  ('home__drop', 'flow_ecommerce_standard', 'home', 'drop', 'dropoff'),
  ('cat__plp_cat', 'flow_ecommerce_standard', 'cat', 'plp_cat', 'forward'),
  ('cat__drop', 'flow_ecommerce_standard', 'cat', 'drop', 'dropoff'),
  ('search__plp_search', 'flow_ecommerce_standard', 'search', 'plp_search', 'forward'),
  ('search__pdp', 'flow_ecommerce_standard', 'search', 'pdp', 'forward'),
  ('search__drop', 'flow_ecommerce_standard', 'search', 'drop', 'dropoff'),
  ('plp_cat__pdp', 'flow_ecommerce_standard', 'plp_cat', 'pdp', 'forward'),
  ('plp_cat__cart', 'flow_ecommerce_standard', 'plp_cat', 'cart', 'forward'),
  ('plp_cat__drop', 'flow_ecommerce_standard', 'plp_cat', 'drop', 'dropoff'),
  ('plp_search__pdp', 'flow_ecommerce_standard', 'plp_search', 'pdp', 'forward'),
  ('plp_search__cart', 'flow_ecommerce_standard', 'plp_search', 'cart', 'forward'),
  ('plp_search__search', 'flow_ecommerce_standard', 'plp_search', 'search', 'backward'),
  ('plp_search__drop', 'flow_ecommerce_standard', 'plp_search', 'drop', 'dropoff'),
  ('pdp__cart', 'flow_ecommerce_standard', 'pdp', 'cart', 'forward'),
  ('pdp__drop', 'flow_ecommerce_standard', 'pdp', 'drop', 'dropoff'),
  ('cart__checkout', 'flow_ecommerce_standard', 'cart', 'checkout', 'forward'),
  ('cart__drop', 'flow_ecommerce_standard', 'cart', 'drop', 'dropoff'),
  ('checkout__purchase', 'flow_ecommerce_standard', 'checkout', 'purchase', 'forward'),
  ('checkout__drop', 'flow_ecommerce_standard', 'checkout', 'drop', 'dropoff')
on conflict (transition_id) do update set
  source_stage_id = excluded.source_stage_id,
  target_stage_id = excluded.target_stage_id,
  transition_type = excluded.transition_type,
  updated_at = now();
```

### Instances

```sql
insert into instances (
  instance_id,
  flow_id,
  name,
  instance_type,
  industry,
  monthly_traffic,
  average_order_value,
  average_cart_skus
)
values
  ('template_jewelry', 'flow_ecommerce_standard', 'Jewelry Benchmark Template', 'template', 'Jewelry', 10000, 180, 1.6),
  ('template_clothing', 'flow_ecommerce_standard', 'Clothing Benchmark Template', 'template', 'Clothing', 10000, 100, 2.3),
  ('template_electronics', 'flow_ecommerce_standard', 'Electronics Benchmark Template', 'template', 'Electronics', 10000, 250, 1.4)
on conflict (instance_id) do update set
  name = excluded.name,
  instance_type = excluded.instance_type,
  industry = excluded.industry,
  monthly_traffic = excluded.monthly_traffic,
  average_order_value = excluded.average_order_value,
  average_cart_skus = excluded.average_cart_skus,
  updated_at = now();
```

### Datasets

```sql
insert into datasets (dataset_id, instance_id, flow_id, name, description, is_active)
values
  ('dataset_jewelry_benchmark_v1', 'template_jewelry', 'flow_ecommerce_standard', 'Jewelry benchmark dataset', 'Template benchmark conversion values for jewelry.', true),
  ('dataset_clothing_benchmark_v1', 'template_clothing', 'flow_ecommerce_standard', 'Clothing benchmark dataset', 'Template benchmark conversion values for clothing.', true),
  ('dataset_electronics_benchmark_v1', 'template_electronics', 'flow_ecommerce_standard', 'Electronics benchmark dataset', 'Template benchmark conversion values for electronics.', true)
on conflict (dataset_id) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = now();
```

---

## Next.js Folder Structure

```txt
src/
  app/
    funnel/
      page.tsx
  components/
    funnel/
      FunnelCanvas.tsx
      FunnelNode.tsx
      SmartEdge.tsx
      DiagramInspector.tsx
      DataStructureTab.tsx
      MaintenanceTab.tsx
      InstanceSelector.tsx
  lib/
    funnel/
      computeModel.ts
      highlightRules.ts
      edgeRouting.ts
      revenue.ts
      types.ts
      queries.ts
  db/
    schema.sql
    seed.sql
```

---

## Production TypeScript Types

```ts
export type InstanceType = "template" | "customer" | "scenario";
export type SourceType = "benchmark" | "customer_actual" | "manual_estimate" | "api_extraction";
export type SeverityLevel = "low" | "medium" | "high" | "critical";

export interface Instance {
  instanceId: string;
  flowId: string;
  name: string;
  instanceType: InstanceType;
  industry?: string;
  monthlyTraffic: number;
  averageOrderValue: number;
  averageCartSkus: number;
}
```

Revenue helper:

```ts
export function revenueFromStage({
  stageId,
  model,
  monthlyTraffic,
  averageOrderValue,
  averageCartSkus,
}: {
  stageId: string;
  model: ComputedModel;
  monthlyTraffic: number;
  averageOrderValue: number;
  averageCartSkus: number;
}) {
  const stageReach = model.reach[stageId] || 0;
  const purchaseReach = model.reach.purchase || 0;

  const convertsPct =
    stageId === "drop"
      ? 0
      : stageId === "purchase"
        ? 100
        : stageReach > 0
          ? (purchaseReach / stageReach) * 100
          : 0;

  const lostPct = 100 - convertsPct;

  const convertedOrders = Math.round(monthlyTraffic * (convertsPct / 100));
  const lostOrders = Math.round(monthlyTraffic * (lostPct / 100));

  return {
    convertsPct,
    lostPct,
    convertedOrders,
    lostOrders,
    revenue: convertedOrders * averageOrderValue,
    lostRevenue: lostOrders * averageOrderValue,
    estimatedSkuItemsPurchased: Math.round(convertedOrders * averageCartSkus),
    estimatedSkuItemsLost: Math.round(lostOrders * averageCartSkus),
  };
}
```

---

## Maintenance Screens

Required admin screens:

1. Flow maintenance
2. Stage maintenance
3. Transition maintenance
4. Instance maintenance
5. Dataset maintenance
6. Dataset transition values maintenance
7. Benchmark source maintenance
8. Friction point maintenance
9. Friction finding maintenance

Example transition form:

```txt
Source stage: aeo
Target stage: pdp
Transition ID: aeo__pdp
Default conversion %: 15
```

When adding a transition to a flow, the app must ask whether to also add dataset values for:

```txt
all datasets
selected datasets
no datasets yet
```

---

## Validation Rules

### Flow validation

```txt
Every transition source must exist.
Every transition target must exist.
Every flow must have traffic, purchase, and drop-off.
```

### Dataset validation

For every source stage:

```txt
sum(outgoing conversion_pct) should equal 100%.
```

Tolerance:

```txt
99.5 <= sum <= 100.5
```

### Instance validation

```txt
monthly_traffic >= 0
average_order_value >= 0
average_cart_skus >= 0
```

---

## Production Checklist

1. Create schema.
2. Seed flow.
3. Seed stages.
4. Seed transitions.
5. Seed template instances.
6. Seed datasets.
7. Seed transition values.
8. Seed friction points.
9. Seed friction findings.
10. Add `average_cart_skus` input next to monthly traffic and average order value.
11. Show:
    - scenario revenue
    - scenario lost revenue
    - estimated SKU items purchased
    - estimated SKU items lost
12. Build Maintenance screens using DB-backed CRUD.
13. Keep transition colors:
    - green forward
    - red drop-off
    - gray backward/rework
    - light gray inactive
14. Keep background clean.
