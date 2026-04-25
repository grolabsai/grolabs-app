import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";

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

export default async function CategoriesPage() {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();

  const { data: categories } = await supabase
    .from("category")
    .select(
      "category_id, category_name, slug, level, parent_category_id, is_active, sort_order, default_variant_axes"
    )
    .eq("instance_id", instanceId)
    .order("level", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("category_name", { ascending: true });

  const cats = categories ?? [];
  const l1 = cats.filter((c) => c.level === 1);
  const l2 = cats.filter((c) => c.level === 2);

  // Count L2 children per L1
  const childCount: Record<number, number> = {};
  for (const c of l2) {
    if (c.parent_category_id) {
      childCount[c.parent_category_id] = (childCount[c.parent_category_id] ?? 0) + 1;
    }
  }

  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--s-text)" }}>Categorías</h1>
        <div style={{ fontSize: 12, color: "var(--s-muted)" }}>
          {l1.length} L1 · {l2.length} L2 · {cats.length} total
        </div>
      </div>

      <div className="cat-tree">
        {l1.map((parent) => {
          const children = l2.filter((c) => c.parent_category_id === parent.category_id);
          return (
            <div key={parent.category_id} className="cat-group">
              {/* L1 row */}
              <Link
                href={`/catalog/categories/${parent.category_id}`}
                className="cat-row cat-row--l1"
              >
                <span className="cat-name">{parent.category_name}</span>
                <span className="cat-meta">
                  {children.length > 0 && (
                    <span className="cat-count">{children.length}</span>
                  )}
                  {parent.default_variant_axes && parent.default_variant_axes.length > 0 && (
                    <span className="cat-axes">
                      {parent.default_variant_axes.join(", ")}
                    </span>
                  )}
                  {!parent.is_active && <span className="cat-inactive">Inactiva</span>}
                </span>
              </Link>

              {/* L2 children */}
              {children.map((child) => (
                <Link
                  key={child.category_id}
                  href={`/catalog/categories/${child.category_id}`}
                  className="cat-row cat-row--l2"
                >
                  <span className="cat-name">{child.category_name}</span>
                  <span className="cat-meta">
                    {child.default_variant_axes && child.default_variant_axes.length > 0 && (
                      <span className="cat-axes">
                        {child.default_variant_axes.join(", ")}
                      </span>
                    )}
                    {!child.is_active && <span className="cat-inactive">Inactiva</span>}
                  </span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <style>{`
        .cat-tree { }
        .cat-group { margin-bottom: 2px; }
        .cat-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px; text-decoration: none; color: inherit;
          border: 1px solid var(--s-border, #e5e2da); border-radius: 0;
          transition: background 0.1s;
        }
        .cat-row:hover { background: var(--s-surface, #f5f2eb); }
        .cat-row--l1 {
          background: var(--s-bg, #fff); font-weight: 600; font-size: 13px;
          border-radius: 6px 6px 0 0; margin-bottom: 1px;
        }
        .cat-row--l2 {
          background: var(--s-bg, #fff); font-size: 13px;
          padding-left: 32px; margin-bottom: 1px;
        }
        .cat-row--l2:last-child { border-radius: 0 0 6px 6px; }
        .cat-name { color: var(--s-text, #23211d); }
        .cat-meta { display: flex; gap: 8px; align-items: center; }
        .cat-count {
          font-size: 11px; color: var(--s-muted, #73726c);
          background: var(--s-surface, #f5f2eb);
          padding: 1px 8px; border-radius: 4px;
        }
        .cat-axes {
          font-size: 10px; color: var(--s-accent, #378ADD);
          font-family: var(--font-mono, monospace);
          background: #e8f0fa; padding: 1px 6px; border-radius: 3px;
        }
        .cat-inactive {
          font-size: 10px; color: var(--s-muted, #73726c);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
