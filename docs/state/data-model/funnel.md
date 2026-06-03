---
application: core-app
module: Data Model
title: "Data model — Funnel"
status: Draft
scope: "The funnel tables: shared definition (funnel_flow, funnel_stage, funnel_transition, funnel_friction_point) and per-instance (funnel_instance, funnel_dataset, funnel_dataset_transition_value, funnel_benchmark_source, funnel_friction_finding)."
audience: "Engineers who need the table-level shape of the funnel domain and the shared-vs-per-instance split."
---

# Data model — Funnel

The [[Funnel]] tables split into a shared definition layer and a per-instance
layer. A `funnel_flow` has stages, transitions, and [[Friction point|friction
points]]; a [[Funnel instance]] binds a flow to one [[Instance]] and owns its
datasets, benchmark sources, and friction findings. Per-instance tables derive
`instance_id` by trigger from the parent `funnel_instance`.

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative, not column-exact.

```mermaid
erDiagram
  funnel_flow ||--o{ funnel_stage : has
  funnel_flow ||--o{ funnel_transition : has
  funnel_flow ||--o{ funnel_friction_point : has
  funnel_flow ||--o{ funnel_instance : "instantiated as"
  funnel_instance ||--o{ funnel_dataset : owns
  funnel_dataset ||--o{ funnel_dataset_transition_value : holds
  funnel_transition ||--o{ funnel_dataset_transition_value : measured_by
  funnel_instance ||--o{ funnel_benchmark_source : owns
  funnel_instance ||--o{ funnel_friction_finding : owns
  funnel_friction_point ||--o{ funnel_friction_finding : "observed as"
```
