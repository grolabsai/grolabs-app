"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Sparkles, X } from "lucide-react";

import { useWizard } from "@/components/import/WizardContext";
import { Icon } from "@/components/ui/icon";
import { autoMapColumns } from "@/lib/import/step4-automap";
import type { ColumnMapping, ScoutFieldId } from "@/lib/import/types";

/**
 * Two-column drag-and-drop column mapper.
 *
 * Left: GroLabs fields (the destinations). Top two rows are locked because
 * they were picked in Step 2 (product name + photo URL); the rest are
 * optional drop targets. A field shows its bound file column inline so
 * the pairing is readable from either side.
 *
 * Right: file columns from the uploaded file with a sample value for
 * context. Draggable. A column shows the GroLabs field it's bound to,
 * once it's been dropped, so reading from either side tells you the
 * full pair.
 *
 * On first mount with no mappings, an auto-mapper fills in the obvious
 * matches (sku, barcode, precio, …). The user can drag, drop, and ✕
 * to change anything.
 */

const FIELD_GROUPS: Array<{
  group: "base" | "variant";
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
const ALL_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields);

const DRAG_MIME = "application/x-import-column-index";

export function Step4Mapping() {
  const t = useTranslations("import.wizard.step4");
  const tFields = useTranslations("import.wizard.step4.field");
  const { state, dispatch } = useWizard();
  const file = state.parsedFile;

  // Auto-mapper runs once per parsed file when no mappings exist yet.
  // Uses the file's name as the trigger so a re-upload re-runs.
  const automapRef = useRef<string | null>(null);
  useEffect(() => {
    if (!file) return;
    if (automapRef.current === file.fileName) return;
    automapRef.current = file.fileName;
    const allUnmapped = ALL_FIELDS.every(
      (f) => state.columnMapping[f.id].kind === "unmapped",
    );
    if (!allUnmapped) return;
    const reserved = new Set<number>();
    if (state.columns.productNameColumn !== null) reserved.add(state.columns.productNameColumn);
    if (state.columns.productPhotoColumn !== null) reserved.add(state.columns.productPhotoColumn);
    const guesses = autoMapColumns(file.columns, reserved);
    for (const [field, idx] of Object.entries(guesses)) {
      if (idx === undefined) continue;
      dispatch({
        type: "SET_COLUMN_MAPPING_FIELD",
        field: field as ScoutFieldId,
        mapping: { kind: "column", columnIndex: idx },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.fileName]);

  const [dropTarget, setDropTarget] = useState<ScoutFieldId | null>(null);

  if (!file) return null;

  function setMapping(field: ScoutFieldId, mapping: ColumnMapping[ScoutFieldId]) {
    dispatch({ type: "SET_COLUMN_MAPPING_FIELD", field, mapping });
  }

  // Build (column-index → bound GroLabs field) so each right-side row can
  // show its pairing without scanning the mapping object every render.
  const fieldByColumn = new Map<number, ScoutFieldId>();
  for (const f of ALL_FIELDS) {
    const m = state.columnMapping[f.id];
    if (m.kind === "column") fieldByColumn.set(m.columnIndex, f.id);
  }
  const reservedNameCol = state.columns.productNameColumn;
  const reservedPhotoCol = state.columns.productPhotoColumn;

  function fileColumnLabelFor(idx: number | null): string | null {
    if (idx === null) return null;
    return file?.columns[idx] ?? null;
  }

  function sampleValue(idx: number): string {
    const v = file?.rows[0]?.[idx] ?? "";
    return String(v).trim();
  }

  function handleDragStart(e: React.DragEvent, columnIndex: number) {
    e.dataTransfer.setData(DRAG_MIME, String(columnIndex));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent, field: ScoutFieldId) {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const columnIndex = Number(raw);
    if (!Number.isFinite(columnIndex)) return;
    // If this column is already mapped to another field, unmap it first.
    const previousField = fieldByColumn.get(columnIndex);
    if (previousField && previousField !== field) {
      setMapping(previousField, { kind: "unmapped" });
    }
    setMapping(field, { kind: "column", columnIndex });
  }

  // Required fields must be mapped to a column.
  const requiredOk = ALL_FIELDS.filter((f) => f.required).every(
    (f) => state.columnMapping[f.id].kind === "column",
  );

  return (
    <div>
      <div className="s-card">
        <p className="s-card-label">{t("title")}</p>
        <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 4px" }}>
          {t("subtitle")}
        </p>
        <p style={{ fontSize: 11, color: "var(--s-text-tertiary)", margin: "0 0 16px" }}>
          {t("autoHint")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* LEFT: GroLabs fields */}
          <div>
            <ColumnHeader title={t("scoutFieldsTitle")} subtitle={t("scoutFieldsSubtitle")} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <FieldRow
                title={t("field.productName")}
                locked
                lockHint={t("lockedFromStep2")}
                boundColumnLabel={fileColumnLabelFor(reservedNameCol)}
              />
              <FieldRow
                title={t("field.productPhoto")}
                locked
                lockHint={t("lockedFromStep2")}
                boundColumnLabel={fileColumnLabelFor(reservedPhotoCol)}
              />

              {FIELD_GROUPS.flatMap((g) => g.fields).map((f) => {
                const m = state.columnMapping[f.id];
                const columnIndex = m.kind === "column" ? m.columnIndex : null;
                return (
                  <FieldRow
                    key={f.id}
                    title={tFields(f.id)}
                    required={f.required}
                    boundColumnLabel={fileColumnLabelFor(columnIndex)}
                    isDropTarget={dropTarget === f.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropTarget(f.id);
                    }}
                    onDragLeave={() => setDropTarget((cur) => (cur === f.id ? null : cur))}
                    onDrop={(e) => handleDrop(e, f.id)}
                    onClear={
                      columnIndex !== null
                        ? () => setMapping(f.id, { kind: "unmapped" })
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>

          {/* RIGHT: file columns */}
          <div>
            <ColumnHeader title={t("fileColumnsTitle")} subtitle={t("fileColumnsSubtitle")} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {file.columns.map((col, idx) => {
                const reservedHere =
                  idx === reservedNameCol
                    ? t("field.productName")
                    : idx === reservedPhotoCol
                      ? t("field.productPhoto")
                      : null;
                const boundField = reservedHere
                  ? reservedHere
                  : fieldByColumn.has(idx)
                    ? tFields(fieldByColumn.get(idx)!)
                    : null;
                const draggable = reservedHere === null;
                return (
                  <ColumnRow
                    key={idx}
                    name={col}
                    sample={sampleValue(idx)}
                    boundFieldLabel={boundField}
                    locked={reservedHere !== null}
                    draggable={draggable}
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onClear={
                      !reservedHere && fieldByColumn.has(idx)
                        ? () =>
                            setMapping(fieldByColumn.get(idx)!, { kind: "unmapped" })
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
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
            // Apply mapping: copy column values into each variant's editable
            // fields, matching by the variant's first source row.
            const applied = state.productBases.map((base) => ({
              ...base,
              variants: base.variants.map((v) => {
                const next = { ...v };
                for (const f of ALL_FIELDS) {
                  if (
                    f.id === "slug" ||
                    f.id === "shortDescription" ||
                    f.id === "longDescription"
                  )
                    continue;
                  const m = state.columnMapping[f.id];
                  if (m.kind !== "column") continue;
                  const rowIdx = v.sourceRowIndices[0];
                  if (rowIdx === undefined) continue;
                  const cell = file.rows[rowIdx]?.[m.columnIndex] ?? "";
                  (next[f.id] as string) = String(cell);
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

// ─── Sub-components ────────────────────────────────────────────────────────

function ColumnHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        paddingBottom: 8,
        marginBottom: 12,
        borderBottom: "0.5px solid var(--s-border)",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 2 }}>
        {subtitle}
      </div>
    </div>
  );
}

function FieldRow({
  title,
  required,
  locked,
  lockHint,
  boundColumnLabel,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onClear,
}: {
  title: string;
  required?: boolean;
  locked?: boolean;
  lockHint?: string;
  boundColumnLabel: string | null;
  isDropTarget?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onClear?: () => void;
}) {
  const hasBinding = boundColumnLabel !== null;
  const accent = locked
    ? "var(--s-border)"
    : isDropTarget
      ? "var(--scout-accent)"
      : hasBinding
        ? "var(--s-border)"
        : "var(--s-border)";
  const bg = isDropTarget
    ? "var(--scout-accent-50)"
    : locked
      ? "var(--s-surface-alt)"
      : "white";
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        padding: "10px 12px",
        border: `1px ${locked ? "solid" : "dashed"} ${accent}`,
        borderRadius: "var(--s-radius-md)",
        background: bg,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {title}
          {required ? <span style={{ color: "var(--s-danger)", marginLeft: 4 }}>*</span> : null}
        </span>
        {locked ? (
          <span title={lockHint} style={{ display: "inline-flex", color: "var(--s-text-tertiary)" }}>
            <Icon icon={Lock} size={11} />
          </span>
        ) : null}
        {hasBinding && onClear ? (
          <button
            type="button"
            onClick={onClear}
            title="Quitar"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--s-text-tertiary)",
              padding: 0,
              display: "inline-flex",
            }}
          >
            <Icon icon={X} size={12} />
          </button>
        ) : null}
      </div>
      {hasBinding ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--scout-accent-800)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          = {boundColumnLabel}
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          arrastra una columna aquí
        </div>
      )}
    </div>
  );
}

function ColumnRow({
  name,
  sample,
  boundFieldLabel,
  locked,
  draggable,
  onDragStart,
  onClear,
}: {
  name: string;
  sample: string;
  boundFieldLabel: string | null;
  locked: boolean;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClear?: () => void;
}) {
  const hasBinding = boundFieldLabel !== null;
  const isAuto = !locked && hasBinding;
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        padding: "10px 12px",
        border: `1px solid ${locked ? "var(--s-border)" : "var(--s-border)"}`,
        borderRadius: "var(--s-radius-md)",
        background: locked ? "var(--s-surface-alt)" : "white",
        cursor: draggable ? "grab" : "not-allowed",
        opacity: hasBinding && !locked ? 0.92 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, fontFamily: "ui-monospace, monospace" }}>
          {name}
        </span>
        {locked ? (
          <span style={{ display: "inline-flex", color: "var(--s-text-tertiary)" }}>
            <Icon icon={Lock} size={11} />
          </span>
        ) : null}
        {isAuto ? (
          <span
            title=""
            style={{ display: "inline-flex", color: "var(--scout-accent-800)", marginLeft: 2 }}
          >
            <Icon icon={Sparkles} size={11} />
          </span>
        ) : null}
        {!locked && hasBinding && onClear ? (
          <button
            type="button"
            onClick={onClear}
            title="Quitar"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--s-text-tertiary)",
              padding: 0,
              display: "inline-flex",
            }}
          >
            <Icon icon={X} size={12} />
          </button>
        ) : null}
      </div>
      {sample ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {truncate(sample, 60)}
        </div>
      ) : null}
      {hasBinding ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--scout-accent-800)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          → {boundFieldLabel}
        </div>
      ) : null}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
