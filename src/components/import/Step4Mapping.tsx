"use client";

import { useTranslations } from "next-intl";

import { useWizard } from "@/components/import/WizardContext";
import { Combobox } from "@/components/ui/combobox";
import type { ColumnMapping, ScoutFieldId } from "@/lib/import/types";

const FIELD_GROUPS: Array<{
  group: string;
  fields: Array<{ id: ScoutFieldId; required?: boolean }>;
}> = [
  {
    group: "base",
    fields: [
      { id: "slug" },
      { id: "shortDescription" },
      { id: "longDescription" },
    ],
  },
  {
    group: "variant",
    fields: [
      { id: "sku" },
      { id: "barcode" },
      { id: "weightGrams" },
      { id: "listPrice", required: true },
      { id: "costPrice" },
      { id: "stockQty" },
    ],
  },
];

export function Step4Mapping() {
  const t = useTranslations("import.wizard.step4");
  const tFields = useTranslations("import.wizard.step4.field");
  const { state, dispatch } = useWizard();

  const file = state.parsedFile;
  if (!file) return null;

  function setMapping(field: ScoutFieldId, mapping: ColumnMapping[ScoutFieldId]) {
    dispatch({ type: "SET_COLUMN_MAPPING_FIELD", field, mapping });
  }

  function getColumnIndex(field: ScoutFieldId): number | null {
    const m = state.columnMapping[field];
    return m.kind === "column" ? m.columnIndex : null;
  }

  // Required fields must be mapped to a column.
  const requiredOk = FIELD_GROUPS.flatMap((g) => g.fields)
    .filter((f) => f.required)
    .every((f) => state.columnMapping[f.id].kind === "column");

  return (
    <div>
      <div className="s-card">
        <p className="s-card-label">{t("title")}</p>
        <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 16px" }}>
          {t("subtitle")}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {FIELD_GROUPS.map((g) => (
            <div key={g.group}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--s-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 12,
                }}
              >
                {t(`group.${g.group}`)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {g.fields.map((f) => (
                  <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {tFields(f.id)}
                      {f.required ? <span style={{ color: "var(--s-danger)", marginLeft: 4 }}>*</span> : null}
                    </div>
                    <Combobox
                      placeholder={t("noColumn")}
                      value={getColumnIndex(f.id)}
                      onChange={(idx) =>
                        setMapping(
                          f.id,
                          idx === null
                            ? { kind: "unmapped" }
                            : { kind: "column", columnIndex: idx },
                        )
                      }
                      options={file.columns.map((c, i) => ({
                        id: i,
                        label: c,
                      }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 8 }}>
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 3 })}
        >
          {t("back")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-primary"
          disabled={!requiredOk}
          onClick={() => {
            // Apply mapping: copy column values into each variant's editable fields,
            // matching by sourceRowIndices.
            const applied = state.productBases.map((base) => ({
              ...base,
              variants: base.variants.map((v) => {
                const next = { ...v };
                for (const g of FIELD_GROUPS) {
                  for (const f of g.fields) {
                    if (f.id === "slug" || f.id === "shortDescription" || f.id === "longDescription") continue;
                    const m = state.columnMapping[f.id];
                    if (m.kind !== "column") continue;
                    const rowIdx = v.sourceRowIndices[0];
                    if (rowIdx === undefined) continue;
                    const cell = file.rows[rowIdx]?.[m.columnIndex] ?? "";
                    (next[f.id] as string) = String(cell);
                  }
                }
                return next;
              }),
            }));
            dispatch({ type: "SET_PRODUCT_BASES", bases: applied });
            dispatch({ type: "GO_TO_STEP", step: 5 });
          }}
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}
