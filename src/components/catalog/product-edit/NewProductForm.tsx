"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import { useRouter } from "@/i18n/routing";
import { Icon } from "@/components/ui/icon";
import { ChevronDown, Plus, Save, Trash2, Minus } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { TreeMultiSelectCombobox } from "@/components/ui/tree-multiselect";
import { PhotoManager, type PhotoState } from "./PhotoManager";
import {
  createProductFull,
  type CreateProductFullAttributeValue,
  type CreateProductFullInput,
} from "@/lib/actions/product";

// ─── Types (props) ──────────────────────────────────────────────────────────

export type ProductTypeOption = {
  product_type_id: number;
  type_name: string;
};

export type BrandOption = {
  brand_id: number;
  brand_name: string;
};

export type CategoryOption = {
  category_id: number;
  category_name: string;
  slug: string;
  level: number;
  parent_category_id: number | null;
};

export type AttributeOptionRow = {
  value_id: number;
  value: string;
  sort_order: number | null;
  is_active: boolean;
};

export type AxisAttribute = {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: "list" | "quantity" | "text";
  dimension: "mass" | "volume" | "count" | null;
  options: AttributeOptionRow[];
};

// Used by the descriptive attributes card. Mirrors the axis shape but
// keeps boolean as a recognised data_type even though the schema stores
// it via value_text='true'/'false' (the underlying column has no real
// boolean kind today — see /docs/state).
export type DescriptiveAttribute = {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string | null;
  options: AttributeOptionRow[];
  required: boolean;
  formOrder: number | null;
};

export type UnitOption = {
  unit_id: number;
  code: string;
  name: string;
  dimension: "mass" | "volume" | "count";
};

// Joined row out of category_product_attribute. Shared by the variant
// axis picker and the descriptive attributes card; the client filters
// these by selected categories and `is_variant_axis`.
export type CategoryAttributeMapping = {
  category_id: number;
  is_variant_axis: boolean;
  variant_axis_order: number | null;
  form_order: number | null;
  requirement_level: "required" | "optional" | "hidden" | null;
  attribute: {
    attribute_id: number;
    attribute_code: string;
    attribute_name: string;
    data_type: string | null;
    dimension: string | null;
    options: AttributeOptionRow[];
  };
};

type Props = {
  productTypes: ProductTypeOption[];
  brands: BrandOption[];
  categories: CategoryOption[];
  categoryAttributeMappings: CategoryAttributeMapping[];
  units: UnitOption[];
};

// ─── Local form state types ─────────────────────────────────────────────────

type VariantMode = "axis" | "manual";

type AxisValueDraft =
  | { kind: "list"; key: string; valueId: number | null }
  | { kind: "quantity"; key: string; number: string; unitId: number | null }
  | { kind: "text"; key: string; text: string };

type AxisDraft = {
  attributeId: number;
  values: AxisValueDraft[];
};

type VariantAxisCell = {
  attributeId: number;
  axisCode: string;
  axisName: string;
  display: string;
  valueId: number | null;
  valueText: string | null;
  valueNumber: number | null;
  unitId: number | null;
};

type Variant = {
  // Stable local key. For axis-mode rows it's derived from the axis
  // values (so we can match prior data when regenerating); for manual
  // rows it's a random id.
  key: string;
  name: string;
  axes: VariantAxisCell[];
  sku: string;
  barcode: string;
  weight: string;
  listPrice: string;
  costPrice: string;
  isActive: boolean;
};

// Stored values for descriptive attributes, keyed by attribute_code.
// Strings cover both text and list (option_id as string); booleans
// stay typed.
type AttributeFormValue = string | boolean;
type AttributeForm = Record<string, AttributeFormValue>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function cellDisplay(
  attr: AxisAttribute,
  v: AxisValueDraft,
  units: UnitOption[],
): string | null {
  if (v.kind === "list") {
    if (v.valueId === null) return null;
    const opt = attr.options.find((o) => o.value_id === v.valueId);
    return opt?.value ?? null;
  }
  if (v.kind === "quantity") {
    const num = v.number.trim();
    if (!num) return null;
    const unit = units.find((u) => u.unit_id === v.unitId);
    return unit ? `${num} ${unit.code}` : num;
  }
  if (v.kind === "text") {
    return v.text.trim() || null;
  }
  return null;
}

function cellPayload(
  attr: AxisAttribute,
  v: AxisValueDraft,
  display: string,
): VariantAxisCell {
  if (v.kind === "list") {
    return {
      attributeId: attr.attribute_id,
      axisCode: attr.attribute_code,
      axisName: attr.attribute_name,
      display,
      valueId: v.valueId,
      valueText: null,
      valueNumber: null,
      unitId: null,
    };
  }
  if (v.kind === "quantity") {
    return {
      attributeId: attr.attribute_id,
      axisCode: attr.attribute_code,
      axisName: attr.attribute_name,
      display,
      valueId: null,
      valueText: null,
      valueNumber: Number(v.number),
      unitId: v.unitId,
    };
  }
  return {
    attributeId: attr.attribute_id,
    axisCode: attr.attribute_code,
    axisName: attr.attribute_name,
    display,
    valueId: null,
    valueText: v.text.trim(),
    valueNumber: null,
    unitId: null,
  };
}

// Build the cartesian product of all current axis drafts. Each path is
// an array of (attribute, draft-value) pairs ready to become a Variant.
function generateAxisVariants(
  axes: AxisDraft[],
  attrIndex: Map<number, AxisAttribute>,
  units: UnitOption[],
): Variant[] {
  if (axes.length === 0) return [];

  const filledAxes: Array<{
    attr: AxisAttribute;
    cells: Array<{ display: string; cell: VariantAxisCell }>;
  }> = [];

  for (const draft of axes) {
    const attr = attrIndex.get(draft.attributeId);
    if (!attr) continue;
    const filled: Array<{ display: string; cell: VariantAxisCell }> = [];
    for (const v of draft.values) {
      const display = cellDisplay(attr, v, units);
      if (display === null) continue;
      filled.push({ display, cell: cellPayload(attr, v, display) });
    }
    if (filled.length === 0) {
      // An axis that hasn't been filled in yet shouldn't kill the whole
      // preview — but it also can't contribute. Skip it; the next
      // regenerate will pick it up once values land.
      continue;
    }
    filledAxes.push({ attr, cells: filled });
  }

  if (filledAxes.length === 0) return [];

  const combinations: VariantAxisCell[][] = [[]];
  for (const axis of filledAxes) {
    const next: VariantAxisCell[][] = [];
    for (const partial of combinations) {
      for (const cell of axis.cells) {
        next.push([...partial, cell.cell]);
      }
    }
    combinations.splice(0, combinations.length, ...next);
  }

  return combinations.map((cells) => {
    const display = cells.map((c) => c.display).join(" / ");
    return {
      key: cells.map((c) => `${c.axisCode}:${c.valueId ?? c.valueText ?? c.valueNumber ?? ""}-${c.unitId ?? ""}`).join("|") ||
        Math.random().toString(36).slice(2),
      name: display,
      axes: cells,
      sku: "",
      barcode: "",
      weight: "",
      listPrice: "",
      costPrice: "",
      isActive: true,
    };
  });
}

// ─── Top-level form ─────────────────────────────────────────────────────────

export function NewProductForm({
  productTypes,
  brands,
  categories,
  categoryAttributeMappings,
  units,
}: Props) {
  const t = useTranslations("product.create");
  const tFields = useTranslations("product.fields");
  const tDetail = useTranslations("product.detail");
  const tCommon = useTranslations("product.common");
  const router = useRouter();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const slugTouchedRef = useRef(false);
  const [shortDesc, setShortDesc] = useState("");
  const [longDesc, setLongDesc] = useState("");
  // Lazy initial state seeds the single-option case without an effect:
  // when the instance has exactly one product_type the field starts
  // pre-filled. Tenants with several types still get a clean —.
  const [productTypeId, setProductTypeId] = useState<number | null>(() =>
    productTypes.length === 1 ? productTypes[0].product_type_id : null,
  );
  const [brandId, setBrandId] = useState<number | null>(null);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [trackInventory, setTrackInventory] = useState(true);
  const [isConsignment, setIsConsignment] = useState(false);

  const [shortDescExpanded, setShortDescExpanded] = useState(false);
  const [longDescExpanded, setLongDescExpanded] = useState(false);

  const [variantMode, setVariantMode] = useState<VariantMode>("axis");
  const [axisDrafts, setAxisDrafts] = useState<AxisDraft[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);

  // Phase 2: descriptive attributes + photo gallery
  const [attributeForm, setAttributeForm] = useState<AttributeForm>({});
  const [photos, setPhotos] = useState<PhotoState[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // Derive axis + descriptive attribute lists from the user's category
  // picks. Both come out of the same category_product_attribute join;
  // is_variant_axis splits them. Dedupe by attribute_id (categories
  // overlap), and preserve the first-seen order plus form_order.
  const { axisAttributes, descriptiveAttributes } = useMemo(() => {
    const selected = new Set(categoryIds);
    const axesById = new Map<number, AxisAttribute>();
    const descById = new Map<number, DescriptiveAttribute>();

    for (const m of categoryAttributeMappings) {
      if (!selected.has(m.category_id)) continue;
      const a = m.attribute;
      const dt = a.data_type;
      if (m.is_variant_axis) {
        if (!axesById.has(a.attribute_id) && (dt === "list" || dt === "quantity" || dt === "text")) {
          axesById.set(a.attribute_id, {
            attribute_id: a.attribute_id,
            attribute_code: a.attribute_code,
            attribute_name: a.attribute_name,
            data_type: dt,
            dimension: a.dimension as "mass" | "volume" | "count" | null,
            options: a.options,
          });
        }
      } else {
        if (!descById.has(a.attribute_id)) {
          descById.set(a.attribute_id, {
            attribute_id: a.attribute_id,
            attribute_code: a.attribute_code,
            attribute_name: a.attribute_name,
            data_type: dt,
            options: a.options,
            required: m.requirement_level === "required",
            formOrder: m.form_order,
          });
        }
      }
    }

    const axes = [...axesById.values()];
    const desc = [...descById.values()].sort(
      (x, y) => (x.formOrder ?? 999) - (y.formOrder ?? 999),
    );
    return { axisAttributes: axes, descriptiveAttributes: desc };
  }, [categoryAttributeMappings, categoryIds]);

  // Index axes by id for cheap lookup inside the cartesian generator
  // and the axis editor sub-components.
  const attrIndex = useMemo(
    () => new Map(axisAttributes.map((a) => [a.attribute_id, a])),
    [axisAttributes],
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────

  // Regenerate variants from axis drafts and merge user-entered fields
  // (SKU, pricing, etc.) by matching the variant's stable axis-derived
  // key. Called from every handler that mutates axisDrafts so we never
  // run setState inside an effect (React 19 / Next 15 lint rule).
  function regenerate(nextDrafts: AxisDraft[]) {
    setAxisDrafts(nextDrafts);
    if (variantMode !== "axis") return;
    const next = generateAxisVariants(nextDrafts, attrIndex, units);
    setVariants((prev) => {
      const byKey = new Map(prev.map((v) => [v.key, v]));
      return next.map((v) => {
        const old = byKey.get(v.key);
        if (!old) return v;
        return {
          ...v,
          sku: old.sku,
          barcode: old.barcode,
          weight: old.weight,
          listPrice: old.listPrice,
          costPrice: old.costPrice,
          isActive: old.isActive,
        };
      });
    });
  }

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouchedRef.current) setSlug(slugify(v));
    setErrors((e) => ({ ...e, name: "" }));
  }
  function onSlugChange(v: string) {
    slugTouchedRef.current = true;
    setSlug(v);
    setErrors((e) => ({ ...e, slug: "" }));
  }

  function addAxis(attributeId: number) {
    if (axisDrafts.find((d) => d.attributeId === attributeId)) return;
    const attr = attrIndex.get(attributeId);
    if (!attr) return;
    regenerate([...axisDrafts, { attributeId, values: [emptyValue(attr, units)] }]);
  }

  function removeAxis(attributeId: number) {
    regenerate(axisDrafts.filter((x) => x.attributeId !== attributeId));
  }

  function setAxisValues(attributeId: number, values: AxisValueDraft[]) {
    regenerate(
      axisDrafts.map((x) => (x.attributeId === attributeId ? { ...x, values } : x)),
    );
  }

  function addManualVariant() {
    setVariants((vs) => [
      ...vs,
      {
        key: `manual-${Math.random().toString(36).slice(2)}`,
        name: "",
        axes: [],
        sku: "",
        barcode: "",
        weight: "",
        listPrice: "",
        costPrice: "",
        isActive: true,
      },
    ]);
  }

  function updateVariant(key: string, patch: Partial<Variant>) {
    setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  }

  function deleteVariant(key: string) {
    setVariants((vs) => vs.filter((v) => v.key !== key));
  }

  function setAttribute(code: string, value: AttributeFormValue) {
    setAttributeForm((m) => ({ ...m, [code]: value }));
  }

  function addPhotoUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPhotos((ps) => [
      ...ps,
      {
        url: trimmed,
        altText: null,
        isPrimary: ps.length === 0,
        sortOrder: ps.length,
      },
    ]);
  }

  function removePhoto(idx: number) {
    setPhotos((ps) => {
      const next = ps.filter((_, i) => i !== idx).map((p, i) => ({ ...p, sortOrder: i }));
      // If we removed the primary, promote the new first photo so the
      // product always has exactly one primary when at least one photo
      // exists.
      if (next.length > 0 && !next.some((p) => p.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  function setPrimaryPhoto(idx: number) {
    setPhotos((ps) => ps.map((p, i) => ({ ...p, isPrimary: i === idx })));
  }

  function reorderPhotos(from: number, to: number) {
    setPhotos((ps) => {
      if (from === to || from < 0 || to < 0 || from >= ps.length || to >= ps.length) return ps;
      const next = ps.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((p, i) => ({ ...p, sortOrder: i }));
    });
  }

  function setPhotoAltText(idx: number, altText: string) {
    setPhotos((ps) =>
      ps.map((p, i) => (i === idx ? { ...p, altText: altText || null } : p)),
    );
  }

  function onSubmit() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("errors.nameRequired");
    if (!slug.trim()) errs.slug = t("errors.slugRequired");
    if (productTypeId === null) errs.productType = t("errors.typeRequired");
    // Required descriptive attributes flagged via requirement_level=required
    // on the category_product_attribute mapping.
    for (const a of descriptiveAttributes) {
      if (!a.required) continue;
      const v = attributeForm[a.attribute_code];
      const empty =
        v === undefined ||
        v === null ||
        (typeof v === "string" && v.trim() === "");
      if (empty) errs[`attr:${a.attribute_code}`] = t("errors.required");
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error(t("errors.summary"));
      return;
    }

    const payload: CreateProductFullInput = {
      name: name.trim(),
      slug: slug.trim(),
      shortDescription: shortDesc.trim() || null,
      longDescription: longDesc.trim() || null,
      productTypeId: productTypeId!,
      brandId,
      categoryIds,
      isActive,
      trackInventory,
      isConsignment,
      variants: variants.map((v) => ({
        name: v.name.trim() || null,
        sku: v.sku.trim() || null,
        barcode: v.barcode.trim() || null,
        weightGrams: v.weight.trim() ? Number(v.weight) : null,
        listPrice: v.listPrice.trim() ? Number(v.listPrice) : null,
        costPrice: v.costPrice.trim() ? Number(v.costPrice) : null,
        isActive: v.isActive,
        axes: v.axes.map((a) => ({
          attributeId: a.attributeId,
          valueId: a.valueId,
          valueText: a.valueText,
          valueNumber: a.valueNumber,
          unitId: a.unitId,
        })),
      })),
      attributeValues: descriptiveAttributes.flatMap<CreateProductFullAttributeValue>((a) => {
        const v = attributeForm[a.attribute_code];
        if (v === undefined || v === null) return [];
        if (a.data_type === "list") {
          // list values come from the dropdown as the option's id
          // serialised to a string. Ignore the empty option.
          if (typeof v !== "string" || v === "") return [];
          const valueId = Number(v);
          if (!Number.isFinite(valueId)) return [];
          return [{ attributeId: a.attribute_id, valueId, valueText: null }];
        }
        if (a.data_type === "boolean") {
          return [{ attributeId: a.attribute_id, valueId: null, valueText: v ? "true" : "false" }];
        }
        // text (and any other free-form type — number, etc.) lands in
        // value_text. We don't try to parse: the schema expects text.
        if (typeof v !== "string" || v.trim() === "") return [];
        return [{ attributeId: a.attribute_id, valueId: null, valueText: v.trim() }];
      }),
      photos: photos.map((p) => ({
        url: p.url,
        altText: p.altText,
        isPrimary: p.isPrimary,
      })),
    };

    startTransition(async () => {
      const r = await createProductFull(payload);
      if ("error" in r) {
        toast.error(t("error"), { description: r.error });
        return;
      }
      toast.success(t("success"));
      router.push(`/catalog/products/${r.productId}`);
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-meta">{t("subhead")}</p>
        </div>
        <div className="s-title-actions">
          <button
            type="button"
            className="s-btn s-btn-secondary"
            onClick={() => router.push("/catalog/products")}
            disabled={pending}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={onSubmit}
            disabled={pending}
          >
            <Icon icon={Save} size={12} />
            {t("save")}
          </button>
        </div>
      </div>

      <div className="s-grid">
        <div className="s-col-stack">
          {/* ── Información básica ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.basic")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldRow>
                <FieldWrap label={tFields("brand")}>
                  <Combobox
                    placeholder={t("placeholders.brand")}
                    value={brandId}
                    onChange={setBrandId}
                    options={brands.map((b) => ({ id: b.brand_id, label: b.brand_name }))}
                  />
                </FieldWrap>
                <FieldWrap label={tFields("category")}>
                  <TreeMultiSelectCombobox
                    placeholder={t("placeholders.categories")}
                    value={categoryIds}
                    onChange={setCategoryIds}
                    nodes={categories.map((c) => ({
                      id: c.category_id,
                      label: c.category_name,
                      parentId: c.parent_category_id,
                    }))}
                    searchPlaceholder={tCommon("search")}
                    emptyText=""
                    removeTagAriaLabel={tCommon("removeTag")}
                  />
                </FieldWrap>
              </FieldRow>

              <FieldRow>
                <FieldWrap label={tFields("name")} required error={errors.name}>
                  <TextInput
                    value={name}
                    onChange={onNameChange}
                    placeholder={t("placeholders.name")}
                    invalid={!!errors.name}
                  />
                </FieldWrap>
                <FieldWrap label={tFields("slug")} required error={errors.slug}>
                  <TextInput
                    value={slug}
                    onChange={onSlugChange}
                    placeholder={t("placeholders.slug")}
                    monospace
                    invalid={!!errors.slug}
                  />
                </FieldWrap>
              </FieldRow>

              <FieldRow>
                <FieldWrap label={tFields("type")} required error={errors.productType}>
                  <Combobox
                    placeholder={t("placeholders.type")}
                    value={productTypeId}
                    onChange={(v) => {
                      setProductTypeId(v);
                      setErrors((e) => ({ ...e, productType: "" }));
                    }}
                    options={productTypes.map((p) => ({ id: p.product_type_id, label: p.type_name }))}
                    invalid={!!errors.productType}
                  />
                </FieldWrap>
                <FieldWrap label={tFields("active")}>
                  <ToggleField checked={isActive} onChange={setIsActive} />
                </FieldWrap>
              </FieldRow>

              <FieldRow>
                <FieldWrap label={tFields("trackInventory")}>
                  <ToggleField checked={trackInventory} onChange={setTrackInventory} />
                </FieldWrap>
                <FieldWrap label={tFields("consignment")}>
                  <ToggleField checked={isConsignment} onChange={setIsConsignment} />
                </FieldWrap>
              </FieldRow>
            </div>
          </div>

          {/* ── Descripciones ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.descriptions")}</p>
            <Collapsible
              label={tFields("shortDescription")}
              value={shortDesc}
              expanded={shortDescExpanded}
              onToggle={() => setShortDescExpanded((x) => !x)}
              onChange={setShortDesc}
              rows={3}
            />
            <Collapsible
              label={tFields("longDescription")}
              value={longDesc}
              expanded={longDescExpanded}
              onToggle={() => setLongDescExpanded((x) => !x)}
              onChange={setLongDesc}
              rows={5}
            />
          </div>

          {/* ── Variantes ── */}
          <div className="s-card">
            <div style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{t("sections.variants")}</h2>
              <p style={{ fontSize: 12, color: "var(--gl-text-secondary)", margin: "2px 0 0" }}>
                {t("variantsHelp")}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                className={`s-btn ${variantMode === "axis" ? "s-btn-primary" : "s-btn-secondary"}`}
                onClick={() => {
                  setVariantMode("axis");
                  // Repopulate from drafts — manual rows are dropped on
                  // the way back since the cartesian product is the
                  // source of truth in axis mode.
                  setVariants(generateAxisVariants(axisDrafts, attrIndex, units));
                }}
              >
                {t("modeAxis")}
              </button>
              <button
                type="button"
                className={`s-btn ${variantMode === "manual" ? "s-btn-primary" : "s-btn-secondary"}`}
                onClick={() => {
                  setVariantMode("manual");
                  // Switching to manual blanks the auto-generated rows.
                  // Anything the user keyed in axis mode stays in
                  // axisDrafts and reappears on switch back.
                  setVariants([]);
                }}
              >
                {t("modeManual")}
              </button>
            </div>

            {variantMode === "axis" ? (
              <AxisGenerator
                axisAttributes={axisAttributes}
                units={units}
                axisDrafts={axisDrafts}
                onAdd={addAxis}
                onRemove={removeAxis}
                onValuesChange={setAxisValues}
                variantsPreview={variants}
              />
            ) : (
              <div>
                {variants.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--gl-text-tertiary)", textAlign: "center", padding: "20px 0" }}>
                    {t("manualEmpty")}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="s-btn s-btn-secondary"
                  onClick={addManualVariant}
                  style={{ marginTop: 8 }}
                >
                  <Icon icon={Plus} size={12} />
                  {t("addVariant")}
                </button>
              </div>
            )}
          </div>

          {/* ── Tabla de variantes ── */}
          {variants.length > 0 ? (
            <div className="s-card" style={{ padding: 0, overflow: "hidden" }}>
              <VariantsEditTable
                variants={variants}
                onUpdate={updateVariant}
                onDelete={deleteVariant}
              />
            </div>
          ) : null}

          {/* ── Atributos del producto (Phase 2) ── */}
          {descriptiveAttributes.length > 0 ? (
            <div className="s-card">
              <p className="s-card-label">{t("sections.attributes")}</p>
              <p style={{ fontSize: 12, color: "var(--gl-text-secondary)", margin: "0 0 14px" }}>
                {t("attributes.subhead")}
              </p>
              <ProductAttributesGrid
                attributes={descriptiveAttributes}
                values={attributeForm}
                onChange={setAttribute}
                errors={errors}
              />
            </div>
          ) : null}

          {/* ── Fotos del producto (Phase 2) ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.photos")}</p>
            <p style={{ fontSize: 12, color: "var(--gl-text-secondary)", margin: "0 0 14px" }}>
              {t("photos.subhead")}
            </p>
            <PhotoManager
              photos={photos}
              onAdd={addPhotoUrl}
              onRemove={removePhoto}
              onSetPrimary={setPrimaryPhoto}
              onReorder={reorderPhotos}
              onAltTextChange={setPhotoAltText}
            />
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="s-col-stack">
          <div className="s-card">
            <p className="s-card-label">{t("sidebar.guideTitle")}</p>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--gl-text-secondary)" }}>
              <p style={{ margin: "0 0 10px" }}>{t("sidebar.guide1")}</p>
              <p style={{ margin: "0 0 10px" }}>{t("sidebar.guide2")}</p>
              <p style={{ margin: 0 }}>{t("sidebar.guide3")}</p>
            </div>
          </div>

          {variants.length > 0 ? (
            <div
              style={{
                background: "var(--gl-accent-50)",
                borderRadius: "var(--gl-radius-lg)",
                padding: "16px 18px",
              }}
            >
              <div
                style={{
                  color: "var(--gl-accent-800)",
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 12,
                }}
              >
                {t("sidebar.summaryTitle")}
              </div>
              <SummaryRow label={t("sidebar.summaryVariants")} value={`${variants.length}`} />
              <SummaryRow
                label={t("sidebar.summaryActive")}
                value={`${variants.filter((v) => v.isActive).length}`}
              />
              <SummaryRow
                label={t("sidebar.summaryWithSku")}
                value={`${variants.filter((v) => v.sku).length}`}
              />
              <SummaryRow
                label={t("sidebar.summaryWithPrice")}
                value={`${variants.filter((v) => v.listPrice).length}`}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Save indicator hidden visually pre-save; tDetail kept imported
          to share the i18n namespace with ProductEditor for consistency. */}
      <span style={{ display: "none" }}>{tDetail("saveError")}</span>
    </>
  );
}

// ─── Subcomponents: layout helpers ──────────────────────────────────────────

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="s-row-pair" style={{ gap: 16 }}>{children}</div>;
}

function FieldWrap({
  label,
  required = false,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative" }}>
      <label
        style={{
          position: "absolute",
          top: -7,
          left: 10,
          zIndex: 10,
          background: "white",
          padding: "0 6px",
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--gl-text-tertiary)",
          lineHeight: 1,
        }}
      >
        {label}
        {required ? (
          <span style={{ color: "var(--gl-danger)", marginLeft: 2 }}>*</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p style={{ fontSize: 11, color: "var(--gl-danger-text)", marginTop: 4 }}>{error}</p>
      ) : null}
    </div>
  );
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

function TextInput({
  value,
  onChange,
  placeholder,
  monospace = false,
  invalid = false,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monospace?: boolean;
  invalid?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        height: 40,
        padding: "10px 12px",
        fontSize: monospace ? 12 : 15,
        fontWeight: 500,
        fontFamily: monospace ? "var(--gl-font-mono)" : "inherit",
        border: `0.5px solid ${invalid ? "var(--gl-danger)" : "var(--gl-border)"}`,
        borderRadius: "var(--gl-radius-md)",
        background: "white",
        color: "var(--gl-text)",
        outline: "none",
      }}
    />
  );
}

function ToggleField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: 999,
        border: `0.5px solid ${checked ? "var(--gl-accent)" : "var(--gl-border)"}`,
        background: checked ? "var(--gl-accent)" : "var(--gl-surface-hover)",
        cursor: "pointer",
        padding: 0,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "white",
          boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
          transform: checked ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.15s",
        }}
      />
    </button>
  );
}


// ─── Collapsible textarea ───────────────────────────────────────────────────

function Collapsible({
  label,
  value,
  expanded,
  onToggle,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  rows: number;
}) {
  const firstLine = value.split("\n")[0] ?? "";
  return (
    <div
      style={{
        border: "0.5px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-md)",
        background: "white",
        marginBottom: 14,
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: "10px 12px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--gl-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 2,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--gl-text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {firstLine}
          </div>
        </div>
        <span
          style={{
            transition: "transform 0.2s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            color: "var(--gl-text-tertiary)",
          }}
        >
          <Icon icon={ChevronDown} size={14} />
        </span>
      </div>
      {expanded ? (
        <div style={{ padding: "0 12px 12px" }}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            style={{
              width: "100%",
              minHeight: 90,
              padding: 12,
              fontSize: 13,
              border: "0.5px solid var(--gl-border)",
              borderRadius: "var(--gl-radius-md)",
              background: "white",
              color: "var(--gl-text)",
              outline: "none",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Axis generator ─────────────────────────────────────────────────────────

function emptyValue(attr: AxisAttribute, units: UnitOption[]): AxisValueDraft {
  const k = Math.random().toString(36).slice(2);
  if (attr.data_type === "list") {
    return { kind: "list", key: k, valueId: null };
  }
  if (attr.data_type === "quantity") {
    // Pre-pick the first matching-dimension unit when one exists; saves
    // a click for the common case (mass for "weight", volume for
    // "content", etc.). Falls back to the first active unit otherwise.
    const dim = attr.dimension;
    const match = dim ? units.find((u) => u.dimension === dim) : null;
    return { kind: "quantity", key: k, number: "", unitId: match?.unit_id ?? units[0]?.unit_id ?? null };
  }
  return { kind: "text", key: k, text: "" };
}

function AxisGenerator({
  axisAttributes,
  units,
  axisDrafts,
  onAdd,
  onRemove,
  onValuesChange,
  variantsPreview,
}: {
  axisAttributes: AxisAttribute[];
  units: UnitOption[];
  axisDrafts: AxisDraft[];
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onValuesChange: (id: number, values: AxisValueDraft[]) => void;
  variantsPreview: Variant[];
}) {
  const t = useTranslations("product.create");
  const selectedIds = new Set(axisDrafts.map((d) => d.attributeId));
  const available = axisAttributes.filter((a) => !selectedIds.has(a.attribute_id));

  return (
    <div
      style={{
        padding: 14,
        background: "var(--gl-surface-alt)",
        borderRadius: "var(--gl-radius-md)",
      }}
    >
      <div style={{ marginBottom: axisDrafts.length > 0 ? 16 : 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "var(--gl-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          {t("axes.available")}
        </div>
        {available.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--gl-text-tertiary)", margin: 0 }}>
            {axisAttributes.length === 0 ? t("axes.none") : t("axes.allAdded")}
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {available.map((a) => (
              <button
                key={a.attribute_id}
                type="button"
                onClick={() => onAdd(a.attribute_id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "6px 12px",
                  fontSize: 12,
                  border: "0.5px solid var(--gl-border)",
                  borderRadius: "var(--gl-radius-md)",
                  background: "white",
                  color: "var(--gl-text)",
                  cursor: "pointer",
                }}
              >
                <Icon icon={Plus} size={12} />
                {a.attribute_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {axisDrafts.map((draft, idx) => {
        const attr = axisAttributes.find((a) => a.attribute_id === draft.attributeId);
        if (!attr) return null;
        return (
          <AxisRow
            key={draft.attributeId}
            attr={attr}
            units={units}
            values={draft.values}
            onChange={(vs) => onValuesChange(draft.attributeId, vs)}
            onRemove={() => onRemove(draft.attributeId)}
            isLast={idx === axisDrafts.length - 1}
          />
        );
      })}

      {variantsPreview.length > 0 ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "white",
            border: "0.5px solid var(--gl-border)",
            borderRadius: "var(--gl-radius-md)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--gl-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            {t("axes.preview", { count: variantsPreview.length })}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {variantsPreview.slice(0, 10).map((v) => (
              <span
                key={v.key}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  background: "var(--gl-accent-50)",
                  color: "var(--gl-accent-800)",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {v.name}
              </span>
            ))}
            {variantsPreview.length > 10 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  background: "var(--gl-surface-alt)",
                  color: "var(--gl-text-secondary)",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                +{variantsPreview.length - 10} {t("axes.more")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AxisRow({
  attr,
  units,
  values,
  onChange,
  onRemove,
  isLast,
}: {
  attr: AxisAttribute;
  units: UnitOption[];
  values: AxisValueDraft[];
  onChange: (vs: AxisValueDraft[]) => void;
  onRemove: () => void;
  isLast: boolean;
}) {
  const t = useTranslations("product.create");
  const dimUnits = attr.dimension
    ? units.filter((u) => u.dimension === attr.dimension)
    : units;

  function updateAt(idx: number, patch: Partial<AxisValueDraft>) {
    onChange(
      values.map((v, i) => (i === idx ? ({ ...v, ...patch } as AxisValueDraft) : v)),
    );
  }

  function removeAt(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  function addOne() {
    onChange([...values, emptyValue(attr, units)]);
  }

  return (
    <div
      style={{
        marginBottom: isLast ? 0 : 16,
        paddingBottom: isLast ? 0 : 16,
        borderBottom: isLast ? "none" : "0.5px solid var(--gl-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{attr.attribute_name}</span>
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: "var(--gl-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {attr.data_type}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("axes.remove")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            color: "var(--gl-text-tertiary)",
            borderRadius: "var(--gl-radius-sm)",
            cursor: "pointer",
          }}
        >
          <Icon icon={Trash2} size={14} />
        </button>
      </div>

      {values.map((v, idx) => {
        const removeBtn = (
          <button
            type="button"
            onClick={() => removeAt(idx)}
            aria-label={t("axes.removeValue")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              flexShrink: 0,
              border: "none",
              background: "transparent",
              color: "var(--gl-text-tertiary)",
              borderRadius: "var(--gl-radius-sm)",
              cursor: "pointer",
            }}
          >
            <Icon icon={Minus} size={14} />
          </button>
        );

        if (v.kind === "list") {
          return (
            <div key={v.key} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
              <select
                value={v.valueId ?? ""}
                onChange={(e) =>
                  updateAt(idx, { valueId: e.target.value ? Number(e.target.value) : null })
                }
                style={{
                  flex: 1,
                  height: 36,
                  padding: "0 10px",
                  fontSize: 13,
                  border: "0.5px solid var(--gl-border)",
                  borderRadius: "var(--gl-radius-md)",
                  background: "white",
                  outline: "none",
                }}
              >
                <option value="">—</option>
                {attr.options.map((o) => (
                  <option key={o.value_id} value={o.value_id}>
                    {o.value}
                  </option>
                ))}
              </select>
              {removeBtn}
            </div>
          );
        }

        if (v.kind === "quantity") {
          return (
            <div key={v.key} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
              <input
                type="number"
                inputMode="decimal"
                value={v.number}
                onChange={(e) => updateAt(idx, { number: e.target.value })}
                style={{
                  width: 120,
                  height: 36,
                  padding: "0 10px",
                  fontSize: 13,
                  border: "0.5px solid var(--gl-border)",
                  borderRadius: "var(--gl-radius-md)",
                  background: "white",
                  outline: "none",
                }}
              />
              <select
                value={v.unitId ?? ""}
                onChange={(e) =>
                  updateAt(idx, { unitId: e.target.value ? Number(e.target.value) : null })
                }
                style={{
                  flex: 1,
                  height: 36,
                  padding: "0 10px",
                  fontSize: 13,
                  border: "0.5px solid var(--gl-border)",
                  borderRadius: "var(--gl-radius-md)",
                  background: "white",
                  outline: "none",
                }}
              >
                <option value="">—</option>
                {dimUnits.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
              {removeBtn}
            </div>
          );
        }

        return (
          <div key={v.key} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
            <input
              type="text"
              value={v.text}
              onChange={(e) => updateAt(idx, { text: e.target.value })}
              style={{
                flex: 1,
                height: 36,
                padding: "0 10px",
                fontSize: 13,
                border: "0.5px solid var(--gl-border)",
                borderRadius: "var(--gl-radius-md)",
                background: "white",
                outline: "none",
              }}
            />
            {removeBtn}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addOne}
        style={{
          marginTop: 6,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          fontSize: 12,
          border: "0.5px solid var(--gl-border)",
          borderRadius: "var(--gl-radius-md)",
          background: "white",
          color: "var(--gl-text)",
          cursor: "pointer",
        }}
      >
        <Icon icon={Plus} size={12} />
        {attr.data_type === "quantity" ? t("axes.addQuantity") : t("axes.addValue")}
      </button>
    </div>
  );
}

// ─── Variants edit table ────────────────────────────────────────────────────

function VariantsEditTable({
  variants,
  onUpdate,
  onDelete,
}: {
  variants: Variant[];
  onUpdate: (key: string, patch: Partial<Variant>) => void;
  onDelete: (key: string) => void;
}) {
  const t = useTranslations("product.create");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <Th>{t("table.variant")}</Th>
          <Th>{t("table.sku")}</Th>
          <Th>{t("table.barcode")}</Th>
          <Th>{t("table.weight")}</Th>
          <Th align="right">{t("table.price")}</Th>
          <Th align="right">{t("table.cost")}</Th>
          <Th>{t("table.active")}</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {variants.map((v, idx) => (
          <tr
            key={v.key}
            style={{
              borderBottom:
                idx < variants.length - 1 ? "0.5px solid var(--gl-border)" : "none",
            }}
          >
            <Td>
              <input
                type="text"
                value={v.name}
                onChange={(e) => onUpdate(v.key, { name: e.target.value })}
                placeholder={t("table.variantPlaceholder")}
                style={cellInputStyle()}
              />
            </Td>
            <Td>
              <input
                type="text"
                value={v.sku}
                onChange={(e) => onUpdate(v.key, { sku: e.target.value })}
                style={cellInputStyle("mono")}
              />
            </Td>
            <Td>
              <input
                type="text"
                value={v.barcode}
                onChange={(e) => onUpdate(v.key, { barcode: e.target.value })}
                style={cellInputStyle("mono")}
              />
            </Td>
            <Td>
              <input
                type="number"
                inputMode="decimal"
                value={v.weight}
                onChange={(e) => onUpdate(v.key, { weight: e.target.value })}
                style={cellInputStyle("number")}
              />
            </Td>
            <Td align="right">
              <input
                type="number"
                inputMode="decimal"
                value={v.listPrice}
                onChange={(e) => onUpdate(v.key, { listPrice: e.target.value })}
                style={cellInputStyle("number")}
              />
            </Td>
            <Td align="right">
              <input
                type="number"
                inputMode="decimal"
                value={v.costPrice}
                onChange={(e) => onUpdate(v.key, { costPrice: e.target.value })}
                style={cellInputStyle("number")}
              />
            </Td>
            <Td>
              <ToggleField
                checked={v.isActive}
                onChange={(b) => onUpdate(v.key, { isActive: b })}
              />
            </Td>
            <Td>
              <button
                type="button"
                onClick={() => onDelete(v.key)}
                aria-label={t("table.delete")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  border: "none",
                  background: "transparent",
                  color: "var(--gl-text-tertiary)",
                  borderRadius: "var(--gl-radius-sm)",
                  cursor: "pointer",
                }}
              >
                <Icon icon={Trash2} size={14} />
              </button>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align,
        fontWeight: 500,
        color: "var(--gl-text-tertiary)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        padding: 12,
        borderBottom: "0.5px solid var(--gl-border)",
        background: "white",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td style={{ padding: 8, textAlign: align, verticalAlign: "middle" }}>{children}</td>
  );
}

function cellInputStyle(variant?: "mono" | "number"): React.CSSProperties {
  return {
    width: "100%",
    height: 32,
    padding: "0 8px",
    fontSize: 13,
    fontFamily: variant === "mono" ? "var(--gl-font-mono)" : "inherit",
    fontVariantNumeric: variant === "number" ? "tabular-nums" : undefined,
    textAlign: variant === "number" ? "right" : "left",
    border: "0.5px solid var(--gl-border)",
    borderRadius: "var(--gl-radius-sm)",
    background: "white",
    color: "var(--gl-text)",
    outline: "none",
  };
}

// ─── Descriptive attributes grid (Phase 2) ─────────────────────────────────

function ProductAttributesGrid({
  attributes,
  values,
  onChange,
  errors,
}: {
  attributes: DescriptiveAttribute[];
  values: AttributeForm;
  onChange: (code: string, value: AttributeFormValue) => void;
  errors: Record<string, string>;
}) {
  const t = useTranslations("product.create");
  return (
    <div>
      {attributes.map((a, idx) => {
        const errorKey = `attr:${a.attribute_code}`;
        const err = errors[errorKey];
        return (
          <div
            key={a.attribute_id}
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: 12,
              alignItems: "start",
              padding: "10px 0",
              borderBottom:
                idx < attributes.length - 1 ? "0.5px solid var(--gl-border)" : "none",
            }}
          >
            <label
              htmlFor={`attr-${a.attribute_code}`}
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--gl-text-secondary)",
                paddingTop: 10,
              }}
            >
              {a.attribute_name}
              {a.required ? (
                <span style={{ color: "var(--gl-danger)", marginLeft: 4 }}>*</span>
              ) : null}
            </label>
            <div>
              <AttributeControl
                attribute={a}
                value={values[a.attribute_code]}
                onChange={(v) => onChange(a.attribute_code, v)}
                placeholder={t("attributes.placeholder", { name: a.attribute_name.toLowerCase() })}
                invalid={!!err}
              />
              {err ? (
                <p style={{ fontSize: 11, color: "var(--gl-danger-text)", marginTop: 4 }}>{err}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AttributeControl({
  attribute,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  attribute: DescriptiveAttribute;
  value: AttributeFormValue | undefined;
  onChange: (v: AttributeFormValue) => void;
  placeholder: string;
  invalid: boolean;
}) {
  const t = useTranslations("product.create");

  if (attribute.data_type === "list") {
    const v = typeof value === "string" ? value : "";
    return (
      <select
        id={`attr-${attribute.attribute_code}`}
        value={v}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 36,
          padding: "0 10px",
          fontSize: 13,
          border: `0.5px solid ${invalid ? "var(--gl-danger)" : "var(--gl-border)"}`,
          borderRadius: "var(--gl-radius-md)",
          background: "white",
          color: "var(--gl-text)",
          outline: "none",
        }}
      >
        <option value="">{t("attributes.selectPlaceholder")}</option>
        {attribute.options.map((o) => (
          <option key={o.value_id} value={o.value_id}>
            {o.value}
          </option>
        ))}
      </select>
    );
  }

  if (attribute.data_type === "boolean") {
    const v = value === true;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8 }}>
        <ToggleField checked={v} onChange={(b) => onChange(b)} />
        <span style={{ fontSize: 13, color: "var(--gl-text-secondary)" }}>
          {v ? t("attributes.yes") : t("attributes.no")}
        </span>
      </div>
    );
  }

  // text (and any other type that hasn't grown its own control yet —
  // number, etc.) — free-form input lands in value_text.
  const v = typeof value === "string" ? value : "";
  return (
    <input
      id={`attr-${attribute.attribute_code}`}
      type="text"
      value={v}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        height: 36,
        padding: "0 10px",
        fontSize: 13,
        border: `0.5px solid ${invalid ? "var(--gl-danger)" : "var(--gl-border)"}`,
        borderRadius: "var(--gl-radius-md)",
        background: "white",
        color: "var(--gl-text)",
        outline: "none",
      }}
    />
  );
}

// ─── Sidebar helpers ────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "5px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--gl-accent-800)", opacity: 0.85 }}>{label}</span>
      <span
        style={{
          color: "var(--gl-accent-800)",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
