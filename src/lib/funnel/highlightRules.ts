import type { ComputedEdge, ComputedModel } from "./types";

const DROP_SLUG = "drop";
const PURCHASE_SLUG = "purchase";

export type StagePositions = Record<string, { x: number; y: number }>;

export function isDrop(edge: { target_slug: string }): boolean {
  return edge.target_slug === DROP_SLUG;
}

/**
 * "Forward" = target is to the right of source on the canvas. Drop edges
 * are excluded explicitly even though they may also be rightward.
 */
export function isForwardTransition(
  edge: ComputedEdge,
  positions: StagePositions,
): boolean {
  if (isDrop(edge)) return false;
  const s = positions[edge.source_slug];
  const t = positions[edge.target_slug];
  return Boolean(s && t && t.x > s.x);
}

/**
 * Walks the forward DAG from `startSlug` and collects every forward edge
 * + stage on the path until purchase or a leaf. Does NOT expand through
 * backward or dropoff edges (per spec §"UI Highlight Rules" rules 7–8).
 */
export function getForwardPurchasePathFrom(
  startSlug: string,
  edges: ComputedEdge[],
  positions: StagePositions,
): { highlightedEdges: Set<string>; highlightedStages: Set<string> } {
  const highlightedEdges = new Set<string>();
  const highlightedStages = new Set<string>([startSlug]);
  const visited = new Set<string>();

  function walk(fromSlug: string) {
    if (visited.has(fromSlug)) return;
    visited.add(fromSlug);
    edges
      .filter(
        (e) => e.source_slug === fromSlug && isForwardTransition(e, positions),
      )
      .forEach((e) => {
        highlightedEdges.add(e.slug);
        highlightedStages.add(e.source_slug);
        highlightedStages.add(e.target_slug);
        if (e.target_slug !== PURCHASE_SLUG) walk(e.target_slug);
      });
  }

  walk(startSlug);
  return { highlightedEdges, highlightedStages };
}

/**
 * Top-level highlight resolver. If an edge is active (hover), highlight
 * just that edge + its endpoints. Otherwise if a stage is active, follow
 * spec §"Stage hover/click behavior":
 *   - the active stage
 *   - its incoming transitions + their source stages
 *   - its outgoing transitions + their target stages
 *   - and the forward path from each outgoing target down to purchase.
 */
export function getHighlightSets(
  activeStageSlug: string | null,
  activeEdgeSlug: string | null,
  model: ComputedModel,
  positions: StagePositions,
): { highlightedEdges: Set<string>; highlightedStages: Set<string> } {
  const highlightedEdges = new Set<string>();
  const highlightedStages = new Set<string>();

  if (activeEdgeSlug) {
    const edge = model.edges.find((e) => e.slug === activeEdgeSlug);
    if (edge) {
      highlightedEdges.add(edge.slug);
      highlightedStages.add(edge.source_slug);
      highlightedStages.add(edge.target_slug);
    }
    return { highlightedEdges, highlightedStages };
  }

  if (!activeStageSlug) return { highlightedEdges, highlightedStages };

  highlightedStages.add(activeStageSlug);

  model.edges
    .filter((e) => e.target_slug === activeStageSlug)
    .forEach((e) => {
      highlightedEdges.add(e.slug);
      highlightedStages.add(e.source_slug);
      highlightedStages.add(e.target_slug);
    });

  const outgoing = model.edges.filter((e) => e.source_slug === activeStageSlug);
  outgoing.forEach((e) => {
    highlightedEdges.add(e.slug);
    highlightedStages.add(e.source_slug);
    highlightedStages.add(e.target_slug);
  });

  outgoing
    .filter((e) => isForwardTransition(e, positions))
    .forEach((e) => {
      const downstream = getForwardPurchasePathFrom(
        e.target_slug,
        model.edges,
        positions,
      );
      downstream.highlightedEdges.forEach((s) => highlightedEdges.add(s));
      downstream.highlightedStages.forEach((s) => highlightedStages.add(s));
    });

  return { highlightedEdges, highlightedStages };
}
