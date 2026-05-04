import type {
  ComputedEdge,
  ComputedModel,
  FunnelDatasetTransitionValue,
  FunnelStage,
  FunnelTransition,
} from "./types";

const TRAFFIC_SLUG = "traffic";

/**
 * Computes per-edge `pct_total` and per-stage cumulative reach %.
 *
 * Algorithm (single-pass, mirrors the prototype):
 *   1. Initialize reach[slug] = 0 for every stage; reach.traffic = 100.
 *   2. Process edges in source-stage-order. For each edge:
 *        pct_total      = reach[source] * (conversion_pct / 100)
 *        reach[target] += pct_total
 *
 * Ordering invariant: source's reach must be final before we read it.
 * We sort by source stage_order ASC (transition_id ASC as tiebreaker).
 * For the standard e-commerce funnel that's a topological order over the
 * forward DAG. Backward edges (e.g. plp_search → search) are processed
 * after their target is already reach-finalised; their pct_total is
 * added to reach[target] but does NOT re-propagate. This matches the
 * prototype's approximation — single pass, not a fixpoint.
 *
 * Edges with conversion_pct = 0 are filtered out before sorting so they
 * don't render as zero-weight clutter on the diagram.
 */
export function computeModel({
  stages,
  transitions,
  values,
}: {
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
}): ComputedModel {
  const slugById = new Map(stages.map((s) => [s.funnel_stage_id, s.slug]));
  const orderById = new Map(
    stages.map((s) => [s.funnel_stage_id, s.stage_order ?? 0]),
  );
  const pctByTransitionId = new Map(
    values.map((v) => [v.funnel_transition_id, v.conversion_pct]),
  );

  const built = transitions
    .map((t) => {
      const source_slug = slugById.get(t.source_stage_id);
      const target_slug = slugById.get(t.target_stage_id);
      const conversion_pct = pctByTransitionId.get(t.funnel_transition_id) ?? 0;
      if (!source_slug || !target_slug) return null;
      return { ...t, source_slug, target_slug, conversion_pct };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null && e.conversion_pct > 0)
    .sort((a, b) => {
      const oa = orderById.get(a.source_stage_id) ?? 0;
      const ob = orderById.get(b.source_stage_id) ?? 0;
      if (oa !== ob) return oa - ob;
      return a.funnel_transition_id - b.funnel_transition_id;
    });

  const reach: Record<string, number> = {};
  for (const stage of stages) reach[stage.slug] = 0;
  if (Object.prototype.hasOwnProperty.call(reach, TRAFFIC_SLUG)) {
    reach[TRAFFIC_SLUG] = 100;
  }

  const edges: ComputedEdge[] = built.map((edge) => {
    const pct_total = (reach[edge.source_slug] ?? 0) * (edge.conversion_pct / 100);
    reach[edge.target_slug] = (reach[edge.target_slug] ?? 0) + pct_total;
    return { ...edge, pct_total };
  });

  return { edges, reach };
}
