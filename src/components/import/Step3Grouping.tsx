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
  const [showUnaccounted, setShowUnaccounted] = useState(false);

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

  // Per-category bases + variants count, so the filter pills can show both
  // numbers ("18b/38v") instead of one ambiguous count.
  const totalsByCategory = useMemo(() => {
    const m = new Map<number, { bases: number; variants: number }>();
    for (const b of state.productBases) {
      if (b.categoryId === null) continue;
      const cur = m.get(b.categoryId) ?? { bases: 0, variants: 0 };
      cur.bases += 1;
      cur.variants += b.variants.length;
      m.set(b.categoryId, cur);
    }
    return m;
  }, [state.productBases]);

  const totalBases = state.productBases.length;
  const totalVariants = state.productBases.reduce((n, b) => n + b.variants.length, 0);
  const sourceRowCount = state.parsedFile?.rows.length ?? 0;

  // Source rows that didn't end up in any variant. Could be: empty product
  // name in the source, no category assigned in Step 2, or the agent
  // dropped them in Step 3 (lenient parsing). Surfaced so the math adds up
  // and the user can see exactly which rows are missing.
  const unaccountedRows = useMemo(() => {
    if (!state.parsedFile) return [];
    const accounted = new Set<number>();
    for (const b of state.productBases) {
      for (const v of b.variants) {
        for (const ri of v.sourceRowIndices) accounted.add(ri);
      }
    }
    const out: Array<{
      rowIndex: number;
      productName: string;
      reasonKey: "emptyName" | "noCategory" | "notExtracted";
    }> = [];
    const assignByRow = new Map(state.categoryAssignments.map((a) => [a.rowIndex, a]));
    for (let i = 0; i < sourceRowCount; i++) {
      if (accounted.has(i)) continue;
      const a = assignByRow.get(i);
      if (!a) {
        // No assignment row — the Step-2 product mapper filtered it out
        // (almost always: the source name was empty/whitespace).
        out.push({ rowIndex: i, productName: "", reasonKey: "emptyName" });
        continue;
      }
      out.push({
        rowIndex: i,
        productName: a.productName,
        reasonKey: a.categoryId === null ? "noCategory" : "notExtracted",
      });
    }
    return out;
  }, [state.parsedFile, state.productBases, state.categoryAssignments, sourceRowCount]);

  function runGrouping() {
    if (selectedCategoryIds.length === 0) {
      toast.error(t("noCategoriesPicked"));
      return;
    }

    // Wipe any previous run, then mark grouping in progress. APPEND adds
    // each category's bases as soon as its ASE call returns, so the user
    // sees results stream in instead of waiting for the whole batch.
    dispatch({ type: "SET_PRODUCT_BASES", bases: [] });
    dispatch({ type: "SET_GROUPING", on: true });
    logAgent(
      makeAgentMessage({
        kind: "thinking",
        title: t("agentTitleGrouping"),
        body: t("agentBodyGrouping", { categories: selectedCategoryIds.length }),
      }),
    );
    startTransition(async () => {
      let totalBasesAdded = 0;
      let totalVariantsAdded = 0;
      // One ASE call per category (the agent expects all products to be in
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

        const basesForCat: ProposedProductBaseRow[] = r.data.bases.map((base) => ({
          id: `base-${categoryId}-${base.base_name.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`,
          baseName: base.base_name,
          categoryId,
          categoryName: cat?.category_name ?? null,
          confidence: base.confidence,
          reasoning: base.reasoning,
          baseAttributes: (base.base_attribute_values ?? []).map(
            (av): ProposedAttributeCell => ({
              attributeId: av.attribute_id,
              attributeCode: av.attribute_code,
              attributeName: av.attribute_code,
              dataType:
                av.value_id !== null && av.value_id !== undefined ? "list" : "text",
              valueId: av.value_id ?? null,
              valueText: av.value_text ?? null,
              extractedFrom: av.extracted_from ?? null,
            }),
          ),
          variants: base.variants.map((v, vi): ProposedVariantRow => ({
            id: `v-${vi}-${Math.random().toString(36).slice(2, 6)}`,
            sourceRowIndices: v.source_refs.map((r) => parseInt(r.replace("row-", ""), 10)),
            axes: v.axis_values.map((av): ProposedAxisCell => ({
              attributeId: av.attribute_id,
              attributeCode: av.attribute_code,
              attributeName: av.attribute_code,
              // ASE returns attribute data_type implicitly via which value field is set
              dataType: av.unit_code ? "quantity" : av.value_id !== null && av.value_id !== undefined ? "list" : "text",
              valueId: av.value_id ?? null,
              valueText: av.value_text ?? null,
              valueNumber: av.value_number ?? null,
              unitId: av.unit_id ?? null,
              unitCode: av.unit_code ?? null,
              extractedFrom: av.extracted_from ?? null,
            })),
            attributes: v.attribute_values.map((av): ProposedAttributeCell => ({
              attributeId: av.attribute_id,
              attributeCode: av.attribute_code,
              attributeName: av.attribute_code,
              dataType: av.value_id !== null && av.value_id !== undefined ? "list" : "text",
              valueId: av.value_id ?? null,
              valueText: av.value_text ?? null,
              extractedFrom: av.extracted_from ?? null,
            })),
            label: v.label,
            sku: "",
            barcode: "",
            weightGrams: "",
            listPrice: "",
            costPrice: "",
            stockQty: "",
          })),
        }));

        // Stream this category's results into state so the user sees
        // progress immediately instead of waiting for the whole loop.
        dispatch({ type: "APPEND_PRODUCT_BASES", bases: basesForCat });
        totalBasesAdded += basesForCat.length;
        totalVariantsAdded += basesForCat.reduce((n, b) => n + b.variants.length, 0);
      }
      dispatch({ type: "SET_GROUPING", on: false });
      toast.success(
        t("groupingSuccess", { bases: totalBasesAdded, variants: totalVariantsAdded }),
      );
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

  // Empty-vocabulary warning: when the active category has no axes and no
  // descriptive attributes (own or inherited), the user has nothing to fill
  // in. Tell them where to define attributes for that category.
  const activeCategoryEmptyVocab = useMemo(() => {
    if (activeCategoryId === "all") return null;
    const v = vocabByCategory.get(activeCategoryId);
    if (!v) return null;
    if (v.axes.length > 0 || v.descriptive.length > 0) return null;
    const c = categoryById.get(activeCategoryId);
    return c?.category_name ?? `#${activeCategoryId}`;
  }, [activeCategoryId, vocabByCategory, categoryById]);

  return (
    <div>
      {!state.grouped && !state.grouping ? (
        <div className="s-card">
          <p className="s-card-label">{t("title")}</p>
          <p style={{ fontSize: 12, color: "var(--gl-text-secondary)", margin: "0 0 16px" }}>
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
          {/* Math summary — explicit triple so the user can verify nothing
              fell silently between Step 2 and Step 3. While grouping is
              still in flight, suppress the unaccounted count (everything
              looks "missing" until each category's bases stream in) and
              switch the strip to a neutral color. */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "var(--gl-radius-md)",
              background: state.grouping
                ? "var(--gl-accent-50)"
                : unaccountedRows.length > 0
                  ? "var(--gl-warning-bg)"
                  : "var(--gl-success-bg)",
              border: `0.5px solid ${
                state.grouping
                  ? "var(--gl-accent)"
                  : unaccountedRows.length > 0
                    ? "var(--gl-warning)"
                    : "var(--gl-success)"
              }`,
              color: state.grouping
                ? "var(--gl-accent-800)"
                : unaccountedRows.length > 0
                  ? "var(--gl-warning-text)"
                  : "var(--gl-success-text)",
              marginBottom: 16,
              fontSize: 13,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 16,
            }}
          >
            {state.grouping ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    border: "2px solid var(--gl-accent)",
                    borderTopColor: "transparent",
                    animation: "spin 0.8s linear infinite",
                  }}
                  aria-hidden
                />
                {t("groupingInProgress")}
              </span>
            ) : null}
            <span>
              <strong>{sourceRowCount}</strong> {t("statRows")}
            </span>
            <span style={{ color: "var(--gl-text-tertiary)" }}>·</span>
            <span>
              <strong>{totalBases}</strong> {t("statBases")}
            </span>
            <span style={{ color: "var(--gl-text-tertiary)" }}>·</span>
            <span>
              <strong>{totalVariants}</strong> {t("statVariants")}
            </span>
            {!state.grouping && unaccountedRows.length > 0 ? (
              <>
                <span style={{ color: "var(--gl-text-tertiary)" }}>·</span>
                <button
                  type="button"
                  onClick={() => setShowUnaccounted((s) => !s)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--gl-warning-text)",
                    fontWeight: 500,
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  {t("statUnaccounted", { n: unaccountedRows.length })}
                </button>
              </>
            ) : null}
          </div>

          {/* Unaccounted rows list — collapsible. Each row shows what we
              know about it + why the wizard skipped it. */}
          {showUnaccounted && !state.grouping && unaccountedRows.length > 0 ? (
            <div className="s-card" style={{ marginBottom: 16, padding: "12px 16px" }}>
              <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                {t("unaccountedTitle", { n: unaccountedRows.length })}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {unaccountedRows.map((u) => (
                  <div
                    key={u.rowIndex}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        color: "var(--gl-text-tertiary)",
                        minWidth: 60,
                      }}
                    >
                      row-{u.rowIndex}
                    </span>
                    <span style={{ flex: 1, fontStyle: u.productName ? "normal" : "italic", color: u.productName ? "var(--gl-text)" : "var(--gl-text-tertiary)" }}>
                      {u.productName || t("unaccountedEmptyName")}
                    </span>
                    <span style={{ color: "var(--gl-text-secondary)", fontSize: 11 }}>
                      {u.reasonKey === "emptyName"
                        ? t("unaccountedReasonEmptyName")
                        : u.reasonKey === "noCategory"
                          ? t("unaccountedReasonNoCategory")
                          : t("unaccountedReasonNotExtracted")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Empty-vocabulary warning when viewing a category with nothing
              defined. The fallback created singleton bases so rows still
              show up, but there are no columns to capture details. */}
          {activeCategoryEmptyVocab ? (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "var(--gl-radius-md)",
                background: "var(--gl-warning-bg)",
                border: "0.5px solid var(--gl-warning)",
                color: "var(--gl-warning-text)",
                marginBottom: 16,
                fontSize: 12,
              }}
            >
              {t("emptyVocabHint", { category: activeCategoryEmptyVocab })}
            </div>
          ) : null}

          {/* Category navigator — pills now show bases/variants, no ambiguity. */}
          {selectedCategoryIds.length > 1 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              <CatPill
                label={`${t("filterAll")} · ${totalBases}b/${totalVariants}v`}
                active={activeCategoryId === "all"}
                onClick={() => setActiveCategoryId("all")}
              />
              {selectedCategoryIds.map((cid) => {
                const c = categoryById.get(cid);
                const totals = totalsByCategory.get(cid) ?? { bases: 0, variants: 0 };
                return (
                  <CatPill
                    key={cid}
                    label={`${c?.category_name ?? cid} · ${totals.bases}b/${totals.variants}v`}
                    active={activeCategoryId === cid}
                    onClick={() => setActiveCategoryId(cid)}
                  />
                );
              })}
            </div>
          ) : null}

          {/* One block per base: base-attribute strip + variant table.
              Descriptive attributes are no longer table columns — they're
              base-level (shared by all variants), edited inline in the
              strip. Variant rows show only axis columns. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {visibleBases.map((base) => {
              const headPhoto = photoByRowIndex.get(
                base.variants[0]?.sourceRowIndices[0] ?? -1,
              );
              const baseDescriptiveAttrs =
                base.categoryId !== null
                  ? vocabByCategory.get(base.categoryId)?.descriptive ?? []
                  : [];
              return (
                <div key={base.id} className="s-card" style={{ padding: 0 }}>
                  {/* Base header: thumbnail + name + base-attribute editors inline */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 16,
                      padding: "14px 18px",
                      borderBottom: "0.5px solid var(--gl-border)",
                      background: "var(--gl-surface-alt)",
                    }}
                  >
                    <ProductThumbnail url={headPhoto} alt={base.baseName} />
                    <div style={{ minWidth: 200, maxWidth: 280, flexShrink: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{base.baseName}</div>
                      <div style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginTop: 2 }}>
                        {base.categoryName}
                      </div>
                      <div
                        style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginTop: 2 }}
                      >
                        {t("baseVariantCount", { n: base.variants.length })}
                      </div>
                    </div>
                    {baseDescriptiveAttrs.length > 0 ? (
                      <div
                        style={{
                          flex: 1,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {baseDescriptiveAttrs.map((attr) => {
                          const cell = base.baseAttributes.find(
                            (a) => Number(a.attributeId) === attr.attribute_id,
                          );
                          const accent = cell
                            ? colorForAttribute(attr.attribute_id)
                            : null;
                          return (
                            <div key={`base-attr-${attr.attribute_id}`}>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 500,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                  color: "var(--gl-text-tertiary)",
                                  marginBottom: 4,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <span
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: colorForAttribute(attr.attribute_id).fg,
                                  }}
                                />
                                {attr.attribute_name}
                              </div>
                              <AttributeCellEditor
                                attribute={attr}
                                cell={cell}
                                options={optionsByAttributeId.get(attr.attribute_id) ?? []}
                                accent={accent}
                                onUpsert={(c) =>
                                  dispatch({
                                    type: "UPSERT_BASE_ATTRIBUTE",
                                    baseId: base.id,
                                    cell: c,
                                  })
                                }
                                onRemove={() =>
                                  dispatch({
                                    type: "REMOVE_BASE_ATTRIBUTE",
                                    baseId: base.id,
                                    attributeId: attr.attribute_id,
                                  })
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Variant rows */}
                  <div style={{ overflow: "auto" }}>
                    <table className="s-table" style={{ minWidth: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ paddingLeft: 20 }}>{t("col.label")}</th>
                          {axisColumns.map((a) => (
                            <ColumnHeader
                              key={`ax-${a.attribute_id}`}
                              attribute={a}
                              variant="axis"
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {base.variants.map((v) => {
                          const variantPhoto = photoByRowIndex.get(
                            v.sourceRowIndices[0] ?? -1,
                          );
                          const sourceText = v.sourceRowIndices
                            .map((ri) => sourceNameByRowIndex.get(ri))
                            .filter((s): s is string => Boolean(s))
                            .join(" · ");
                          return (
                            <tr key={v.id}>
                              <td style={{ paddingLeft: 20 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                  }}
                                >
                                  <ProductThumbnail
                                    url={variantPhoto}
                                    alt={v.label || base.baseName}
                                  />
                                  <div style={{ flex: 1 }}>
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
                                        attributes={[
                                          ...base.baseAttributes,
                                          ...v.attributes,
                                        ]}
                                        optionLabelById={optionLabelById}
                                        tooltip={t("sourceNameTooltip")}
                                      />
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              {axisColumns.map((attr) => {
                                const cell = v.axes.find(
                                  (a) => Number(a.attributeId) === attr.attribute_id,
                                );
                                const accent = cell
                                  ? colorForAttribute(attr.attribute_id)
                                  : null;
                                return (
                                  <td
                                    key={`ax-${attr.attribute_id}`}
                                    style={{
                                      background: "var(--gl-accent-50)",
                                      padding: 4,
                                    }}
                                  >
                                    <AxisCellEditor
                                      attribute={attr}
                                      cell={cell}
                                      options={
                                        optionsByAttributeId.get(attr.attribute_id) ?? []
                                      }
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
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
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
          disabled={!state.grouped || state.grouping || state.productBases.length === 0}
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
    border: "0.5px solid var(--gl-border)",
    borderRadius: "var(--gl-radius-sm)",
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
          ? { background: "var(--gl-accent-50)", color: "var(--gl-accent-800)", whiteSpace: "nowrap" }
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
        border: "0.5px solid var(--gl-border)",
        background: active ? "var(--gl-accent)" : "white",
        color: active ? "white" : "var(--gl-text)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
