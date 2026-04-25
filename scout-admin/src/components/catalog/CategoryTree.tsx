"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Category {
  category_id: number;
  category_name: string;
  slug: string;
  level: number;
  parent_category_id: number | null;
  is_active: boolean;
  sort_order: number | null;
  default_variant_axes: string[] | null;
}

interface Species {
  species_id: number;
  species_name: string;
}

export function CategoryTree({
  categories,
  species,
}: {
  categories: Category[];
  species: Species[];
}) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [speciesFilter, setSpeciesFilter] = useState<number | null>(null);

  const l1 = useMemo(() => categories.filter((c) => c.level === 1), [categories]);
  const l2 = useMemo(() => categories.filter((c) => c.level === 2), [categories]);

  const filtered = useMemo(() => {
    if (!search.trim()) return l1;
    const q = search.toLowerCase();
    return l1.filter((p) => {
      if (p.category_name.toLowerCase().includes(q)) return true;
      return l2.some(
        (c) =>
          c.parent_category_id === p.category_id &&
          c.category_name.toLowerCase().includes(q)
      );
    });
  }, [l1, l2, search]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isSelected(id: number) {
    return pathname === `/catalog/categories/${id}`;
  }

  const totalL1 = l1.length;
  const totalL2 = l2.length;

  return (
    <div className="cat-tree-panel">
      {/* Species filter */}
      {species.length > 0 && (
        <>
          <p className="ct-section">Filtrar por especie</p>
          <div className="ct-species-row">
            <button
              className={`ct-pill ${speciesFilter === null ? "ct-pill--active" : ""}`}
              onClick={() => setSpeciesFilter(null)}
            >
              Todas
            </button>
            {species.map((sp) => (
              <button
                key={sp.species_id}
                className={`ct-pill ${speciesFilter === sp.species_id ? "ct-pill--active" : ""}`}
                onClick={() =>
                  setSpeciesFilter(
                    speciesFilter === sp.species_id ? null : sp.species_id
                  )
                }
              >
                {sp.species_name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Search */}
      <div className="ct-search-wrap">
        <svg className="ct-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" />
        </svg>
        <input
          className="ct-search"
          placeholder="Buscar categoría…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Stats */}
      <p className="ct-stats">{totalL1} L1 · {totalL2} L2 · {categories.length} total</p>

      {/* Tree */}
      <ul className="ct-list">
        {filtered.map((parent) => {
          const children = l2.filter(
            (c) => c.parent_category_id === parent.category_id
          );
          const isExpanded = expanded.has(parent.category_id);
          const parentSelected = isSelected(parent.category_id);

          return (
            <li key={parent.category_id}>
              <div className={`ct-l1 ${isExpanded ? "ct-l1--expanded" : ""}`}>
                <button
                  className="ct-caret-btn"
                  onClick={() => toggle(parent.category_id)}
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  <svg className={`ct-caret ${isExpanded ? "ct-caret--open" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M4 2l4 4-4 4z" />
                  </svg>
                </button>
                <svg className="ct-folder" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4a1 1 0 011-1h3l1 2h6a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
                </svg>
                <Link
                  href={`/catalog/categories/${parent.category_id}`}
                  className={`ct-name ${parentSelected ? "ct-name--selected" : ""}`}
                >
                  {parent.category_name}
                </Link>
                <span className="ct-count">{children.length}</span>
              </div>

              {isExpanded && children.length > 0 && (
                <ul className="ct-children">
                  {children.map((child) => {
                    const childSelected = isSelected(child.category_id);
                    return (
                      <li key={child.category_id}>
                        <Link
                          href={`/catalog/categories/${child.category_id}`}
                          className={`ct-l2 ${childSelected ? "ct-l2--selected" : ""}`}
                        >
                          <svg className="ct-leaf" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="3" width="10" height="10" rx="1" />
                          </svg>
                          {child.category_name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <style>{`
        .ct-section {
          font-size: 10px; font-weight: 500; color: var(--s-text-tertiary, #818b98);
          text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 8px; padding: 0 6px;
        }
        .ct-species-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
        .ct-pill {
          display: inline-flex; align-items: center; padding: 4px 11px;
          background: var(--s-surface, #fff); border: 1px solid var(--s-border, #d0d7de);
          border-radius: 999px; font-size: 12px; color: var(--s-text-secondary, #656d76);
          cursor: pointer; font-family: inherit; user-select: none;
        }
        .ct-pill:hover { border-color: var(--s-border-strong, #a8b1ba); color: var(--s-text, #1f2328); }
        .ct-pill--active {
          background: var(--scout-accent-50, #e6f1fb); border-color: var(--scout-accent, #378ADD);
          color: var(--scout-accent-800, #0C447C); font-weight: 500;
        }
        .ct-search-wrap { position: relative; margin-bottom: 10px; }
        .ct-search-icon { position: absolute; left: 9px; top: 9px; color: var(--s-text-tertiary, #818b98); }
        .ct-search {
          width: 100%; height: 32px; padding: 0 10px 0 30px;
          background: var(--s-surface, #fff); border: 1px solid var(--s-border, #d0d7de);
          border-radius: 6px; font-size: 12px; font-family: inherit;
          color: var(--s-text, #1f2328); outline: none; box-sizing: border-box;
        }
        .ct-search:focus { border-color: var(--scout-accent, #378ADD); }
        .ct-stats {
          font-size: 11px; color: var(--s-text-tertiary, #818b98);
          margin: 0 0 10px; padding: 0 6px;
        }
        .ct-list { list-style: none; padding: 0; margin: 0; }
        .ct-l1 {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 8px; border-radius: 6px; cursor: default;
          font-size: 13px; font-weight: 500; color: var(--s-text, #1f2328);
        }
        .ct-caret-btn {
          background: none; border: none; padding: 0; cursor: pointer;
          display: flex; align-items: center;
        }
        .ct-caret {
          width: 12px; height: 12px; color: var(--s-text-muted, #afb8c1);
          transition: transform 0.15s;
        }
        .ct-caret--open { transform: rotate(90deg); color: var(--scout-accent, #378ADD); }
        .ct-folder { color: var(--s-text-tertiary, #818b98); flex-shrink: 0; }
        .ct-l1--expanded .ct-folder { color: var(--scout-accent, #378ADD); }
        .ct-name {
          text-decoration: none; color: inherit; flex: 1;
        }
        .ct-name:hover { color: var(--scout-accent, #378ADD); }
        .ct-name--selected { color: var(--scout-accent-800, #0C447C) !important; }
        .ct-count {
          margin-left: auto; font-size: 11px; color: var(--s-text-muted, #afb8c1);
          font-variant-numeric: tabular-nums; font-weight: 400;
        }
        .ct-children { list-style: none; padding: 0 0 0 22px; margin: 2px 0; }
        .ct-l2 {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 8px; border-radius: 6px; cursor: pointer;
          font-size: 13px; color: var(--s-text-secondary, #656d76);
          text-decoration: none;
        }
        .ct-l2:hover { background: var(--s-surface-hover, #eaeef2); color: var(--s-text, #1f2328); }
        .ct-l2--selected {
          background: var(--scout-accent-50, #e6f1fb);
          color: var(--scout-accent-800, #0C447C); font-weight: 500;
        }
        .ct-leaf { color: var(--s-text-muted, #afb8c1); flex-shrink: 0; }
        .ct-l2--selected .ct-leaf { color: var(--scout-accent, #378ADD); }
      `}</style>
    </div>
  );
}
