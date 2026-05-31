"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { Category } from "@/components/import/ImportWizard";
import { useWizard } from "@/components/import/WizardContext";

export function Step5Review({ categories: _categories }: { categories: Category[] }) {
  const t = useTranslations("import.wizard.step5");
  const { state, dispatch } = useWizard();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggle(id: string) {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  }

  // Validate: every variant needs a non-empty list price (per Step 4 required mapping)
  const errors: string[] = [];
  const skuSet = new Set<string>();
  for (const base of state.productBases) {
    for (const v of base.variants) {
      if (!v.listPrice.trim()) {
        errors.push(t("err.priceMissing", { base: base.baseName, label: v.label || "(sin etiqueta)" }));
      }
      if (v.sku.trim()) {
        if (skuSet.has(v.sku.trim())) {
          errors.push(t("err.duplicateSku", { sku: v.sku.trim() }));
        }
        skuSet.add(v.sku.trim());
      }
    }
  }

  const totalVariants = state.productBases.reduce((n, b) => n + b.variants.length, 0);

  return (
    <div>
      <div className="s-card">
        <p className="s-card-label">{t("title")}</p>
        <p style={{ fontSize: 12, color: "var(--gl-text-secondary)", margin: "0 0 8px" }}>
          {t("summary", { bases: state.productBases.length, variants: totalVariants })}
        </p>
        {errors.length > 0 ? (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "var(--gl-radius-md)",
              background: "var(--gl-danger-bg)",
              border: "0.5px solid var(--gl-danger)",
              color: "var(--gl-danger-text)",
              marginTop: 12,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 500, marginBottom: 6 }}>{t("err.title", { n: errors.length })}</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {errors.slice(0, 8).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {errors.length > 8 ? <li>{t("err.more", { n: errors.length - 8 })}</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      {state.productBases.map((base) => {
        const open = expanded[base.id] ?? true;
        return (
          <div key={base.id} className="s-card" style={{ padding: 0 }}>
            <button
              type="button"
              onClick={() => toggle(base.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{base.baseName}</div>
                <div style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginTop: 2 }}>
                  {base.categoryName} · {base.variants.length}{" "}
                  {base.variants.length === 1 ? t("variantOne") : t("variantMany")}
                </div>
              </div>
            </button>

            {open ? (
              <div style={{ padding: "0 20px 16px" }}>
                <div style={{ overflow: "auto" }}>
                  <table className="s-table" style={{ minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th>{t("col.label")}</th>
                        <th>{t("col.sku")}</th>
                        <th>{t("col.barcode")}</th>
                        <th>{t("col.weight")}</th>
                        <th>{t("col.listPrice")}</th>
                        <th>{t("col.costPrice")}</th>
                        <th>{t("col.stock")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {base.variants.map((v) => (
                        <tr key={v.id}>
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
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.sku}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "sku",
                                  value: e.target.value,
                                })
                              }
                              style={cellInput()}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.barcode}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "barcode",
                                  value: e.target.value,
                                })
                              }
                              style={cellInput()}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.weightGrams}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "weightGrams",
                                  value: e.target.value,
                                })
                              }
                              style={cellInput()}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.listPrice}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "listPrice",
                                  value: e.target.value,
                                })
                              }
                              style={{
                                ...cellInput(),
                                borderColor: v.listPrice.trim() ? undefined : "var(--gl-danger)",
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.costPrice}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "costPrice",
                                  value: e.target.value,
                                })
                              }
                              style={cellInput()}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={v.stockQty}
                              onChange={(e) =>
                                dispatch({
                                  type: "UPDATE_VARIANT_FIELD",
                                  baseId: base.id,
                                  variantId: v.id,
                                  field: "stockQty",
                                  value: e.target.value,
                                })
                              }
                              style={cellInput()}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 8 }}>
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 4 })}
        >
          {t("back")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-primary"
          disabled={errors.length > 0 || state.productBases.length === 0}
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 6 })}
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
