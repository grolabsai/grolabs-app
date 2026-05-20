import { Link } from "@/i18n/routing";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import {
  CategoryAttributeSection,
  type CategoryAttrLink,
  type AvailableAttr,
} from "@/components/catalog/CategoryAttributeSection";
import { initialsFromName } from "@/lib/format";

/**
 * Categories screen. Split layout:
 *   - Left: species filter pills + search + 2-level tree of categories
 *   - Right: detail accordion for the selected category
 *
 * Selection is driven by `?id=<category_id>` in the URL. This makes
 * deep-linking work (you can paste the URL and land on the same category)
 * and means every "click a tree node" is a normal `<Link>` — no
 * client-side state machine.
 *
 * Read-only this pass per the MVP spec (D24 phasing). Pencils and
 * picker controls are deferred to Phase 1.5.
 */

export const dynamic = "force-dynamic";

type SearchParams = {
  id?: string;
  species?: string;
  q?: string;
};

type CategoryNode = {
  category_id: number;
  parent_category_id: number | null;
  category_code: string | null;
  category_name: string;
  slug: string;
  description: string | null;
  level: number;
  sort_order: number | null;
  is_active: boolean;
  template_ref_id: number | null;
  parsing_note: string | null;
};

type SpeciesRef = {
  species_id: number;
  name: string;
  slug: string;
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const speciesFilter = sp.species ?? "all";
  const search = (sp.q ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const instanceId = await currentInstanceId();
  if (instanceId === null) {
    // Shouldn't happen — (app)/layout.tsx rejects unauthenticated requests.
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">Sesión expirada</span>
          <span className="s-strip-text">Volvé a iniciar sesión.</span>
        </div>
      </div>
    );
  }

  /* -----------------------------------------------------------
   *  Load this instance's categories (~58 rows for Wazu).
   *  Per D26, RLS now scopes to the user's instance only — no
   *  template leakage. The explicit .eq() filter is for clarity
   *  and as a belt-and-suspenders defense.
   * ----------------------------------------------------------- */
  const { data: cats } = await supabase
    .from("category")
    .select(
      "category_id, parent_category_id, category_code, category_name, slug, description, level, sort_order, is_active, template_ref_id, parsing_note",
    )
    .eq("instance_id", instanceId)
    .order("level", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<CategoryNode[]>();

  const allCats = cats ?? [];

  /* -----------------------------------------------------------
   *  Species list for the filter pills (instance-scoped)
   * ----------------------------------------------------------- */
  const { data: species } = await supabase
    .from("species")
    .select("species_id, name, slug")
    .eq("instance_id", instanceId)
    .order("menu_order", { ascending: true, nullsFirst: false })
    .returns<SpeciesRef[]>();
  const speciesList = species ?? [];

  /* -----------------------------------------------------------
   *  Apply species filter — limits which L2 categories appear in
   *  the tree (and which L1 nodes survive). When 'all' is selected,
   *  the full tree shows.
   * ----------------------------------------------------------- */
  let visibleCategoryIds: Set<number> | null = null;

  if (speciesFilter !== "all") {
    const filterSpecies = speciesList.find((s) => s.slug === speciesFilter);
    if (filterSpecies) {
      const { data: links } = await supabase
        .from("category_species")
        .select("category_id")
        .eq("instance_id", instanceId)
        .eq("species_id", filterSpecies.species_id)
        .eq("active_for_species", true);
      const linked = new Set((links ?? []).map((r) => r.category_id as number));
      // Add any L1 parents whose children are in the filter
      const expanded = new Set(linked);
      for (const cat of allCats) {
        if (cat.level === 2 && cat.parent_category_id && linked.has(cat.category_id)) {
          expanded.add(cat.parent_category_id);
        }
      }
      visibleCategoryIds = expanded;
    }
  }

  /* -----------------------------------------------------------
   *  Apply search filter on top of species filter
   * ----------------------------------------------------------- */
  if (search) {
    const matched = new Set<number>();
    for (const cat of allCats) {
      if (visibleCategoryIds && !visibleCategoryIds.has(cat.category_id)) continue;
      if (cat.category_name.toLowerCase().includes(search)) {
        matched.add(cat.category_id);
        if (cat.parent_category_id) matched.add(cat.parent_category_id);
      }
    }
    visibleCategoryIds = matched;
  }

  /* -----------------------------------------------------------
   *  Build the tree shape from the flat list
   * ----------------------------------------------------------- */
  const filtered = visibleCategoryIds
    ? allCats.filter((c) => visibleCategoryIds!.has(c.category_id))
    : allCats;

  const l1 = filtered.filter((c) => c.level === 1);
  const childrenByParent = new Map<number, CategoryNode[]>();
  for (const c of filtered) {
    if (c.level === 2 && c.parent_category_id) {
      const arr = childrenByParent.get(c.parent_category_id) ?? [];
      arr.push(c);
      childrenByParent.set(c.parent_category_id, arr);
    }
  }

  /* -----------------------------------------------------------
   *  Selected category
   * ----------------------------------------------------------- */
  const requestedId = sp.id ? Number(sp.id) : NaN;
  const selectedId = Number.isFinite(requestedId)
    ? requestedId
    : // Default to the first L2 if any are visible, else the first L1
      filtered.find((c) => c.level === 2)?.category_id ??
      filtered.find((c) => c.level === 1)?.category_id ??
      null;

  const selected = selectedId
    ? allCats.find((c) => c.category_id === selectedId) ?? null
    : null;

  /* -----------------------------------------------------------
   *  Counts for the header
   * ----------------------------------------------------------- */
  const totalL1 = allCats.filter((c) => c.level === 1).length;
  const totalL2 = allCats.filter((c) => c.level === 2).length;

  /* -----------------------------------------------------------
   *  Build the species-filter href set, preserving id when present
   * ----------------------------------------------------------- */
  const speciesHref = (slug: string): Route => {
    const params = new URLSearchParams();
    if (slug !== "all") params.set("species", slug);
    if (sp.id) params.set("id", sp.id);
    if (search) params.set("q", search);
    const qs = params.toString();
    return (qs ? `/catalog/categories?${qs}` : "/catalog/categories") as Route;
  };

  return (
    <div className="s-content">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          paddingBottom: 14,
          borderBottom: "0.5px solid var(--s-border)",
        }}
      >
        <div className="s-breadcrumb">
          <Link href={"/catalog/products" as Route}>Catálogo</Link>
          <span className="s-breadcrumb-sep">/</span>
          <span>Categorías</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">Categorías</h1>
          <p className="s-meta">
            {totalL1} categorías nivel 1 · {totalL2} nivel 2 ·{" "}
            {totalL1 + totalL2} totales
          </p>
        </div>
        <div className="s-title-actions">
          <button className="s-btn s-btn-ghost" type="button" disabled>
            Importar
          </button>
          <button
            className="s-btn s-btn-primary"
            type="button"
            disabled
            title="Crear categoría — próximamente"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M7 2v10M2 7h10" />
            </svg>
            Nueva categoría
          </button>
        </div>
      </div>

      <div className="s-split">
        {/* ============== TREE ============== */}
        <aside className="s-split-aside">
          <p className="s-aside-section-label">Filtrar por especie</p>
          <div className="s-pill-row">
            <Link
              href={speciesHref("all")}
              className={`s-pill${speciesFilter === "all" ? " active" : ""}`}
            >
              Todas
            </Link>
            {speciesList.map((s) => (
              <Link
                key={s.species_id}
                href={speciesHref(s.slug)}
                className={`s-pill${speciesFilter === s.slug ? " active" : ""}`}
              >
                {s.name === "Perro" ? "Perros" : s.name === "Gato" ? "Gatos" : s.name}
              </Link>
            ))}
          </div>

          {/* Search — read-only form that submits via GET to the same page */}
          <form method="get" action="/catalog/categories">
            {speciesFilter !== "all" ? (
              <input type="hidden" name="species" value={speciesFilter} />
            ) : null}
            {sp.id ? <input type="hidden" name="id" value={sp.id} /> : null}
            <div className="s-aside-search">
              <svg
                className="s-aside-search-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3 3" />
              </svg>
              <input
                type="text"
                name="q"
                defaultValue={search}
                placeholder="Buscar categoría…"
              />
            </div>
          </form>

          {l1.length === 0 ? (
            <div
              style={{
                padding: 20,
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                textAlign: "center",
              }}
            >
              No hay categorías que coincidan.
            </div>
          ) : (
            <ul className="s-tree">
              {l1.map((parent) => {
                const kids = childrenByParent.get(parent.category_id) ?? [];
                const containsSelected =
                  parent.category_id === selectedId ||
                  kids.some((k) => k.category_id === selectedId);
                // We expand any L1 that contains the selected node, or — if
                // search is active — all L1s with surviving kids.
                const expanded = containsSelected || (!!search && kids.length > 0);

                const parentHref = buildHref({
                  id: parent.category_id,
                  species: speciesFilter,
                  q: search,
                });

                return (
                  <li key={parent.category_id}>
                    <Link
                      href={parentHref}
                      className={`s-tree-l1${expanded ? " expanded" : ""}`}
                      style={{ textDecoration: "none" }}
                    >
                      <svg
                        className="s-tree-caret"
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                      >
                        <path d="M4 2l4 4-4 4z" />
                      </svg>
                      <svg
                        className="s-tree-icon"
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M2 4a1 1 0 011-1h3l1 2h6a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
                      </svg>
                      <span>{parent.category_name}</span>
                      {kids.length > 0 ? (
                        <span className="s-tree-count">{kids.length}</span>
                      ) : null}
                    </Link>
                    {expanded && kids.length > 0 ? (
                      <ul className="s-tree-children">
                        {kids.map((kid) => {
                          const kidHref = buildHref({
                            id: kid.category_id,
                            species: speciesFilter,
                            q: search,
                          });
                          return (
                            <li key={kid.category_id}>
                              <Link
                                href={kidHref}
                                className={`s-tree-l2${
                                  kid.category_id === selectedId ? " selected" : ""
                                }`}
                              >
                                <svg
                                  className="s-tree-icon"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                >
                                  <rect x="3" y="3" width="10" height="10" rx="1" />
                                </svg>
                                <span>{kid.category_name}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ============== DETAIL ============== */}
        <section className="s-split-main">
          {selected ? (
            <CategoryDetail category={selected} allCats={allCats} instanceId={instanceId} />
          ) : (
            <div className="s-empty">
              <div className="s-empty-title">Sin categoría seleccionada</div>
              <div className="s-empty-sub">
                Elegí una categoría del árbol para ver sus detalles.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* =====================================================================
 *  CategoryDetail — fetches per-selection data, renders accordion cards
 * ===================================================================== */

async function CategoryDetail({
  category,
  allCats,
  instanceId,
}: {
  category: CategoryNode;
  allCats: CategoryNode[];
  instanceId: number;
}) {
  const supabase = await createClient();
  const parent = category.parent_category_id
    ? allCats.find((c) => c.category_id === category.parent_category_id) ?? null
    : null;

  /* ------------- Per-species overrides ------------- */
  const { data: speciesLinks } = await supabase
    .from("category_species")
    .select(
      `category_species_id,
       species_id,
       active_for_species,
       show_in_species_menu,
       show_in_header,
       navigation_title,
       header_title,
       visual_order,
       species:species_id ( name, slug )`,
    )
    .eq("instance_id", instanceId)
    .eq("category_id", category.category_id);

  /* ------------- Ancestor chain (root → current) ------------- */
  const ancestorIds: number[] = [];
  {
    const byId = new Map(allCats.map((c) => [c.category_id, c]));
    let cur: CategoryNode | undefined = byId.get(category.category_id);
    while (cur) {
      ancestorIds.unshift(cur.category_id);
      cur = cur.parent_category_id ? byId.get(cur.parent_category_id) : undefined;
    }
  }

  /* ------------- All attribute links across ancestor chain ------------- */
  const { data: allAttrLinksRaw } = await supabase
    .from("category_product_attribute")
    .select(
      `mapping_id,
       category_id,
       is_variant_axis,
       requirement_level,
       attribute:attribute_id (
         attribute_id,
         attribute_code,
         attribute_name,
         data_type,
         is_multivalue
       )`,
    )
    .eq("instance_id", instanceId)
    .in("category_id", ancestorIds);

  // Walk root→leaf; leaf's row wins per attribute_id
  const catNameById = new Map(allCats.map((c) => [c.category_id, c.category_name]));
  const linkByAttrId = new Map<number, CategoryAttrLink>();
  for (const catId of ancestorIds) {
    for (const raw of (allAttrLinksRaw ?? []).filter(
      (l) => (l.category_id as number) === catId,
    )) {
      const attr = normalizeOne(raw.attribute);
      if (!attr) continue;
      const attrId = attr.attribute_id as number;
      linkByAttrId.set(attrId, {
        mapping_id: raw.mapping_id as number,
        attribute_id: attrId,
        attribute_code: attr.attribute_code as string,
        attribute_name: attr.attribute_name as string,
        data_type: attr.data_type as string | null,
        is_multivalue: attr.is_multivalue as boolean,
        is_variant_axis: raw.is_variant_axis as boolean,
        requirement_level: raw.requirement_level as string | null,
        from_category_id: catId,
        from_category_name: catNameById.get(catId) ?? "",
      });
    }
  }

  const resolvedLinks = [...linkByAttrId.values()];
  const ownAttrLinks = resolvedLinks.filter(
    (l) => l.from_category_id === category.category_id,
  );
  const inheritedAttrLinks = resolvedLinks.filter(
    (l) => l.from_category_id !== category.category_id,
  );

  /* ------------- All instance attributes for the add popover ------------- */
  const { data: allInstanceAttrsRaw } = await supabase
    .from("product_attribute")
    .select("attribute_id, attribute_code, attribute_name, data_type")
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .order("attribute_name");

  const allInstanceAttrs: AvailableAttr[] = (allInstanceAttrsRaw ?? []).map((a) => ({
    attribute_id: a.attribute_id as number,
    attribute_code: a.attribute_code as string,
    attribute_name: a.attribute_name as string,
    data_type: a.data_type as string | null,
  }));

  /* ------------- Products in this category ------------- */
  const { data: productLinks } = await supabase
    .from("product_category_link")
    .select(
      `is_primary,
       product:product_id (
         product_id,
         product_name,
         slug,
         is_active,
         brand:brand_id ( brand_name ),
         product_variant ( variant_id )
       )`,
    )
    .eq("instance_id", instanceId)
    .eq("category_id", category.category_id);

  return (
    <>
      {/* ---- Card 1: Header (metadata) — open by default ---- */}
      <details className="s-acc s-acc-h-card" open>
        <summary className="s-acc-summary">
          <svg
            className="s-acc-chev"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5 3l5 5-5 5z" />
          </svg>
          <div className="s-acc-pic">
            <svg
              width="20"
              height="20"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 4a1 1 0 011-1h3l1 2h6a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <span className="s-acc-title">{category.category_name}</span>
          {category.is_active ? (
            <span className="s-acc-status">Activa</span>
          ) : (
            <span
              className="s-acc-status"
              style={{
                background: "var(--s-surface-alt)",
                color: "var(--s-text-secondary)",
              }}
            >
              Inactiva
            </span>
          )}
        </summary>
        <div className="s-acc-body">
          {parent ? (
            <div className="s-def-row">
              <div className="s-def-row-label">Padre</div>
              <div className="s-def-row-value">
                <Link
                  href={
                    `/catalog/categories?id=${parent.category_id}` as Route
                  }
                >
                  {parent.category_name}
                </Link>
              </div>
            </div>
          ) : null}
          <div className="s-def-row">
            <div className="s-def-row-label">Slug</div>
            <div className="s-def-row-value">
              <span style={{ fontFamily: "var(--s-font-mono)", fontSize: 12 }}>
                {category.slug}
              </span>
            </div>
          </div>
          <div className="s-def-row">
            <div className="s-def-row-label">Nivel</div>
            <div className="s-def-row-value">{category.level}</div>
          </div>
          {category.sort_order !== null ? (
            <div className="s-def-row">
              <div className="s-def-row-label">Orden</div>
              <div className="s-def-row-value tabular">
                {category.sort_order}
              </div>
            </div>
          ) : null}
          <div className="s-def-row">
            <div className="s-def-row-label">Origen</div>
            <div className="s-def-row-value">
              {category.template_ref_id !== null
                ? "Plantilla del sistema"
                : "Personalizada"}
            </div>
          </div>
        </div>
      </details>

      {/* ---- Card 2: Per-species — collapsed by default ---- */}
      <details className="s-acc">
        <summary className="s-acc-summary">
          <svg
            className="s-acc-chev"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5 3l5 5-5 5z" />
          </svg>
          <span className="s-acc-title">Configuración por especie</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {speciesLinks?.length ?? 0}
          </span>
        </summary>
        <div className="s-acc-body">
          {!speciesLinks || speciesLinks.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                padding: "8px 0",
              }}
            >
              Esta categoría no está asignada a ninguna especie.
            </div>
          ) : (
            <div className="s-species-grid">
              {speciesLinks.map((sl) => {
                const sp = normalizeOne(sl.species);
                const speciesName = sp?.name ?? "";
                const displayName =
                  speciesName === "Perro"
                    ? "Perros"
                    : speciesName === "Gato"
                      ? "Gatos"
                      : speciesName;
                return (
                  <div
                    key={sl.category_species_id as number}
                    className="s-species-card"
                  >
                    <div className="s-species-card-h">
                      <span className="s-species-card-badge">
                        {displayName}
                      </span>
                      {sl.active_for_species ? (
                        <span
                          className="s-tag s-tag-success"
                          style={{ marginLeft: "auto" }}
                        >
                          Visible
                        </span>
                      ) : (
                        <span
                          className="s-tag s-tag-neutral"
                          style={{ marginLeft: "auto" }}
                        >
                          Oculta
                        </span>
                      )}
                    </div>
                    <div className="s-species-card-row">
                      <span className="lbl">Título nav</span>
                      <span className="val">
                        {(sl.navigation_title as string | null) ?? (
                          <span style={{ color: "var(--s-text-muted)" }}>—</span>
                        )}
                      </span>
                    </div>
                    <div className="s-species-card-row">
                      <span className="lbl">Título header</span>
                      <span className="val">
                        {(sl.header_title as string | null) ?? (
                          <span style={{ color: "var(--s-text-muted)" }}>—</span>
                        )}
                      </span>
                    </div>
                    <div className="s-species-card-row">
                      <span className="lbl">Orden</span>
                      <span className="val tabular">
                        {(sl.visual_order as number | null) ?? (
                          <span style={{ color: "var(--s-text-muted)" }}>—</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>

      {/* ---- Card 3: Atributos (unified — own + inherited, editable) ---- */}
      <details className="s-acc">
        <summary className="s-acc-summary">
          <svg
            className="s-acc-chev"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5 3l5 5-5 5z" />
          </svg>
          <span className="s-acc-title">Atributos</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {resolvedLinks.length}
          </span>
        </summary>
        <div className="s-acc-body">
          <CategoryAttributeSection
            key={category.category_id}
            categoryId={category.category_id}
            categoryName={category.category_name}
            initialOwnLinks={ownAttrLinks}
            inheritedLinks={inheritedAttrLinks}
            allInstanceAttrs={allInstanceAttrs}
            parsingNote={category.parsing_note ?? null}
          />
        </div>
      </details>

      {/* ---- Card 4: Products — collapsed by default ---- */}
      <details className="s-acc">
        <summary className="s-acc-summary">
          <svg
            className="s-acc-chev"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5 3l5 5-5 5z" />
          </svg>
          <span className="s-acc-title">Productos en esta categoría</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {productLinks?.length ?? 0}
          </span>
        </summary>
        <div className="s-acc-body">
          {!productLinks || productLinks.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                padding: "8px 0",
              }}
            >
              Aún no hay productos asignados a esta categoría.
            </div>
          ) : (
            <table className="s-table-compact">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Marca</th>
                  <th style={{ textAlign: "right" }}>Variantes</th>
                </tr>
              </thead>
              <tbody>
                {productLinks.map((pl, idx) => {
                  const p = normalizeOne(pl.product);
                  if (!p) return null;
                  const brand = normalizeOne(p.brand);
                  const variantCount = Array.isArray(p.product_variant)
                    ? p.product_variant.length
                    : 0;
                  return (
                    <tr key={(p.product_id as number) ?? idx}>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <div className="s-prod-thumb" style={{ width: 28, height: 28 }}>
                            {initialsFromName(p.product_name as string)}
                          </div>
                          <div>
                            <Link
                              href={
                                `/catalog/products/${p.product_id}` as Route
                              }
                              style={{
                                color: "var(--s-text)",
                                textDecoration: "none",
                                fontWeight: 500,
                              }}
                            >
                              {p.product_name as string}
                            </Link>
                            <div
                              style={{
                                fontSize: 10,
                                color: "var(--s-text-tertiary)",
                              }}
                            >
                              {pl.is_primary ? "primaria" : "secundaria"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        style={{
                          color: "var(--s-text-secondary)",
                          fontSize: 12,
                        }}
                      >
                        {brand?.brand_name ?? ""}
                      </td>
                      <td
                        className="tabular"
                        style={{ textAlign: "right", fontSize: 12 }}
                      >
                        {variantCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </details>

    </>
  );
}

/* ---------------------------------------------------------------------
 *  Helpers
 * --------------------------------------------------------------------- */

// Supabase types relations as `T | T[] | null` depending on cardinality.
// For maybeSingle joins we always want one shape — normalize.
function normalizeOne<T>(rel: T | T[] | null | undefined): T | null {
  if (rel === null || rel === undefined) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

function buildHref({
  id,
  species,
  q,
}: {
  id: number;
  species: string;
  q: string;
}): Route {
  const params = new URLSearchParams();
  params.set("id", String(id));
  if (species && species !== "all") params.set("species", species);
  if (q) params.set("q", q);
  return `/catalog/categories?${params.toString()}` as Route;
}
