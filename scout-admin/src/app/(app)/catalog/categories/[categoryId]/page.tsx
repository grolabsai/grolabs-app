import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCategoryDetail } from "@/lib/actions/category";
import { VariantAxisConfig } from "@/components/catalog/VariantAxisConfig";

interface Props {
  params: Promise<{ categoryId: string }>;
}

export default async function CategoryDetailPage({ params }: Props) {
  const { categoryId: rawId } = await params;
  const categoryId = parseInt(rawId, 10);

  if (isNaN(categoryId)) {
    redirect("/catalog/categories");
  }

  const { category, attributes, breadcrumb } =
    await loadCategoryDetail(categoryId);

  if (!category) {
    redirect("/catalog/categories");
  }

  return (
    <div className="cat-detail">
      {/* Breadcrumb */}
      <nav className="cd-breadcrumb">
        <Link href="/catalog/categories" className="cd-bc-link">
          Categorías
        </Link>
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id}>
            <span className="cd-bc-sep"> › </span>
            {i < breadcrumb.length - 1 ? (
              <Link
                href={`/catalog/categories/${crumb.id}`}
                className="cd-bc-link"
              >
                {crumb.name}
              </Link>
            ) : (
              <span className="cd-bc-current">{crumb.name}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Header */}
      <div className="cd-header">
        <h1 className="cd-title">{category.category_name}</h1>
        <span className="cd-badge">
          L{category.level}
          {!category.is_active && " · Inactiva"}
        </span>
      </div>

      {category.description && (
        <p className="cd-description">{category.description}</p>
      )}

      <hr className="cd-divider" />

      {/* Variant axis config */}
      <VariantAxisConfig
        categoryId={category.category_id}
        categoryName={category.category_name}
        initialAxes={category.default_variant_axes ?? []}
        initialNote={category.parsing_note}
        attributes={attributes}
      />

      <style>{`
        .cat-detail { padding: 28px 32px; max-width: 760px; }
        .cd-breadcrumb {
          font-size: 12px; margin-bottom: 16px;
          color: var(--s-muted, #73726c);
        }
        .cd-bc-link {
          color: var(--s-muted, #73726c); text-decoration: none;
        }
        .cd-bc-link:hover { color: var(--s-accent, #378ADD); }
        .cd-bc-sep { color: var(--s-border, #d5d2ca); margin: 0 2px; }
        .cd-bc-current {
          color: var(--s-text, #23211d); font-weight: 500;
        }
        .cd-header {
          display: flex; align-items: center;
          justify-content: space-between; margin-bottom: 8px;
        }
        .cd-title {
          font-size: 18px; font-weight: 600;
          color: var(--s-text, #23211d); margin: 0;
        }
        .cd-badge {
          font-size: 11px; padding: 3px 10px; border-radius: 6px;
          background: var(--s-surface, #f5f2eb);
          color: var(--s-muted, #73726c);
        }
        .cd-description {
          font-size: 13px; color: var(--s-muted, #73726c);
          line-height: 1.5; margin: 0 0 16px;
        }
        .cd-divider {
          border: none; border-top: 1px solid var(--s-border, #e5e2da);
          margin: 16px 0;
        }
      `}</style>
    </div>
  );
}
