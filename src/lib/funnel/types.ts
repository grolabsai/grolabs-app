/**
 * TypeScript types for funnel entities. One-to-one with the columns in
 * supabase/migrations/20260430000001_funnel_schema.sql — keep these in
 * sync when the schema changes.
 *
 * bigint identity PKs come back as `number` from the Supabase JS client
 * (well under 2^53 for the foreseeable scale of this feature).
 */

export type FunnelInstanceType = "template" | "customer" | "scenario";
export type FunnelSeverity = "low" | "medium" | "high" | "critical";
export type FunnelSourceType =
  | "benchmark"
  | "customer_actual"
  | "manual_estimate"
  | "api_extraction";
export type FunnelTransitionType = "forward" | "dropoff" | "backward";

// ─── Shared tables ──────────────────────────────────────────────────────────

export type FunnelFlow = {
  funnel_flow_id: number;
  slug: string;
  name: string;
  description: string | null;
};

export type FunnelStage = {
  funnel_stage_id: number;
  funnel_flow_id: number;
  slug: string;
  label: string;
  stage_order: number | null;
  color: string | null;
  position_x: number;
  position_y: number;
  icon_key: string | null;
  is_terminal: boolean;
  is_dropoff: boolean;
};

export type FunnelTransition = {
  funnel_transition_id: number;
  funnel_flow_id: number;
  source_stage_id: number;
  target_stage_id: number;
  slug: string;
  transition_type: FunnelTransitionType;
  is_active: boolean;
};

export type FunnelFrictionPoint = {
  funnel_friction_point_id: number;
  funnel_stage_id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
};

// ─── Per-tenant tables ──────────────────────────────────────────────────────

export type FunnelInstance = {
  funnel_instance_id: number;
  instance_id: number; // 0 for templates
  funnel_flow_id: number;
  slug: string;
  name: string;
  funnel_instance_type: FunnelInstanceType;
  industry: string | null;
  monthly_traffic: number;
  average_order_value: number;
  average_cart_skus: number;
};

export type FunnelDataset = {
  funnel_dataset_id: number;
  instance_id: number;
  funnel_instance_id: number;
  funnel_flow_id: number;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type FunnelDatasetTransitionValue = {
  funnel_dataset_transition_value_id: number;
  instance_id: number;
  funnel_dataset_id: number;
  funnel_transition_id: number;
  conversion_pct: number;
  source_type: FunnelSourceType;
  notes: string | null;
};

export type FunnelBenchmarkSource = {
  funnel_benchmark_source_id: number;
  instance_id: number;
  funnel_dataset_transition_value_id: number;
  title: string;
  url: string | null;
  source_name: string | null;
  notes: string | null;
  observed_value: number | null;
  confidence_score: number | null;
};

export type FunnelFrictionFinding = {
  funnel_friction_finding_id: number;
  instance_id: number;
  funnel_instance_id: number;
  funnel_friction_point_id: number;
  slug: string | null;
  severity: FunnelSeverity;
  evidence: string;
  source_system: string | null;
  observed_at: string | null;
  source_payload: unknown | null;
};

// ─── Computed types (derived in src/lib/funnel/computeModel.ts in Pass 3) ──

/**
 * A transition with its dataset value and computed reach. Stage slugs are
 * denormalised onto the edge so the highlight/route logic operates on
 * stable identifiers regardless of how Supabase returns the join.
 */
export type ComputedEdge = FunnelTransition & {
  source_slug: string;
  target_slug: string;
  conversion_pct: number; // from the dataset (% of source stage)
  pct_total: number; // cumulative % of original traffic flowing through this edge
};

export type ComputedModel = {
  edges: ComputedEdge[];
  /** Cumulative % of original traffic reaching each stage, keyed by stage slug. */
  reach: Record<string, number>;
};
