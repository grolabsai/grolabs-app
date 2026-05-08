"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { AttributeOption, Category } from "@/components/import/ImportWizard";
import { ProductThumbnail } from "@/components/import/ProductThumbnail";
import { useWizard } from "@/components/import/WizardContext";
import { groupImportProducts } from "@/lib/actions/import";
import { makeAgentMessage } from "@/lib/import/agent-message";
import type {
  ProposedAttributeCell,
  ProposedAxisCell,
  ProposedProductBaseRow,
  ProposedVariantRow,
} from "@/lib/import/types";

export function Step3Grouping({
  categories,
  attributeOptions,
}: {
  categories: Category[];
  attributeOptions: AttributeOption[];
}) {
  const t = useTranslations("import.wizard.step3");
  const { state, dispatch } = useWizard();
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

  function runGrouping() {
    if (selectedCategoryIds.length === 0) {
      toast.error(t("noCategoriesPicked"));
      return;
    }

    dispatch({ type: "SET_GROUPING", on: true });
    dispatch({
      type: "APPEND_AGENT_MESSAGE",
      message: makeAgentMessage({
        kind: "thinking",
        title: t("agentTitleGrouping"),
        body: t("agentBodyGrouping", { categories: selectedCategoryIds.length }),
      }),
    });
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
          dispatch({
            type: "APPEND_AGENT_MESSAGE",
            message: makeAgentMessage({
              kind: "error",
              title: t("agentTitleGroupError", { category: cat?.category_name ?? `#${categoryId}` }),
              body: r.error,
              raw: r.error,
            }),
          });
          continue;
        }
        dispatch({
          type: "APPEND_AGENT_MESSAGE",
          message: makeAgentMessage({
            kind: r.data.bases.length > 0 ? "success" : "warning",
            title: t("agentTitleGroupedFor", { category: cat?.category_name ?? `#${categoryId}` }),
            body: t("agentBodyGroupedFor", {
              bases: r.data.bases.length,
              variants: r.data.bases.reduce((n, b) => n + b.variants.length, 0),
            }),
            raw: r.data,
          }),
        });

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

  // Compute the union of axis codes per category, so the table headers match
  // the category being viewed. Each category may have different axes.
  const visibleBases = activeCategoryId === "all"
    ? state.productBases
    : state.productBases.filter((b) => b.categoryId === activeCategoryId);

  const axisCodes = useMemo(() => {
    const set = new Set<string>();
    for (const b of visibleBases) {
      for (const v of b.variants) {
        for (const a of v.axes) set.add(a.attributeCode);
      }
    }
    return Array.from(set);
  }, [visibleBases]);

  const attributeCodes = useMemo(() => {
    const set = new Set<string>();
    for (const b of visibleBases) {
      for (const v of b.variants) {
        for (const a of v.attributes) set.add(a.attributeCode);
      }
    }
    return Array.from(set);
  }, [visibleBases]);

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
                    {axisCodes.map((code) => (
                      <th key={`ax-${code}`} style={{ background: "var(--scout-accent-50)", color: "var(--scout-accent-800)" }}>
                        {code}
                      </th>
                    ))}
                    {attributeCodes.map((code) => (
                      <th key={`at-${code}`}>{code}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleBases.flatMap((base) =>
                    base.variants.map((v, vi) => {
                      // Photo URL of the source row that produced this variant.
                      // First sourceRowIndex is the canonical pick — if multiple
                      // source rows collapsed into one variant they share a SKU
                      // anyway, so any photo is representative.
                      const photoUrl = photoByRowIndex.get(v.sourceRowIndices[0] ?? -1);
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
                            {v.sourceRowIndices.length > 0 ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 11,
                                  fontStyle: "italic",
                                  color: "var(--s-text-tertiary)",
                                  lineHeight: 1.3,
                                  fontFamily:
                                    "ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
                                }}
                                title={t("sourceNameTooltip")}
                              >
                                {v.sourceRowIndices
                                  .map((ri) => sourceNameByRowIndex.get(ri))
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </div>
                            ) : null}
                          </td>
                          {axisCodes.map((code) => {
                            const ax = v.axes.find((a) => a.attributeCode === code);
                            return (
                              <td key={`ax-${code}`} style={{ background: "var(--scout-accent-50)" }}>
                                {ax ? (
                                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--scout-accent-800)" }}>
                                    {renderAxisValue(ax, optionLabelById)}
                                  </div>
                                ) : (
                                  <span style={{ color: "var(--s-text-tertiary)" }}>—</span>
                                )}
                              </td>
                            );
                          })}
                          {attributeCodes.map((code) => {
                            const at = v.attributes.find((a) => a.attributeCode === code);
                            return (
                              <td key={`at-${code}`}>
                                {at ? (
                                  <div style={{ fontSize: 12 }}>
                                    {renderAttributeValue(at, optionLabelById)}
                                  </div>
                                ) : (
                                  <span style={{ color: "var(--s-text-tertiary)" }}>—</span>
                                )}
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

function renderAxisValue(
  ax: ProposedAxisCell,
  optionLabelById: Map<number, string>,
): string {
  if (ax.dataType === "quantity") {
    return `${ax.valueNumber ?? "—"} ${ax.unitCode ?? ""}`.trim();
  }
  if (ax.dataType === "list" || ax.dataType === "multiselect") {
    return resolveOption(ax.valueId, ax.valueText, optionLabelById);
  }
  return ax.valueText ?? "—";
}

function renderAttributeValue(
  at: ProposedAttributeCell,
  optionLabelById: Map<number, string>,
): string {
  if (at.dataType === "list" || at.dataType === "multiselect") {
    return resolveOption(at.valueId, at.valueText, optionLabelById);
  }
  return at.valueText ?? "—";
}

function resolveOption(
  valueId: number | string | null,
  valueText: string | null,
  optionLabelById: Map<number, string>,
): string {
  if (valueText) return valueText;
  if (valueId === null || valueId === undefined) return "—";
  const numId = typeof valueId === "number" ? valueId : Number(valueId);
  const label = optionLabelById.get(numId);
  return label ?? `#${valueId}`;
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
