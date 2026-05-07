"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ImageOff } from "lucide-react";
import { toast } from "sonner";

import type { Brand, Category } from "@/components/import/ImportWizard";
import { useWizard } from "@/components/import/WizardContext";
import { Combobox } from "@/components/ui/combobox";
import { Icon } from "@/components/ui/icon";
import { TreeMultiSelectCombobox } from "@/components/ui/tree-multiselect";
import { analyzeImportCategories } from "@/lib/actions/import";
import type { CategoryAssignment } from "@/lib/import/types";

export function Step2Categories({
  brands,
  categories,
}: {
  brands: Brand[];
  categories: Category[];
}) {
  const t = useTranslations("import.wizard.step2");
  const { state, dispatch } = useWizard();
  const [pending, startTransition] = useTransition();

  const file = state.parsedFile;

  const categoryById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories) m.set(c.category_id, c);
    return m;
  }, [categories]);

  const childrenByParent = useMemo(() => {
    const m = new Map<number | null, Category[]>();
    for (const c of categories) {
      const arr = m.get(c.parent_category_id) ?? [];
      arr.push(c);
      m.set(c.parent_category_id, arr);
    }
    return m;
  }, [categories]);

  // Final candidate set = union of every picked node and its descendants.
  // Picking a parent broadens the search; picking only leaves narrows it.
  const candidateCategories = useMemo(() => {
    if (state.candidateCategoryIds.length === 0) return [];
    const seen = new Set<number>();
    const out: Category[] = [];
    const queue: number[] = [...state.candidateCategoryIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const cat = categoryById.get(id);
      if (cat) out.push(cat);
      for (const k of childrenByParent.get(id) ?? []) queue.push(k.category_id);
    }
    return out;
  }, [state.candidateCategoryIds, childrenByParent, categoryById]);

  const agentSkippable = candidateCategories.length === 1;

  if (!file) return null;

  function setNameColumn(idx: number | null) {
    dispatch({ type: "SET_COLUMNS", cols: { productNameColumn: idx } });
  }

  function setPhotoColumn(idx: number | null) {
    dispatch({ type: "SET_COLUMNS", cols: { productPhotoColumn: idx } });
  }

  function setLlmExtraction(on: boolean) {
    dispatch({ type: "SET_COLUMNS", cols: { llmExtraction: on } });
  }

  function runAnalysis() {
    if (!file) return;
    if (candidateCategories.length === 0) {
      toast.error(t("candidatesRequired"));
      return;
    }
    if (state.columns.productNameColumn === null) {
      toast.error(t("nameColumnRequired"));
      return;
    }
    const products = file.rows.map((row, i) => ({
      product_ref: `row-${i}`,
      name: String(row[state.columns.productNameColumn!] ?? "").trim(),
      brand: undefined,
      photo_url:
        state.columns.productPhotoColumn !== null
          ? String(row[state.columns.productPhotoColumn] ?? "").trim() || undefined
          : undefined,
    })).filter((p) => p.name);

    if (products.length === 0) {
      toast.error(t("noNamesFound"));
      return;
    }

    // Only one category in the candidate set → skip the agent; assign all rows.
    if (agentSkippable) {
      const only = candidateCategories[0];
      const assignments: CategoryAssignment[] = products.map((p) => ({
        rowIndex: parseInt(p.product_ref.replace("row-", ""), 10),
        productName: p.name,
        brand: p.brand ?? undefined,
        photoUrl: p.photo_url ?? undefined,
        suggestedCategoryId: only.category_id,
        suggestedCategoryName: only.category_name,
        confidence: 1,
        confidenceTier: "high",
        reasoning: t("singleCandidateReasoning"),
        categoryId: only.category_id,
        categoryName: only.category_name,
        userSelected: false,
      }));
      dispatch({ type: "SET_CATEGORY_ASSIGNMENTS", assignments });
      toast.success(t("analysisSuccess", { n: assignments.length }));
      return;
    }

    const candidates = candidateCategories.map((c) => ({
      category_id: c.category_id,
      name: c.category_name,
      parent_id: c.parent_category_id,
    }));

    dispatch({ type: "SET_ANALYZING_CATEGORIES", on: true });
    startTransition(async () => {
      const r = await analyzeImportCategories({ products, candidates });
      dispatch({ type: "SET_ANALYZING_CATEGORIES", on: false });
      if ("error" in r) {
        toast.error(t("analysisError"), { description: r.error });
        return;
      }
      // Map response → CategoryAssignment[]
      // Note: GLPIM may skip products it doesn't have a match for; we backfill those as null suggestions.
      const byRef = new Map(r.data.suggestions.map((s) => [s.product_ref, s]));
      const assignments: CategoryAssignment[] = products.map((p) => {
        const s = byRef.get(p.product_ref);
        if (!s) {
          return {
            rowIndex: parseInt(p.product_ref.replace("row-", ""), 10),
            productName: p.name,
            brand: p.brand ?? undefined,
            photoUrl: p.photo_url ?? undefined,
            suggestedCategoryId: null,
            suggestedCategoryName: null,
            confidence: 0,
            confidenceTier: "low",
            reasoning: t("noSuggestion"),
            categoryId: null,
            categoryName: null,
            userSelected: false,
          };
        }
        const cid = typeof s.category_id === "number" ? s.category_id : Number(s.category_id);
        return {
          rowIndex: parseInt(s.product_ref.replace("row-", ""), 10),
          productName: s.product_name,
          brand: p.brand ?? undefined,
          photoUrl: p.photo_url ?? undefined,
          suggestedCategoryId: cid,
          suggestedCategoryName: s.category_name,
          confidence: s.confidence,
          confidenceTier: s.confidence_tier,
          reasoning: s.reasoning,
          categoryId: cid,
          categoryName: s.category_name,
          userSelected: false,
        };
      });
      dispatch({ type: "SET_CATEGORY_ASSIGNMENTS", assignments });
      toast.success(t("analysisSuccess", { n: assignments.length }));
    });
  }

  function setRowCategory(rowIndex: number, categoryId: number | null) {
    const cat = categoryId !== null ? categoryById.get(categoryId) : null;
    dispatch({
      type: "UPDATE_CATEGORY_ASSIGNMENT",
      rowIndex,
      categoryId,
      categoryName: cat?.category_name ?? null,
    });
  }

  const canContinue =
    state.categoriesAnalyzed &&
    state.categoryAssignments.some((c) => c.categoryId !== null);

  return (
    <div>
      {/* Brand */}
      <div className="s-card">
        <p className="s-card-label">{t("brandTitle")}</p>
        <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 12px" }}>
          {t("brandHint")}
        </p>
        <div style={{ maxWidth: 400 }}>
          <Combobox
            placeholder={t("brandPlaceholder")}
            value={state.brand.brandId}
            onChange={(id) => dispatch({ type: "SET_BRAND", brandId: id })}
            options={brands.map((b) => ({ id: b.brand_id, label: b.brand_name }))}
          />
        </div>
      </div>

      {/* Column mapping (name/photo) */}
      <div className="s-card">
        <p className="s-card-label">{t("columnsTitle")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ColumnPicker
            label={t("nameColumnLabel")}
            value={state.columns.productNameColumn}
            onChange={setNameColumn}
            columns={file.columns}
            previewRows={file.rows}
            required
          />
          <ColumnPicker
            label={t("photoColumnLabel")}
            value={state.columns.productPhotoColumn}
            onChange={setPhotoColumn}
            columns={file.columns}
            previewRows={file.rows}
          />
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            fontSize: 13,
            color: "var(--s-text-secondary)",
          }}
        >
          <input
            type="checkbox"
            checked={state.columns.llmExtraction}
            onChange={(e) => setLlmExtraction(e.target.checked)}
          />
          {t("llmExtractionLabel")}
        </label>
        <p style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 6, marginLeft: 22 }}>
          {t("llmExtractionHint")}
        </p>
      </div>

      {/* Candidate categories + analyze */}
      <div className="s-card">
        <p className="s-card-label">{t("analysisTitle")}</p>
        <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 12px" }}>
          {t("analysisHint")}
        </p>

        <div style={{ marginBottom: 14, maxWidth: 640 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--s-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            {t("candidatesLabel")}
            <span style={{ color: "var(--s-danger)", marginLeft: 4 }}>*</span>
          </div>
          <TreeMultiSelectCombobox
            placeholder={t("candidatesPlaceholder")}
            value={state.candidateCategoryIds}
            onChange={(ids) => dispatch({ type: "SET_CANDIDATE_CATEGORIES", ids })}
            nodes={categories.map((c) => ({
              id: c.category_id,
              label: c.category_name,
              parentId: c.parent_category_id,
            }))}
            searchPlaceholder={t("candidatesSearch")}
            emptyText={t("candidatesEmpty")}
            removeTagAriaLabel={t("candidatesRemoveTag")}
            sortByLabel={false}
          />
          {candidateCategories.length > 0 ? (
            <p
              style={{
                fontSize: 11,
                color: "var(--s-text-tertiary)",
                marginTop: 6,
              }}
            >
              {agentSkippable
                ? t("singleCandidateHint")
                : t("multiCandidateHint", { n: candidateCategories.length })}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className="s-btn s-btn-primary"
          disabled={
            pending ||
            state.analyzingCategories ||
            state.columns.productNameColumn === null ||
            candidateCategories.length === 0
          }
          onClick={runAnalysis}
        >
          {state.analyzingCategories
            ? t("analyzing")
            : agentSkippable
            ? t("assignToCandidateButton")
            : t("analyzeButton")}
        </button>
      </div>

      {/* Assignment table */}
      {state.categoriesAnalyzed && state.categoryAssignments.length > 0 ? (
        <div className="s-card" style={{ padding: 0 }}>
          <div style={{ padding: "12px 20px", fontSize: 13, fontWeight: 500, borderBottom: "0.5px solid var(--s-border)" }}>
            {t("tableTitle")}
          </div>
          <div style={{ overflow: "auto", maxHeight: 500 }}>
            <table className="s-table" style={{ minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>{t("col.product")}</th>
                  <th>{t("col.suggested")}</th>
                  <th>{t("col.confidence")}</th>
                  <th style={{ minWidth: 240 }}>{t("col.category")}</th>
                </tr>
              </thead>
              <tbody>
                {state.categoryAssignments.map((a) => (
                  <tr key={a.rowIndex}>
                    <td style={{ paddingLeft: 20 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <ProductThumbnail url={a.photoUrl} alt={a.productName} />
                        <div style={{ fontWeight: 500 }}>{a.productName}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>{a.suggestedCategoryName ?? "—"}</div>
                      {a.reasoning ? (
                        <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 2 }}>
                          {a.reasoning}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <ConfidencePill tier={a.confidenceTier} confidence={a.confidence} userSelected={a.userSelected} />
                    </td>
                    <td>
                      <div style={{ minWidth: 220 }}>
                        <Combobox
                          placeholder={t("col.categoryPlaceholder")}
                          value={a.categoryId}
                          onChange={(id) => setRowCategory(a.rowIndex, id)}
                          options={categories.map((c) => ({ id: c.category_id, label: c.category_name }))}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Footer actions */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 8 }}>
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 1 })}
        >
          {t("back")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-primary"
          disabled={!canContinue}
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 3 })}
        >
          {t("continue")}
        </button>
      </div>

    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function ColumnPicker({
  label,
  value,
  onChange,
  columns,
  previewRows,
  required = false,
}: {
  label: string;
  value: number | null;
  onChange: (idx: number | null) => void;
  columns: string[];
  previewRows: string[][];
  required?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--s-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
        {required ? <span style={{ color: "var(--s-danger)", marginLeft: 4 }}>*</span> : null}
      </div>
      <Combobox
        placeholder="—"
        value={value}
        onChange={onChange}
        options={columns.map((c, i) => ({
          id: i,
          label: c + (previewRows[0]?.[i] ? `  ·  e.g. ${truncate(previewRows[0][i], 32)}` : ""),
        }))}
      />
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function ProductThumbnail({ url, alt }: { url: string | undefined; alt: string }) {
  const [errored, setErrored] = useState(false);
  const showImage = Boolean(url) && !errored;
  return (
    <div
      style={{
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: "var(--s-radius-sm)",
        background: "var(--s-surface-alt)",
        border: "0.5px solid var(--s-border)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--s-text-tertiary)",
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Icon icon={ImageOff} size={16} />
      )}
    </div>
  );
}

function ConfidencePill({
  tier,
  confidence,
  userSelected,
}: {
  tier: "high" | "medium" | "low";
  confidence: number;
  userSelected: boolean;
}) {
  if (userSelected) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "3px 8px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 500,
          background: "var(--scout-accent-50)",
          color: "var(--scout-accent-800)",
        }}
      >
        Manual
      </span>
    );
  }
  const colorMap = {
    high: { bg: "var(--s-success-bg)", color: "var(--s-success-text)", label: "✓" },
    medium: { bg: "var(--s-warning-bg)", color: "var(--s-warning-text)", label: "⏱" },
    low: { bg: "var(--s-danger-bg)", color: "var(--s-danger-text)", label: "✗" },
  } as const;
  const m = colorMap[tier];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: m.bg,
        color: m.color,
      }}
    >
      {m.label} {Math.round(confidence * 100)}%
    </span>
  );
}
