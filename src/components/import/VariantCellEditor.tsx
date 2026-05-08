"use client";

import type { Unit } from "@/components/import/ImportWizard";
import type {
  ProposedAttributeCell,
  ProposedAxisCell,
} from "@/lib/import/types";
import type { EffectiveAttribute } from "@/lib/import/vocabulary";

/**
 * Editable cell for a single (variant, attribute) pair in Step 3.
 *
 * The shape of the input depends on the attribute's data_type:
 *   list / multiselect → <select> populated from the attribute's options
 *   boolean             → tri-state checkbox (null / true / false)
 *   quantity            → number input + unit <select> (units filtered by dimension)
 *   number              → number input
 *   text / url          → text input
 *
 * Always editable, even when the agent didn't extract a value — the
 * user can fill it in. Empty just means "no value yet"; no placeholder
 * text like "select" or "n/a" inside the input.
 */

const CELL_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  height: 28,
  padding: "0 6px",
  fontSize: 12,
  border: "0.5px solid var(--s-border)",
  borderRadius: "var(--s-radius-sm)",
  background: "white",
  outline: "none",
};

type AxisProps = {
  attribute: EffectiveAttribute;
  cell: ProposedAxisCell | undefined;
  options: { value_id: number; value: string }[];
  units: Unit[];
  onUpsert: (cell: ProposedAxisCell) => void;
  onRemove: () => void;
  /** Visual accent for matched (agent-populated) cells. */
  accent?: { bg: string; fg: string } | null;
};

export function AxisCellEditor({
  attribute,
  cell,
  options,
  units,
  onUpsert,
  onRemove,
  accent,
}: AxisProps) {
  const filledStyle: React.CSSProperties = accent
    ? { background: accent.bg, color: accent.fg, borderColor: accent.bg }
    : {};

  function build(partial: Partial<ProposedAxisCell>): ProposedAxisCell {
    return {
      attributeId: attribute.attribute_id,
      attributeCode: attribute.attribute_code,
      attributeName: attribute.attribute_name,
      dataType: attribute.data_type,
      valueId: partial.valueId ?? null,
      valueText: partial.valueText ?? null,
      valueNumber: partial.valueNumber ?? null,
      unitId: partial.unitId ?? null,
      unitCode: partial.unitCode ?? null,
      // User edits don't carry a source span; clear the agent's hint so
      // the highlighter doesn't keep coloring an old span for a value
      // the user has since changed.
      extractedFrom: null,
    };
  }

  switch (attribute.data_type) {
    case "list":
    case "multiselect": {
      const selected =
        cell?.valueId != null ? String(cell.valueId) : cell?.valueText ?? "";
      return (
        <select
          value={selected}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return onRemove();
            // Match the selected value back to an option id when possible;
            // fall back to a free-text value otherwise.
            const opt = options.find((o) => String(o.value_id) === v);
            if (opt) onUpsert(build({ valueId: opt.value_id }));
            else onUpsert(build({ valueText: v }));
          }}
          style={{
            ...CELL_INPUT_STYLE,
            ...(cell ? filledStyle : {}),
          }}
        >
          <option value="" />
          {options.map((o) => (
            <option key={o.value_id} value={String(o.value_id)}>
              {o.value}
            </option>
          ))}
        </select>
      );
    }
    case "boolean": {
      const checked = booleanFromCell(cell);
      return (
        <input
          type="checkbox"
          checked={checked === true}
          onChange={(e) =>
            onUpsert(build({ valueText: e.target.checked ? "true" : "false" }))
          }
          style={{ width: 16, height: 16, margin: 6, accentColor: accent?.fg }}
          aria-label={attribute.attribute_name}
        />
      );
    }
    case "quantity": {
      const num = cell?.valueNumber ?? "";
      const unitId = cell?.unitId != null ? String(cell.unitId) : "";
      const allowedUnits = units.filter(
        (u) => attribute.dimension == null || u.dimension === attribute.dimension,
      );
      return (
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="number"
            inputMode="decimal"
            value={num === null ? "" : String(num)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return onRemove();
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              onUpsert(
                build({
                  valueNumber: n,
                  unitId: cell?.unitId ?? null,
                  unitCode: cell?.unitCode ?? null,
                }),
              );
            }}
            style={{ ...CELL_INPUT_STYLE, flex: 1, ...(cell ? filledStyle : {}) }}
          />
          <select
            value={unitId}
            onChange={(e) => {
              const v = e.target.value;
              const u = allowedUnits.find((x) => String(x.unit_id) === v);
              onUpsert(
                build({
                  valueNumber: cell?.valueNumber ?? null,
                  unitId: u?.unit_id ?? null,
                  unitCode: u?.code ?? null,
                }),
              );
            }}
            style={{ ...CELL_INPUT_STYLE, width: 64, ...(cell?.unitCode ? filledStyle : {}) }}
          >
            <option value="" />
            {allowedUnits.map((u) => (
              <option key={u.unit_id} value={String(u.unit_id)}>
                {u.code}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "number":
      return (
        <input
          type="number"
          inputMode="decimal"
          value={cell?.valueNumber == null ? "" : String(cell.valueNumber)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return onRemove();
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            onUpsert(build({ valueNumber: n }));
          }}
          style={{ ...CELL_INPUT_STYLE, ...(cell ? filledStyle : {}) }}
        />
      );
    case "url":
    case "text":
    default:
      return (
        <input
          type="text"
          value={cell?.valueText ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return onRemove();
            onUpsert(build({ valueText: v }));
          }}
          style={{ ...CELL_INPUT_STYLE, ...(cell ? filledStyle : {}) }}
        />
      );
  }
}

type AttributeProps = {
  attribute: EffectiveAttribute;
  cell: ProposedAttributeCell | undefined;
  options: { value_id: number; value: string }[];
  onUpsert: (cell: ProposedAttributeCell) => void;
  onRemove: () => void;
  accent?: { bg: string; fg: string } | null;
};

export function AttributeCellEditor({
  attribute,
  cell,
  options,
  onUpsert,
  onRemove,
  accent,
}: AttributeProps) {
  const filledStyle: React.CSSProperties = accent
    ? { background: accent.bg, color: accent.fg, borderColor: accent.bg }
    : {};

  function build(partial: Partial<ProposedAttributeCell>): ProposedAttributeCell {
    return {
      attributeId: attribute.attribute_id,
      attributeCode: attribute.attribute_code,
      attributeName: attribute.attribute_name,
      dataType: attribute.data_type,
      valueId: partial.valueId ?? null,
      valueText: partial.valueText ?? null,
      extractedFrom: null,
    };
  }

  switch (attribute.data_type) {
    case "list":
    case "multiselect": {
      const selected =
        cell?.valueId != null ? String(cell.valueId) : cell?.valueText ?? "";
      return (
        <select
          value={selected}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return onRemove();
            const opt = options.find((o) => String(o.value_id) === v);
            if (opt) onUpsert(build({ valueId: opt.value_id }));
            else onUpsert(build({ valueText: v }));
          }}
          style={{ ...CELL_INPUT_STYLE, ...(cell ? filledStyle : {}) }}
        >
          <option value="" />
          {options.map((o) => (
            <option key={o.value_id} value={String(o.value_id)}>
              {o.value}
            </option>
          ))}
        </select>
      );
    }
    case "boolean": {
      const checked = booleanFromCell(cell);
      return (
        <input
          type="checkbox"
          checked={checked === true}
          onChange={(e) =>
            onUpsert(build({ valueText: e.target.checked ? "true" : "false" }))
          }
          style={{ width: 16, height: 16, margin: 6, accentColor: accent?.fg }}
          aria-label={attribute.attribute_name}
        />
      );
    }
    case "url":
    case "text":
    default:
      return (
        <input
          type="text"
          value={cell?.valueText ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return onRemove();
            onUpsert(build({ valueText: v }));
          }}
          style={{ ...CELL_INPUT_STYLE, ...(cell ? filledStyle : {}) }}
        />
      );
  }
}

function booleanFromCell(
  cell: ProposedAxisCell | ProposedAttributeCell | undefined,
): boolean | null {
  if (!cell) return null;
  const v = cell.valueText?.trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "sí" || v === "si") return true;
  if (v === "false" || v === "no") return false;
  return null;
}
