import { createClient } from "@/lib/supabase/server";
import type {
  FunnelFlow,
  FunnelStage,
  FunnelTransition,
  FunnelInstance,
  FunnelDataset,
  FunnelDatasetTransitionValue,
  FunnelFrictionPoint,
  FunnelFrictionFinding,
} from "./types";

// ─── List for InstanceSelector ──────────────────────────────────────────────

export type FunnelInstanceListItem = FunnelInstance & {
  active_dataset_slug: string | null;
  active_dataset_name: string | null;
};

/**
 * Returns all funnel_instances visible to the current user. RLS already
 * scopes the result to instance_id = 0 (templates) plus any instances the
 * user is a member of, so no explicit filter is needed.
 *
 * Order: own instances first (instance_id DESC), then templates, alphabetical
 * within each group. We want a customer's own scenarios at the top of the
 * dropdown and the read-only templates at the bottom.
 */
export async function getFunnelInstancesForUser(): Promise<
  FunnelInstanceListItem[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("funnel_instance")
    .select(
      `funnel_instance_id, instance_id, funnel_flow_id, slug, name,
       funnel_instance_type, industry, monthly_traffic, average_order_value,
       average_cart_skus,
       funnel_dataset (slug, name, is_active)`,
    )
    .order("instance_id", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("[funnel] getFunnelInstancesForUser:", error);
    return [];
  }

  return (data ?? []).map((row) => {
    const datasets = (row.funnel_dataset ?? []) as Array<{
      slug: string;
      name: string;
      is_active: boolean;
    }>;
    const active = datasets.find((d) => d.is_active) ?? null;
    return {
      funnel_instance_id: row.funnel_instance_id as number,
      instance_id: row.instance_id as number,
      funnel_flow_id: row.funnel_flow_id as number,
      slug: row.slug as string,
      name: row.name as string,
      funnel_instance_type:
        row.funnel_instance_type as FunnelInstanceListItem["funnel_instance_type"],
      industry: (row.industry as string | null) ?? null,
      monthly_traffic: Number(row.monthly_traffic),
      average_order_value: Number(row.average_order_value),
      average_cart_skus: Number(row.average_cart_skus),
      active_dataset_slug: active?.slug ?? null,
      active_dataset_name: active?.name ?? null,
    };
  });
}

// ─── Full instance fetch for the diagram screen ─────────────────────────────

export type FunnelInstanceFull = {
  instance: FunnelInstance;
  flow: FunnelFlow;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  dataset: FunnelDataset | null;
  values: FunnelDatasetTransitionValue[];
  frictionPoints: FunnelFrictionPoint[];
  frictionFindings: FunnelFrictionFinding[];
};

/**
 * Look up a funnel_instance by slug for the diagram screen. RLS scopes the
 * result to templates + the user's own instances.
 *
 * Tiebreaker: `ORDER BY instance_id DESC LIMIT 1`. Templates live at
 * instance_id = 0; customer instances have positive ids. If a customer
 * has forked a template under the same slug (e.g. their own
 * 'template_clothing' scenario), the customer-owned row wins and the URL
 * resolves to it — the template is shadowed. This is the documented slug
 * strategy from the Phase 2 plan-back; not accidental.
 *
 * Sequential fan-out for the related rows: PostgREST nested-select can't
 * follow shared-table FKs from `funnel_instance` because flow/stage/
 * transition aren't siblings under the per-tenant FK graph. Two parallel
 * batches keep the round trips tight without trying to be clever.
 */
export async function getFunnelInstanceBySlug(
  slug: string,
): Promise<FunnelInstanceFull | null> {
  const supabase = await createClient();

  const { data: instanceRow, error: instErr } = await supabase
    .from("funnel_instance")
    .select(
      `funnel_instance_id, instance_id, funnel_flow_id, slug, name,
       funnel_instance_type, industry, monthly_traffic, average_order_value,
       average_cart_skus`,
    )
    .eq("slug", slug)
    .order("instance_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (instErr) {
    console.error("[funnel] getFunnelInstanceBySlug:", instErr);
    return null;
  }
  if (!instanceRow) return null;

  const instance: FunnelInstance = {
    funnel_instance_id: instanceRow.funnel_instance_id as number,
    instance_id: instanceRow.instance_id as number,
    funnel_flow_id: instanceRow.funnel_flow_id as number,
    slug: instanceRow.slug as string,
    name: instanceRow.name as string,
    funnel_instance_type:
      instanceRow.funnel_instance_type as FunnelInstance["funnel_instance_type"],
    industry: (instanceRow.industry as string | null) ?? null,
    monthly_traffic: Number(instanceRow.monthly_traffic),
    average_order_value: Number(instanceRow.average_order_value),
    average_cart_skus: Number(instanceRow.average_cart_skus),
  };

  const [flowRes, stagesRes, transitionsRes, datasetRes, frictionPointsRes] =
    await Promise.all([
      supabase
        .from("funnel_flow")
        .select("funnel_flow_id, slug, name, description")
        .eq("funnel_flow_id", instance.funnel_flow_id)
        .single(),
      supabase
        .from("funnel_stage")
        .select(
          `funnel_stage_id, funnel_flow_id, slug, label, stage_order, color,
           position_x, position_y, icon_key, is_terminal, is_dropoff`,
        )
        .eq("funnel_flow_id", instance.funnel_flow_id)
        .order("stage_order", { ascending: true, nullsFirst: false }),
      supabase
        .from("funnel_transition")
        .select(
          `funnel_transition_id, funnel_flow_id, source_stage_id,
           target_stage_id, slug, transition_type, is_active`,
        )
        .eq("funnel_flow_id", instance.funnel_flow_id)
        .eq("is_active", true),
      supabase
        .from("funnel_dataset")
        .select(
          `funnel_dataset_id, instance_id, funnel_instance_id, funnel_flow_id,
           slug, name, description, is_active`,
        )
        .eq("funnel_instance_id", instance.funnel_instance_id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("funnel_friction_point")
        .select(
          "funnel_friction_point_id, funnel_stage_id, slug, name, description, category",
        ),
    ]);

  const flow = flowRes.data as FunnelFlow | null;
  if (!flow) {
    console.error("[funnel] flow missing for instance", instance.slug);
    return null;
  }
  const stages = ((stagesRes.data ?? []) as FunnelStage[]).map((s) => ({
    ...s,
    position_x: Number(s.position_x),
    position_y: Number(s.position_y),
  }));
  const transitions = (transitionsRes.data ?? []) as FunnelTransition[];
  const dataset = (datasetRes.data ?? null) as FunnelDataset | null;
  const frictionPoints = (frictionPointsRes.data ?? []) as FunnelFrictionPoint[];

  const [valuesRes, findingsRes] = await Promise.all([
    dataset
      ? supabase
          .from("funnel_dataset_transition_value")
          .select(
            `funnel_dataset_transition_value_id, instance_id, funnel_dataset_id,
             funnel_transition_id, conversion_pct, source_type, notes`,
          )
          .eq("funnel_dataset_id", dataset.funnel_dataset_id)
      : Promise.resolve({ data: [] as FunnelDatasetTransitionValue[] }),
    supabase
      .from("funnel_friction_finding")
      .select(
        `funnel_friction_finding_id, instance_id, funnel_instance_id,
         funnel_friction_point_id, slug, severity, evidence, source_system,
         observed_at, source_payload`,
      )
      .eq("funnel_instance_id", instance.funnel_instance_id),
  ]);

  const values = ((valuesRes.data ?? []) as FunnelDatasetTransitionValue[]).map(
    (v) => ({ ...v, conversion_pct: Number(v.conversion_pct) }),
  );
  const frictionFindings = (findingsRes.data ?? []) as FunnelFrictionFinding[];

  return {
    instance,
    flow,
    stages,
    transitions,
    dataset,
    values,
    frictionPoints,
    frictionFindings,
  };
}

// ─── Flow definition (without dataset) — for Data Structure / Maintenance ──

export type FlowDefinition = {
  flow: FunnelFlow;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
};

export async function getFlowDefinition(
  flowId: number,
): Promise<FlowDefinition | null> {
  const supabase = await createClient();
  const [flowRes, stagesRes, transitionsRes] = await Promise.all([
    supabase
      .from("funnel_flow")
      .select("funnel_flow_id, slug, name, description")
      .eq("funnel_flow_id", flowId)
      .single(),
    supabase
      .from("funnel_stage")
      .select(
        `funnel_stage_id, funnel_flow_id, slug, label, stage_order, color,
         position_x, position_y, icon_key, is_terminal, is_dropoff`,
      )
      .eq("funnel_flow_id", flowId)
      .order("stage_order", { ascending: true, nullsFirst: false }),
    supabase
      .from("funnel_transition")
      .select(
        `funnel_transition_id, funnel_flow_id, source_stage_id,
         target_stage_id, slug, transition_type, is_active`,
      )
      .eq("funnel_flow_id", flowId),
  ]);

  if (!flowRes.data) return null;
  return {
    flow: flowRes.data as FunnelFlow,
    stages: ((stagesRes.data ?? []) as FunnelStage[]).map((s) => ({
      ...s,
      position_x: Number(s.position_x),
      position_y: Number(s.position_y),
    })),
    transitions: (transitionsRes.data ?? []) as FunnelTransition[],
  };
}
