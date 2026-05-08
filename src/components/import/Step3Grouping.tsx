"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type {
  Attribute,
  AttributeOption,
  Category,
  CategoryAttributeLink,
  Unit,
} from "@/components/import/ImportWizard";
import { ProductThumbnail } from "@/components/import/ProductThumbnail";
import { SourceName } from "@/components/import/SourceName";
import {
  AttributeCellEditor,
  AxisCellEditor,
} from "@/components/import/VariantCellEditor";
import { useWizard } from "@/components/import/WizardContext";
import { useAgentLog } from "@/components/shell/AgentLogContext";
import { groupImportProducts } from "@/lib/actions/import";
import { makeAgentMessage } from "@/lib/import/agent-message";
import { colorForAttribute } from "@/lib/import/attribute-colors";
import type {
  ProposedAttributeCell,
  ProposedAxisCell,
  ProposedProductBaseRow,
  ProposedVariantRow,
} from "@/lib/import/types";
import {
  effectiveVocabularyFor,
  type EffectiveAttribute,
} from "@/lib/import/vocabulary";

export function Step3Grouping({
  categories,
  attributeOptions,
  attributes,
  categoryAttributes,
  units,
}: {
  categories: Category[];
  attributeOptions: AttributeOption[];
  attributes: Attribute[];
  categoryAttributes: CategoryAttributeLink[];
  units: Unit[];
}) {
  const t = useTranslations("import.wizard.step3");
  const { state, dispatch } = useWizard();
  const { append: logAgent } = useAgentLog();
  const [pending, startTransition] = useTransition();
  const [activeCategoryId, setActiveCategoryId] = useState<number | "all">("all");

  const categoryById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories) m.set(c.category_id, c);
    return m;
  }, [categories]);

  // value_id → option label, so list-typed axis/attribute cells can render
  // "Adulto" instead of "#94". Built once from the page-level fetch.
  const optionLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const o of attributeOptions) m.set(o.value_id, o.value);
    return m;
  }, [attributeOptions]);

  // Source-row → photo URL, so a variant can show the thumbnail of the
  // original CSV row that produced it (helpful for spotting bad groupings
  // when the same SKU was picked up twice with slightly different names).
  const photoByRowIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of state.categoryAssignments) {
      if (a.photoUrl) m.set(a.rowIndex, a.photoUrl);
    }
    return m;
  }, [state.categoryAssignments]);

  // Distinct selected categories from Step 2
  const selectedCategoryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const a of state.categoryAssignments) {
      if (a.categoryId !== null) ids.add(a.categoryId);
    }
    return Array.from(ids);
  }, [state.categoryAssignments]);

  // Source row → original product name from the uploaded file. Lets each
  // variant row display the raw text the agent worked from, so the user can
  // verify that "Hills Adult 7 kg" really did break down into a base of
  // "Hills Adult" with content=7 kg (vs e.g. 7 lb being mis-parsed).
  const sourceNameByRowIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of state.categoryAssignments) {
      m.set(a.rowIndex, a.productName);
    }
    return m;
  }, [state.categoryAssignments]);

  // attribute_id → its options, so list-typed cell editors can populate a
  // dropdown with only the options that actually belong to that attribute.
  const optionsByAttributeId = useMemo(() => {
    const m = new Map<number, AttributeOption[]>();
    for (const o of attributeOptions) {
      const arr = m.get(o.attribute_id) ?? [];
      arr.push(o);
      m.set(o.attribute_id, arr);
    }
    return m;
  }, [attributeOptions]);

  // category_id → effective vocabulary (axes + descriptive attrs after the
  // inheritance walk per CLAUDE.md §10). Drives column rendering — every
  // column shows up even if the agent didn't populate it for any variant,
  // so the user can fill in missed values manually.
  const vocabByCategory = useMemo(() => {
    const m = new Map<number, ReturnType<typeof effectiveVocabularyFor>>();
    for (const cid of selectedCategoryIds) {
      m.set(cid, effectiveVocabularyFor(cid, categories, categoryAttributes, attributes));
    }
    return m;
  }, [selectedCategoryIds, categories, categoryAttributes, attributes]);

  function runGrouping() {
    if (selectedCategoryIds.length === 0) {
      toast.error(t("noCategoriesPicked"));
      return;
    }

    dispatch({ type: "SET_GROUPING", on: true });
    logAgent(
      makeAgentMessage({
        kind: "thinking",
        title: t("agentTitleGrouping"),
        body: t("agentBodyGrouping", { categories: selectedCategoryIds.length }),
      }),
    );
    startTransition(async () => {
      const allBases: ProposedProductBaseRow[] = [];
      // One GLPIM call per category (the agent expects all products to be in
      // the same category for the vocabulary to match).
      for (const categoryId of selectedCategoryIds) {
        const rowsForCat = state.categoryAssignments.filter((a) => a.categoryId === categoryId);
        const products = rowsForCat
          .map((a) => ({ product_ref: `row-${a.rowIndex}`, name: a.productName }))
          .filter((p) => p.name);
        if (products.length === 0) continue;

        const cat = categoryById.get(categoryId);
        const r = await groupImportProducts({ products, categoryId });
        if ("error" in r) {
          toast.error(t("groupingError"), { description: r.error });
          logAgent(
            makeAgentMessage({
              kind: "error",
              title: t("agentTitleGroupError", { category: cat?.category_name ?? `#${categoryId}` }),
              body: r.error,
              raw: r.error,
            }),
          );
          continue;
        }
        logAgent(
          makeAgentMessage({
            kind: r.data.bases.length > 0 ? "success" : "warning",
            title: t("agentTitleGroupedFor", { category: cat?.category_name ?? `#${categoryId}` }),
            body: t("agentBodyGroupedFor", {
              bases: r.data.bases.length,
              variants: r.data.bases.reduce((n, b) => n + b.variants.length, 0),
            }),
            raw: r.data,
          }),
        );

        for (const base of r.data.bases) {
          const cat = categoryById.get(categoryId);
          allBases.push({
            id: `base-${categoryId}-${base.base_name.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`,
            baseName: base.base_name,
            categoryId,
            categoryName: cat?.category_name ?? null,
            confidence: base.confidence,
            reasoning: base.reasoning,
            variants: base.variants.map((v, vi): ProposedVariantRow => ({
              id: `v-${vi}-${Math.random().toString(36).slice(2, 6)}`,
              sourceRowIndices: v.source_refs.map((r) => parseInt(r.replace("row-", ""), 10)),
              axes: v.axis_values.map((av): ProposedAxisCell => {
                const attrName = av.attribute_code; // We don't have name here from GLPIM; could enrich later
                return {
                  attributeId: av.attribute_id,
                  attributeCode: av.attribute_code,
                  attributeName: attrName,
                  // GLPIM returns attribute data_type implicitly via which value field is set
                  dataType: av.unit_code ? "quantity" : av.value_id !== null && av.value_id !== undefined ? "list" : "text",
                  valueId: av.value_id ?? null,
                  valueText: av.value_text ?? null,
                  valueNumber: av.value_number ?? null,
                  unitId: av.unit_id ?? null,
                  unitCode: av.unit_code ?? null,
                };
              }),
              attributes: v.attribute_values.map((av): ProposedAttributeCell => ({
                attributeId: av.attribute_id,
                attributeCode: av.attribute_code,
                attributeName: av.attribute_code,
                dataType: av.value_id !== null && av.value_id !== undefined ? "list" : "text",
                valueId: av.value_id ?? null,
                valueText: av.value_text ?? null,
              })),
              label: v.label,
              sku: "",
              barcode: "",
              weightGrams: "",
              listPrice: "",
              costPrice: "",
              stockQty: "",
            })),
          });
        }
      }
      dispatch({ type: "SET_PRODUCT_BASES", bases: allBases });
      dispatch({ type: "SET_GROUPING", on: false });
      toast.success(t("groupingSuccess", { bases: allBases.length, variants: allBases.reduce((n, b) => n + b.variants.length, 0) }));
    });
  }

  const visibleBases = activeCategoryId === "all"
    ? state.productBases
    : state.productBases.filter((b) => b.categoryId === activeCategoryId);

  // Column set comes from the effective vocabulary of every visible
  // category, deduped by attribute_id, in axis-order then descriptive-
  // order. Columns appear regardless of agent population so the user can
  // fill in a value the agent missed.
  const axisColumns = useMemo<EffectiveAttribute[]>(() => {
    const seen = new Set<number>();
    const out: EffectiveAttribute[] = [];
    const cats = activeCategoryId === "all" ? selectedCategoryIds : [activeCategoryId];
    for (const cid of cats) {
      const v = vocabByCategory.get(cid);
      if (!v) continue;
      for (const a of v.axes) {
        if (seen.has(a.attribute_id)) continue;
        seen.add(a.attribute_id);
        out.push(a);
      }
    }
    return out;
  }, [activeCategoryId, selectedCategoryIds, vocabByCategory]);

  const attributeColumns = useMemo<EffectiveAttribute[]>(() => {
    const seen = new Set<number>();
    const out: EffectiveAttribute[] = [];
    const cats = activeCategoryId === "all" ? selectedCategoryIds : [activeCategoryId];
    for (const cid of cats) {
      const v = vocabByCategory.get(cid);
      if (!v) continue;
      for (const a of v.descriptive) {
        if (seen.has(a.attribute_id)) continue;
        seen.add(a.attribute_id);
        out.push(a);
      }
    }
    return out;
  }, [activeCategoryId, selectedCategoryIds, vocabByCategory]);

  const totalVariants = state.productBases.reduce((n, b) => n + b.variants.length, 0);

  return (
    <div>
      {!state.grouped ? (
        <div className="s-card">
          <p className="s-card-label">{t("title")}</p>
          <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 16px" }}>
            {t("subtitle")}
          </p>
          <button
            type="button"
            className="s-btn s-btn-primary"
            disabled={pending || state.grouping}
            onClick={runGrouping}
          >
            {state.grouping ? t("grouping") : t("groupButton")}
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "var(--s-radius-md)",
              background: "var(--s-success-bg)",
              border: "0.5px solid var(--s-success)",
              color: "var(--s-success-text)",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {t("successAlert", { bases: state.productBases.length, variants: totalVariants })}
          </div>

          {/* Category navigator */}
          {selectedCategoryIds.length > 1 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              <CatPill
                label={`${t("filterAll")} (${state.productBases.length})`}
                active={activeCategoryId === "all"}
                onClick={() => setActiveCategoryId("all")}
              />
              {selectedCategoryIds.map((cid) => {
                const c = categoryById.get(cid);
                const count = state.productBases.filter((b) => b.categoryId === cid).length;
                return (
                  <CatPill
                    key={cid}
                    label={`${c?.category_name ?? cid} (${count})`}
                    active={activeCategoryId === cid}
                    onClick={() => setActiveCategoryId(cid)}
                  />
                );
              })}
            </div>
          ) : null}

          {/* Flat editable table */}
          <div className="s-card" style={{ padding: 0 }}>
            <div style={{ overflow: "auto", maxHeight: 600 }}>
              <table className="s-table" style={{ minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20, position: "sticky", left: 0, background: "var(--s-surface-alt)" }}>{t("col.base")}</th>
                    <th>{t("col.label")}</th>
                    {axisColumns.map((a) => (
                      <ColumnHeader key={`ax-${a.attribute_id}`} attribute={a} variant="axis" />
                    ))}
                    {attributeColumns.map((a) => (
                      <ColumnHeader key={`at-${a.attribute_id}`} attribute={a} variant="attr" />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleBases.flatMap((base) =>
                    base.variants.map((v, vi) => {
                      const photoUrl = photoByRowIndex.get(v.sourceRowIndices[0] ?? -1);
                      const sourceText = v.sourceRowIndices
                        .map((ri) => sourceNameByRowIndex.get(ri))
                        .filter((s): s is string => Boolean(s))
                        .join(" · ");
                      return (
                        <tr key={v.id}>
                          <td style={{ paddingLeft: 20, position: "sticky", left: 0, background: "white" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <ProductThumbnail url={photoUrl} alt={base.baseName} />
                              {vi === 0 ? (
                                <div>
                                  <div style={{ fontWeight: 500 }}>{base.baseName}</div>
                                  <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                                    {base.categoryName}
                                  </div>
                                </div>
                              ) : (
                                <div style={{ color: "var(--s-text-tertiary)", fontSize: 11 }}>
                                  {base.variants.length > 1 ? "↳" : ""}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.label}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "label",
                                  value: e.target.value,
                                })
                              }
                              style={cellInput()}
                            />
                            {sourceText ? (
                              <SourceName
                                text={sourceText}
                                axes={v.axes}
                                attributes={v.attributes}
                                optionLabelById={optionLabelById}
                                tooltip={t("sourceNameTooltip")}
                              />
                            ) : null}
                          </td>
                          {axisColumns.map((attr) => {
                            const cell = v.axes.find((a) => Number(a.attributeId) === attr.attribute_id);
                            const accent = cell ? colorForAttribute(attr.attribute_id) : null;
                            return (
                              <td
                                key={`ax-${attr.attribute_id}`}
                                style={{ background: "var(--scout-accent-50)", padding: 4 }}
                              >
                                <AxisCellEditor
                                  attribute={attr}
                                  cell={cell}
                                  options={optionsByAttributeId.get(attr.attribute_id) ?? []}
                                  units={units}
                                  accent={accent}
                                  onUpsert={(c) =>
                                    dispatch({
                                      type: "UPSERT_VARIANT_AXIS",
                                      baseId: base.id,
                                      variantId: v.id,
                                      cell: c,
                                    })
                                  }
                                  onRemove={() =>
                                    dispatch({
                                      type: "REMOVE_VARIANT_AXIS",
                                      baseId: base.id,
                                      variantId: v.id,
                                      attributeId: attr.attribute_id,
                                    })
                                  }
                                />
                              </td>
                            );
                          })}
                          {attributeColumns.map((attr) => {
                            const cell = v.attributes.find(
                              (a) => Number(a.attributeId) === attr.attribute_id,
                            );
                            const accent = cell ? colorForAttribute(attr.attribute_id) : null;
                            return (
                              <td key={`at-${attr.attribute_id}`} style={{ padding: 4 }}>
                                <AttributeCellEditor
                                  attribute={attr}
                                  cell={cell}
                                  options={optionsByAttributeId.get(attr.attribute_id) ?? []}
                                  accent={accent}
                                  onUpsert={(c) =>
                                    dispatch({
                                      type: "UPSERT_VARIANT_ATTRIBUTE",
                                      baseId: base.id,
                                      variantId: v.id,
                                      cell: c,
                                    })
                                  }
                                  onRemove={() =>
                                    dispatch({
                                      type: "REMOVE_VARIANT_ATTRIBUTE",
                                      baseId: base.id,
                                      variantId: v.id,
                                      attributeId: attr.attribute_id,
                                    })
                                  }
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 8 }}>
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 2 })}
        >
          {t("back")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-primary"
          disabled={!state.grouped || state.productBases.length === 0}
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 4 })}
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}

function cellInput(): React.CSSProperties {
  return {
    width: "100%",
    height: 28,
    padding: "0 6px",
    fontSize: 12,
    border: "0.5px solid var(--s-border)",
    borderRadius: "var(--s-radius-sm)",
    background: "white",
    outline: "none",
  };
}

function ColumnHeader({
  attribute,
  variant,
}: {
  attribute: EffectiveAttribute;
  variant: "axis" | "attr";
}) {
  const color = colorForAttribute(attribute.attribute_id);
  return (
    <th
      style={
        variant === "axis"
          ? { background: "var(--scout-accent-50)", color: "var(--scout-accent-800)", whiteSpace: "nowrap" }
          : { whiteSpace: "nowrap" }
      }
      title={`${attribute.attribute_name} · ${attribute.data_type}`}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color.fg,
            flexShrink: 0,
          }}
          aria-hidden
        />
        {attribute.attribute_name}
      </span>
    </th>
  );
}

function CatPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        border: "0.5px solid var(--s-border)",
        background: active ? "var(--scout-accent)" : "white",
        color: active ? "white" : "var(--s-text)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
