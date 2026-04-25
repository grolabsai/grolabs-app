import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { CategoryTree } from "@/components/catalog/CategoryTree";

export default async function CategoriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  // Get species for the filter pills
  const { data: species } = await supabase
    .from("species")
    .select("species_id, species_name")
    .eq("instance_id", instanceId)
    .order("species_name");

  return (
    <div className="cat-split">
      <CategoryTree
        categories={categories ?? []}
        species={species ?? []}
      />
      <div className="cat-detail-panel">
        {children}
      </div>
      <style>{`
        .cat-split {
          display: grid;
          grid-template-columns: 280px 1fr;
          min-height: calc(100vh - 60px);
        }
        .cat-tree-panel {
          background: var(--s-surface-alt, #f6f8fa);
          border-right: 1px solid var(--s-border, #d0d7de);
          padding: 16px 12px;
          overflow-y: auto;
          max-height: calc(100vh - 60px);
          position: sticky;
          top: 60px;
        }
        .cat-detail-panel {
          overflow-y: auto;
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
