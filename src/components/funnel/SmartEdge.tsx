"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { isForwardTransition } from "@/lib/funnel/highlightRules";
import {
  chooseLane,
  dropLanePath,
  pointsToPath,
  routeCrossesStage,
  type StagePositions,
} from "@/lib/funnel/edgeRouting";
import type { ComputedEdge } from "@/lib/funnel/types";

export type SmartEdgeData = {
  edge: ComputedEdge;
  stagePositions: StagePositions;
  stageSlugs: string[];
};

export type SmartEdgeType = Edge<SmartEdgeData, "smart">;

/**
 * Custom edge with three routing modes:
 *   - Drop edges drop straight down to a lane near y=720 then run east
 *     to the drop collector node.
 *   - Backward edges and edges whose straight-line route would cross
 *     other stage boxes use the multi-segment chooseLane router.
 *   - Otherwise a smooth bezier between the two ports.
 *
 * The label is rendered via EdgeLabelRenderer (a portal that sits on top
 * of the SVG layer) so it doesn't clip with the stroke.
 */
export function SmartEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  label,
  labelStyle,
  data,
}: EdgeProps<SmartEdgeType>) {
  if (!data) return <BaseEdge id={id} path="" style={style} />;

  const { edge, stagePositions, stageSlugs } = data;
  const drop = edge.target_slug === "drop";
  const backward = !drop && !isForwardTransition(edge, stagePositions);

  let path: string;
  let labelX = sourceX + 38;
  let labelY = sourceY - 14;

  if (drop) {
    path = dropLanePath(sourceX, sourceY, targetX, targetY);
    labelY = sourceY + 22;
  } else {
    const straight = [
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
    ];

    if (
      backward ||
      routeCrossesStage(straight, edge.source_slug, edge.target_slug, stagePositions, stageSlugs)
    ) {
      path = pointsToPath(
        chooseLane(
          sourceX,
          sourceY,
          targetX,
          targetY,
          edge.source_slug,
          edge.target_slug,
          stagePositions,
          stageSlugs,
        ),
      );
      labelY = sourceY - 18;
    } else {
      const midX = (sourceX + targetX) / 2;
      path = `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
    }
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-bold shadow-sm"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <span style={labelStyle}>{label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
