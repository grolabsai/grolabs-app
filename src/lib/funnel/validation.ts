import type { FunnelDatasetTransitionValue, FunnelStage, FunnelTransition } from "./types";

/**
 * Flow-structure validation per spec §"Validation Rules":
 *   - Every transition source must exist.
 *   - Every transition target must exist.
 *   - Every flow must have traffic, purchase, and drop-off stages.
 *
 * Same-flow constraint (source and target belong to the same flow) is
 * DDL-enforced via the composite FK in 20260430000001_funnel_schema.sql,
 * so we don't re-check it at the app layer.
 */
export type FlowStructureWarning =
  | { kind: "missingRequiredStage"; slug: "traffic" | "purchase" | "drop" }
  | {
      kind: "transitionSourceMissing";
      transition_id: number;
      transition_slug: string;
    }
  | {
      kind: "transitionTargetMissing";
      transition_id: number;
      transition_slug: string;
    };

const REQUIRED_STAGE_SLUGS = ["traffic", "purchase", "drop"] as const;

export function validateFlowStructure({
  stages,
  transitions,
}: {
  stages: FunnelStage[];
  transitions: FunnelTransition[];
}): FlowStructureWarning[] {
  const warnings: FlowStructureWarning[] = [];
  const stageSlugs = new Set(stages.map((s) => s.slug));
  const stageIds = new Set(stages.map((s) => s.funnel_stage_id));

  for (const required of REQUIRED_STAGE_SLUGS) {
    if (!stageSlugs.has(required)) {
      warnings.push({ kind: "missingRequiredStage", slug: required });
    }
  }

  for (const t of transitions) {
    if (!stageIds.has(t.source_stage_id)) {
      warnings.push({
        kind: "transitionSourceMissing",
        transition_id: t.funnel_transition_id,
        transition_slug: t.slug,
      });
    }
    if (!stageIds.has(t.target_stage_id)) {
      warnings.push({
        kind: "transitionTargetMissing",
        transition_id: t.funnel_transition_id,
        transition_slug: t.slug,
      });
    }
  }

  return warnings;
}

/**
 * Dataset-sum validation per spec §"Dataset validation":
 *   For every source stage in the dataset's transitions, the sum of
 *   outgoing conversion_pct should land in [99.5, 100.5].
 *
 * Returns one entry per source stage that is OUT of tolerance — empty
 * array means the dataset is healthy. The caller surfaces these as
 * non-blocking warnings (saving bad-sum data is allowed; spec only
 * requires the user be told).
 */
export type DatasetSumWarning = {
  source_stage_id: number;
  source_stage_slug: string;
  total: number; // sum of conversion_pct for outgoing transitions
};

export function validateDatasetSums({
  stages,
  transitions,
  values,
}: {
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
}): DatasetSumWarning[] {
  const slugById = new Map(stages.map((s) => [s.funnel_stage_id, s.slug]));
  const pctByTransitionId = new Map(
    values.map((v) => [v.funnel_transition_id, v.conversion_pct]),
  );

  const totalsBySource = new Map<number, number>();
  for (const t of transitions) {
    const pct = pctByTransitionId.get(t.funnel_transition_id) ?? 0;
    totalsBySource.set(
      t.source_stage_id,
      (totalsBySource.get(t.source_stage_id) ?? 0) + pct,
    );
  }

  const out: DatasetSumWarning[] = [];
  for (const [source_stage_id, total] of totalsBySource) {
    if (total < 99.5 || total > 100.5) {
      out.push({
        source_stage_id,
        source_stage_slug: slugById.get(source_stage_id) ?? "",
        total,
      });
    }
  }
  return out;
}
