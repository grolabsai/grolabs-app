/**
 * Prospectos v5 — dependency ordering.
 *
 * Topologically sorts loaded `AtomicCheck`s so that a check is always scored
 * AFTER the prerequisite it `depends_on`. The engine relies on this: when it
 * reaches a dependent, the parent's `CheckScore` already exists, so it can
 * decide `blocked` (prerequisite unmet → 0) vs `na` (prerequisite not
 * evaluable) vs evaluate-normally.
 *
 * Edges only count when the parent is part of THIS run. `depends_on_check_id`
 * may point at a check outside the loaded profile (the loader leaves
 * `dependsOnCheckCode` null in that case); such a dependent has no in-run
 * prerequisite and is treated as a root for ordering — the engine then scores
 * it normally because it can't observe the parent.
 *
 * Pure, no IO. Stable: roots and freed children are emitted in input order so
 * the engine's walk (and tests) are deterministic.
 */

import type { AtomicCheck } from "./types";

/**
 * Order `checks` so every check follows its in-run prerequisite.
 *
 * @throws if the `depends_on` graph contains a cycle (it shouldn't — the seed
 *   edges form a forest — but we guard rather than silently drop checks).
 */
export function orderChecksByDependency(checks: AtomicCheck[]): AtomicCheck[] {
  const byId = new Map<number, AtomicCheck>();
  for (const c of checks) byId.set(c.diagnosticCheckId, c);

  // In-degree counts only prerequisites that are present in this run.
  const indegree = new Map<number, number>();
  const children = new Map<number, number[]>(); // parentId → dependent ids
  for (const c of checks) indegree.set(c.diagnosticCheckId, 0);

  for (const c of checks) {
    const parentId = c.dependsOnCheckId;
    if (parentId === null || !byId.has(parentId)) continue; // root (no in-run prereq)
    indegree.set(c.diagnosticCheckId, (indegree.get(c.diagnosticCheckId) ?? 0) + 1);
    const arr = children.get(parentId);
    if (arr) arr.push(c.diagnosticCheckId);
    else children.set(parentId, [c.diagnosticCheckId]);
  }

  // Kahn's algorithm, seeded in input order for stable output.
  const queue: number[] = [];
  for (const c of checks) {
    if ((indegree.get(c.diagnosticCheckId) ?? 0) === 0) queue.push(c.diagnosticCheckId);
  }

  const ordered: AtomicCheck[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as number;
    ordered.push(byId.get(id) as AtomicCheck);
    for (const childId of children.get(id) ?? []) {
      const next = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, next);
      if (next === 0) queue.push(childId);
    }
  }

  if (ordered.length !== checks.length) {
    const placed = new Set(ordered.map((c) => c.diagnosticCheckId));
    const cyclic = checks
      .filter((c) => !placed.has(c.diagnosticCheckId))
      .map((c) => c.checkCode);
    throw new Error(
      `orderChecksByDependency: dependency cycle among [${cyclic.join(", ")}]`,
    );
  }

  return ordered;
}
