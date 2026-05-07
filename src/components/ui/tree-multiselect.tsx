"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, X, Check } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/**
 * TreeMultiSelectCombobox
 *
 * Multi-select picker for hierarchical data (e.g. categories with
 * parent_category_id + level). Both branches and leaves are selectable;
 * branches additionally have an expand/collapse chevron.
 *
 * Trigger area shows the picked rows as inline tags. Clicking the
 * trigger toggles the dropdown. Inside the dropdown, the user can:
 *   - Type to filter — matching nodes appear and their ancestors
 *     auto-expand to keep them visible.
 *   - Click a node row to toggle its selection.
 *   - Click the chevron to expand/collapse a branch independently.
 *
 * Ordering of `value` is preserved; the host treats the first id as the
 * primary category (as `createProductFull` already does).
 */

export type TreeNode = {
  id: number;
  label: string;
  parentId: number | null;
};

type Props = {
  value: number[];
  onChange: (next: number[]) => void;
  nodes: TreeNode[];
  placeholder: string;
  /** Search input placeholder + aria. */
  searchPlaceholder: string;
  /** Empty-state line in the dropdown when filter matches nothing. */
  emptyText: string;
  /** Aria label for the X button on each tag. */
  removeTagAriaLabel: string;
  /**
   * Sort each tree level alphabetically by label. Default true for
   * backwards compatibility. Pass false when the caller has already
   * sorted `nodes` (e.g. by a domain `sort_order`) and wants that
   * preserved root → leaf.
   */
  sortByLabel?: boolean;
};

type IndexedNode = TreeNode & {
  children: IndexedNode[];
  depth: number;
};

function indexTree(nodes: TreeNode[], sortByLabel: boolean): IndexedNode[] {
  // Root + child wiring in a single pass. Orphans (parent missing) are
  // promoted to roots so a partial dataset still renders.
  const byId = new Map<number, IndexedNode>();
  for (const n of nodes) {
    byId.set(n.id, { ...n, children: [], depth: 0 });
  }
  const roots: IndexedNode[] = [];
  // Iteration order of byId.values() is insertion order, so children inside
  // each parent come out in the same order as `nodes`. When sortByLabel is
  // false this preserves the caller's intended ordering at every level.
  for (const n of byId.values()) {
    if (n.parentId !== null && byId.has(n.parentId)) {
      const parent = byId.get(n.parentId)!;
      parent.children.push(n);
      n.depth = parent.depth + 1;
      // depth recomputation when the parent gets re-parented later is
      // skipped — categories in this codebase are at most 2 levels.
    } else {
      roots.push(n);
    }
  }
  if (sortByLabel) {
    const sortRec = (list: IndexedNode[]) => {
      list.sort((a, b) => a.label.localeCompare(b.label));
      list.forEach((c) => sortRec(c.children));
    };
    sortRec(roots);
  }
  return roots;
}

export function TreeMultiSelectCombobox({
  value,
  onChange,
  nodes,
  placeholder,
  searchPlaceholder,
  emptyText,
  removeTagAriaLabel,
  sortByLabel = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const wrap = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => indexTree(nodes, sortByLabel), [nodes, sortByLabel]);
  const byId = useMemo(() => {
    const m = new Map<number, TreeNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // When a query is active, auto-expand any branch that has a
  // descendant matching the query so matches are visible.
  const queryExpanded = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out = new Set<number>();
    const walk = (n: IndexedNode): boolean => {
      let anyMatch = n.label.toLowerCase().includes(q);
      for (const c of n.children) {
        if (walk(c)) anyMatch = true;
      }
      if (anyMatch && n.children.length > 0) out.add(n.id);
      return anyMatch;
    };
    tree.forEach(walk);
    return out;
  }, [tree, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrap.current) return;
      if (!wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggleSelect(id: number) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  function toggleExpand(id: number) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selected = value
    .map((id) => byId.get(id))
    .filter((n): n is TreeNode => Boolean(n));

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <div
        onClick={() => setOpen((x) => !x)}
        style={{
          minHeight: 40,
          padding: "8px 12px",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          background: "white",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        {selected.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
            {placeholder}
          </span>
        ) : (
          selected.map((s) => (
            <span
              key={s.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: "var(--scout-accent-50)",
                color: "var(--scout-accent-800)",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {s.label}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(s.id);
                }}
                aria-label={removeTagAriaLabel}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <Icon icon={X} size={10} />
              </button>
            </span>
          ))
        )}
      </div>

      {open ? (
        <div
          role="tree"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "0.5px solid var(--s-border-strong)",
            borderRadius: "var(--s-radius-md)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 100,
          }}
        >
          <div style={{ padding: 8, borderBottom: "0.5px solid var(--s-border)" }}>
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                width: "100%",
                height: 32,
                padding: "6px 10px",
                fontSize: 13,
                border: "0.5px solid var(--s-border)",
                borderRadius: "var(--s-radius-sm)",
                outline: "none",
              }}
            />
          </div>

          <div>
            {tree.length === 0 ? (
              <div
                style={{
                  padding: 12,
                  fontSize: 12,
                  color: "var(--s-text-tertiary)",
                  textAlign: "center",
                }}
              >
                {emptyText}
              </div>
            ) : (
              <TreeBody
                nodes={tree}
                value={value}
                expanded={expanded}
                queryExpanded={queryExpanded}
                query={query.trim().toLowerCase()}
                emptyText={emptyText}
                onToggleSelect={toggleSelect}
                onToggleExpand={toggleExpand}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TreeBody({
  nodes,
  value,
  expanded,
  queryExpanded,
  query,
  emptyText,
  onToggleSelect,
  onToggleExpand,
}: {
  nodes: IndexedNode[];
  value: number[];
  expanded: Set<number>;
  queryExpanded: Set<number> | null;
  query: string;
  emptyText: string;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
}) {
  // When filtering, hide branches that don't contribute to a match.
  // When not filtering, show everything per the user's expand state.
  const visible: IndexedNode[] = [];
  const matches = (n: IndexedNode): boolean => {
    if (!query) return true;
    if (n.label.toLowerCase().includes(query)) return true;
    return n.children.some(matches);
  };
  for (const n of nodes) {
    if (matches(n)) visible.push(n);
  }
  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: "var(--s-text-tertiary)",
          textAlign: "center",
        }}
      >
        {emptyText}
      </div>
    );
  }
  return (
    <>
      {visible.map((n) => (
        <TreeRow
          key={n.id}
          node={n}
          value={value}
          expanded={expanded}
          queryExpanded={queryExpanded}
          query={query}
          emptyText={emptyText}
          onToggleSelect={onToggleSelect}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  );
}

function TreeRow({
  node,
  value,
  expanded,
  queryExpanded,
  query,
  emptyText,
  onToggleSelect,
  onToggleExpand,
}: {
  node: IndexedNode;
  value: number[];
  expanded: Set<number>;
  queryExpanded: Set<number> | null;
  query: string;
  emptyText: string;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
}) {
  const isSelected = value.includes(node.id);
  const isExpanded = queryExpanded ? queryExpanded.has(node.id) : expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 6px 8px",
          paddingLeft: 8 + node.depth * 16,
          fontSize: 13,
          background: isSelected ? "var(--scout-accent-50)" : "transparent",
          color: isSelected ? "var(--scout-accent-800)" : "var(--s-text)",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "var(--s-surface-alt)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        <span
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (hasChildren) onToggleExpand(node.id);
          }}
          aria-hidden={!hasChildren}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            color: "var(--s-text-tertiary)",
            cursor: hasChildren ? "pointer" : "default",
            visibility: hasChildren ? "visible" : "hidden",
          }}
        >
          <Icon icon={isExpanded ? ChevronDown : ChevronRight} size={12} />
        </span>

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onToggleSelect(node.id);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            border: `1px solid ${isSelected ? "var(--scout-accent)" : "var(--s-border-strong)"}`,
            borderRadius: 4,
            background: isSelected ? "var(--scout-accent)" : "white",
            color: "white",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
          aria-label={node.label}
        >
          {isSelected ? <Icon icon={Check} size={10} /> : <Icon icon={Plus} size={10} />}
        </button>

        <span
          onMouseDown={(e) => {
            e.preventDefault();
            onToggleSelect(node.id);
          }}
          style={{ flex: 1, userSelect: "none" }}
        >
          {node.label}
        </span>
      </div>

      {hasChildren && isExpanded ? (
        <TreeBody
          nodes={node.children}
          value={value}
          expanded={expanded}
          queryExpanded={queryExpanded}
          query={query}
          emptyText={emptyText}
          onToggleSelect={onToggleSelect}
          onToggleExpand={onToggleExpand}
        />
      ) : null}
    </div>
  );
}
