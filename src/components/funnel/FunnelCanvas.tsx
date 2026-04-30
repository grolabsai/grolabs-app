"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FunnelNode, type FunnelNodeType } from "./FunnelNode";
import { SmartEdge, type SmartEdgeType } from "./SmartEdge";
import { computeModel } from "@/lib/funnel/computeModel";
import { buildPortMap, type StagePositions } from "@/lib/funnel/edgeRouting";
import {
  getHighlightSets,
  isDrop,
  isForwardTransition,
} from "@/lib/funnel/highlightRules";
import type {
  FunnelDatasetTransitionValue,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

// Edge stroke colors from spec §"Visual language".
const COLOR_FORWARD = "#16a34a";
const COLOR_DROP = "#dc2626";
const COLOR_BACKWARD = "#9ca3af";
const COLOR_INACTIVE = "#d1d5db";
const COLOR_ACTIVE_HOVER = "#0f172a";
const COLOR_DROP_LABEL = "#991b1b";

// Edge thicknesses from spec §"Thickness". Highlighted forward gets the
// thicker stroke; drop and backward stay thin even when highlighted.
const STROKE_DEFAULT = 1.15;
const STROKE_HIGHLIGHT_FORWARD = 3.5;

const nodeTypes = { funnelNode: FunnelNode };
const edgeTypes = { smart: SmartEdge };

type Props = {
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
  showLabels?: boolean;
};

/**
 * The diagram canvas. Owns the active-stage / active-edge highlight state.
 * Pure render — does not persist any state to the DB.
 */
export function FunnelCanvas({
  stages,
  transitions,
  values,
  showLabels = false,
}: Props) {
  const [activeStageSlug, setActiveStageSlug] = useState<string | null>(null);
  const [activeEdgeSlug, setActiveEdgeSlug] = useState<string | null>(null);

  const stagePositions = useMemo<StagePositions>(() => {
    const map: StagePositions = {};
    for (const s of stages) {
      map[s.slug] = { x: s.position_x, y: s.position_y };
    }
    return map;
  }, [stages]);

  const stageSlugs = useMemo(() => stages.map((s) => s.slug), [stages]);

  const model = useMemo(
    () => computeModel({ stages, transitions, values }),
    [stages, transitions, values],
  );

  const portMap = useMemo(
    () => buildPortMap(model.edges, stageSlugs),
    [model.edges, stageSlugs],
  );

  const { highlightedEdges, highlightedStages } = useMemo(
    () =>
      getHighlightSets(activeStageSlug, activeEdgeSlug, model, stagePositions),
    [activeStageSlug, activeEdgeSlug, model, stagePositions],
  );

  const hasHighlight = Boolean(activeStageSlug || activeEdgeSlug);

  const nodes: FunnelNodeType[] = useMemo(() => {
    return stages.map((stage) => {
      const highlighted = highlightedStages.has(stage.slug);
      return {
        id: stage.slug,
        type: "funnelNode" as const,
        position: { x: stage.position_x, y: stage.position_y },
        data: {
          slug: stage.slug,
          label: stage.label,
          color: stage.color,
          iconKey: stage.icon_key,
          isDrop: stage.is_dropoff,
          ports:
            portMap[stage.slug] ?? {
              incoming: [],
              outgoing: [],
              dropOutgoing: [],
            },
          pct: model.reach[stage.slug] ?? 0,
          focused: activeStageSlug === stage.slug || highlighted,
          connected: highlighted && activeStageSlug !== stage.slug,
          dimmed: hasHighlight && !highlighted,
        },
      };
    });
  }, [
    stages,
    portMap,
    model.reach,
    highlightedStages,
    activeStageSlug,
    hasHighlight,
  ]);

  const edges: SmartEdgeType[] = useMemo(() => {
    return model.edges.map((edge) => {
      const highlighted = highlightedEdges.has(edge.slug);
      const drop = isDrop(edge);
      const backward = !drop && !isForwardTransition(edge, stagePositions);

      let stroke = COLOR_INACTIVE;
      if (drop) stroke = COLOR_DROP;
      else if (backward) stroke = COLOR_BACKWARD;
      else stroke = COLOR_FORWARD;
      if (activeEdgeSlug === edge.slug) {
        stroke = drop ? COLOR_DROP : COLOR_ACTIVE_HOVER;
      }

      const labelText = hasHighlight
        ? highlighted
          ? `${edge.conversion_pct.toFixed(0)}%`
          : ""
        : showLabels
          ? `${edge.conversion_pct.toFixed(0)}%`
          : "";

      return {
        id: edge.slug,
        source: edge.source_slug,
        target: edge.target_slug,
        sourceHandle: drop ? `drop-${edge.slug}` : `out-${edge.slug}`,
        targetHandle: drop ? "drop-target" : `in-${edge.slug}`,
        type: "smart" as const,
        label: labelText,
        data: { edge, stagePositions, stageSlugs },
        animated: highlighted,
        style: {
          stroke,
          strokeWidth:
            !drop && !backward && highlighted
              ? STROKE_HIGHLIGHT_FORWARD
              : STROKE_DEFAULT,
          opacity: hasHighlight ? (highlighted ? 0.96 : 0.18) : 0.32,
        },
        labelStyle: {
          fill: drop ? COLOR_DROP_LABEL : COLOR_ACTIVE_HOVER,
          fontWeight: 700,
        },
      };
    });
  }, [
    model.edges,
    stagePositions,
    stageSlugs,
    highlightedEdges,
    activeEdgeSlug,
    hasHighlight,
    showLabels,
  ]);

  const onNodeMouseEnter = useCallback<NodeMouseHandler<Node>>((_e, node) => {
    setActiveEdgeSlug(null);
    setActiveStageSlug(node.id);
  }, []);

  const onNodeClick = useCallback<NodeMouseHandler<Node>>((_e, node) => {
    setActiveEdgeSlug(null);
    setActiveStageSlug(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setActiveStageSlug(null);
    setActiveEdgeSlug(null);
  }, []);

  const onEdgeMouseEnter = useCallback<EdgeMouseHandler<Edge>>((_e, edge) => {
    setActiveEdgeSlug(edge.id);
  }, []);

  const onEdgeMouseLeave = useCallback(() => {
    setActiveEdgeSlug(null);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseLeave={onEdgeMouseLeave}
      nodesDraggable
      nodesConnectable={false}
    >
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
