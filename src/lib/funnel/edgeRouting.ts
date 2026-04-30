import type { ComputedEdge } from "./types";

/**
 * Geometry constants — must match the FunnelNode rendered size so the
 * "this segment crosses a stage box" detection is accurate.
 */
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 92;
const PORT_INSET = 60; // px lateral inset before the route turns
const LANE_Y_MIN = 30;
const LANE_Y_MAX = 780;
const DROP_LANE_Y = 720;

type Box = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };

export type StagePositions = Record<string, { x: number; y: number }>;

function getStageBox(slug: string, positions: StagePositions): Box | null {
  const pos = positions[slug];
  if (!pos) return null;
  return {
    left: pos.x,
    right: pos.x + NODE_WIDTH,
    top: pos.y,
    bottom: pos.y + NODE_HEIGHT,
  };
}

/**
 * Sample 32 points along a line segment and check whether any falls
 * inside (with padding) the given box. Cheap, good enough for the
 * funnel's typical segment lengths.
 */
function segmentCrossesBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: Box,
  padding = 22,
): boolean {
  const steps = 32;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (
      x >= box.left - padding &&
      x <= box.right + padding &&
      y >= box.top - padding &&
      y <= box.bottom + padding
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if any segment of the given polyline route passes through
 * a stage box other than its own source or target. We exclude `drop`
 * because the drop "lane" is intentionally far from the upper stages and
 * its node box doesn't overlap normal routing space.
 */
export function routeCrossesStage(
  points: Point[],
  sourceSlug: string,
  targetSlug: string,
  positions: StagePositions,
  allSlugs: string[],
): boolean {
  const boxes = allSlugs
    .filter(
      (slug) => slug !== sourceSlug && slug !== targetSlug && slug !== "drop",
    )
    .map((slug) => getStageBox(slug, positions))
    .filter((b): b is Box => b !== null);

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (boxes.some((box) => segmentCrossesBox(a.x, a.y, b.x, b.y, box))) {
      return true;
    }
  }
  return false;
}

export function pointsToPath(points: Point[]): string {
  return points
    .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
}

/**
 * Tries six lane-Y candidates above and below the source/target band,
 * picking the first that doesn't cross any other stage box. Falls back
 * to the lower-far lane if everything else is blocked. Same heuristic
 * as the prototype.
 */
export function chooseLane(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceSlug: string,
  targetSlug: string,
  positions: StagePositions,
  allSlugs: string[],
): Point[] {
  const candidates = [
    Math.min(sourceY, targetY) - 150,
    Math.max(sourceY, targetY) + 150,
    40,
    720,
    Math.min(sourceY, targetY) - 240,
    Math.max(sourceY, targetY) + 240,
  ];

  for (const raw of candidates) {
    const laneY = Math.max(LANE_Y_MIN, Math.min(LANE_Y_MAX, raw));
    const points: Point[] = [
      { x: sourceX, y: sourceY },
      { x: sourceX + PORT_INSET, y: sourceY },
      { x: sourceX + PORT_INSET, y: laneY },
      { x: targetX - PORT_INSET, y: laneY },
      { x: targetX - PORT_INSET, y: targetY },
      { x: targetX, y: targetY },
    ];
    if (!routeCrossesStage(points, sourceSlug, targetSlug, positions, allSlugs)) {
      return points;
    }
  }

  const fallbackY = Math.max(
    LANE_Y_MIN,
    Math.min(LANE_Y_MAX, Math.max(sourceY, targetY) + 200),
  );
  return [
    { x: sourceX, y: sourceY },
    { x: sourceX + PORT_INSET, y: sourceY },
    { x: sourceX + PORT_INSET, y: fallbackY },
    { x: targetX - PORT_INSET, y: fallbackY },
    { x: targetX - PORT_INSET, y: targetY },
    { x: targetX, y: targetY },
  ];
}

export function dropLanePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): string {
  return pointsToPath([
    { x: sourceX, y: sourceY },
    { x: sourceX, y: DROP_LANE_Y },
    { x: targetX - 140, y: DROP_LANE_Y },
    { x: targetX, y: targetY },
  ]);
}

/**
 * Distributes N port positions across the vertical face of a node. With
 * 1 port we centre at 50%; with N>1 we space them between 22% and 78%.
 * Returned as a CSS percent string.
 */
export function portTop(index: number, count: number): string {
  if (count <= 1) return "50%";
  return `${22 + (index * 56) / (count - 1)}%`;
}

export type PortMap = Record<
  string,
  {
    incoming: ComputedEdge[];
    outgoing: ComputedEdge[];
    dropOutgoing: ComputedEdge[];
  }
>;

export function buildPortMap(
  edges: ComputedEdge[],
  stageSlugs: string[],
): PortMap {
  const map: PortMap = {};
  for (const slug of stageSlugs) {
    map[slug] = { incoming: [], outgoing: [], dropOutgoing: [] };
  }
  for (const edge of edges) {
    map[edge.target_slug]?.incoming.push(edge);
    if (edge.target_slug === "drop") {
      map[edge.source_slug]?.dropOutgoing.push(edge);
    } else {
      map[edge.source_slug]?.outgoing.push(edge);
    }
  }
  return map;
}
