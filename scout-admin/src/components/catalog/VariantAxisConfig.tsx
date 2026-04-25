"use client";

import { useState, useTransition } from "react";
import { updateVariantConfig } from "@/lib/actions/category";

/** Standard variant axis options available across all categories */
const STANDARD_AXES = [
  { code: "weight", label: "Peso", icon: "⚖" },
  { code: "color", label: "Color", icon: "◉" },
  { code: "size", label: "Talla", icon: "↕" },
  { code: "length", label: "Longitud", icon: "↔" },
  { code: "volume", label: "Volumen", icon: "◇" },
  { code: "count", label: "Cantidad", icon: "#" },
  { code: "flavor", label: "Sabor", icon: "◈" },
  { code: "material", label: "Material", icon: "▣" },
];

interface Attribute {
  attribute_id: number;
  attribute_name: string;
  attribute_code: string;
  data_type: string;
  requirementLevel: string | null;
}

interface Props {
  categoryId: number;
  categoryName: string;
  initialAxes: string[];
  initialNote: string | null;
  attributes: Attribute[];
}

export function VariantAxisConfig({
  categoryId,
  categoryName,
  initialAxes,
  initialNote,
  attributes,
}: Props) {
  const [axes, setAxes] = useState<string[]>(initialAxes);
  const [note, setNote] = useState(initialNote ?? "");
  const [customAxis, setCustomAxis] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const isDirty =
    JSON.stringify(axes) !== JSON.stringify(initialAxes) ||
    (note || null) !== (initialNote || null);

  function toggleAxis(code: string) {
    setAxes((prev) =>
      prev.includes(code) ? prev.filter((a) => a !== code) : [...prev, code]
    );
    setSaveStatus("idle");
  }

  function addCustomAxis() {
    const trimmed = customAxis.trim().toLowerCase().replace(/\s+/g, "_");
    if (!trimmed || axes.includes(trimmed)) return;
    setAxes((prev) => [...prev, trimmed]);
    setCustomAxis("");
    setSaveStatus("idle");
  }

  function handleSave() {
    setSaveStatus("saving");
    startTransition(async () => {
      const result = await updateVariantConfig(
        categoryId,
        axes,
        note.trim() || null
      );
      if (result.success) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
        setErrorMsg(result.error ?? "Error desconocido");
      }
    });
  }

  // Split attributes into required and optional for display
  const requiredAttrs = attributes.filter(
    (a) => a.requirementLevel === "required"
  );
  const optionalAttrs = attributes.filter(
    (a) => a.requirementLevel !== "required"
  );

  return (
    <div className="variant-config">
      {/* ── Variant axes ── */}
      <section className="vc-section">
        <h3 className="vc-title">Ejes de variante predeterminados</h3>
        <p className="vc-desc">
          Cuando se importa un producto de esta categoría, el sistema buscará
          estos ejes para crear variantes automáticamente.
        </p>

        <div className="vc-chips">
          {STANDARD_AXES.map((axis) => {
            const selected = axes.includes(axis.code);
            return (
              <button
                key={axis.code}
                type="button"
                className={`vc-chip ${selected ? "vc-chip--selected" : ""}`}
                onClick={() => toggleAxis(axis.code)}
              >
                <span className="vc-chip-check">
                  {selected ? "✓" : ""}
                </span>
                {axis.label}
              </button>
            );
          })}

          {/* Show any custom axes not in standard list */}
          {axes
            .filter((a) => !STANDARD_AXES.find((s) => s.code === a))
            .map((code) => (
              <button
                key={code}
                type="button"
                className="vc-chip vc-chip--selected vc-chip--custom"
                onClick={() => toggleAxis(code)}
              >
                <span className="vc-chip-check">✓</span>
                {code}
                <span className="vc-chip-remove">×</span>
              </button>
            ))}
        </div>

        <div className="vc-custom-row">
          <input
            type="text"
            className="vc-custom-input"
            placeholder="Otro eje personalizado..."
            value={customAxis}
            onChange={(e) => setCustomAxis(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomAxis()}
          />
          <button
            type="button"
            className="vc-custom-btn"
            onClick={addCustomAxis}
            disabled={!customAxis.trim()}
          >
            Agregar eje
          </button>
        </div>
      </section>

      {/* ── Parsing note ── */}
      <section className="vc-section">
        <h3 className="vc-title">Nota de interpretación (opcional)</h3>
        <p className="vc-desc">
          Guía para el agente AI al analizar nombres de producto en esta
          categoría. Solo necesario para casos ambiguos.
        </p>
        <textarea
          className="vc-textarea"
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaveStatus("idle");
          }}
          placeholder='Ej: "Palabras como Mediano, Grande se refieren al tamaño de raza, no al tamaño del producto."'
        />
        <p className="vc-hint">
          El agente también usa los atributos definidos abajo para distinguir
          entre variantes y atributos.
        </p>
      </section>

      {/* ── Attribute preview (read-only) ── */}
      <section className="vc-section">
        <h3 className="vc-title">Atributos de esta categoría</h3>
        <p className="vc-desc">
          El agente busca valores de estos atributos al interpretar nombres de
          productos. Gestionados en la pantalla de atributos.
        </p>
        {attributes.length === 0 ? (
          <p className="vc-empty">
            No hay atributos asignados a esta categoría.
          </p>
        ) : (
          <div className="vc-attr-list">
            {requiredAttrs.map((a) => (
              <span key={a.attribute_id} className="vc-attr vc-attr--required">
                {a.attribute_name}
              </span>
            ))}
            {optionalAttrs.map((a) => (
              <span key={a.attribute_id} className="vc-attr vc-attr--optional">
                {a.attribute_name}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── Agent preview ── */}
      <section className="vc-preview">
        <h4 className="vc-preview-title">
          Lo que el agente entiende para esta categoría
        </h4>
        <pre className="vc-preview-code">
{`Categoría: ${categoryName}
Ejes de variante: [${axes.join(", ")}]${note ? `\nNota: "${note}"` : ""}
Atributos a buscar: ${attributes.map((a) => a.attribute_code).join(", ") || "(ninguno)"}`}
        </pre>
      </section>

      {/* ── Save bar ── */}
      <div className="vc-save-bar">
        <span className="vc-save-status">
          {saveStatus === "idle" && isDirty && "Modificado · sin guardar"}
          {saveStatus === "idle" && !isDirty && "Sin cambios"}
          {saveStatus === "saving" && "Guardando..."}
          {saveStatus === "saved" && "✓ Guardado"}
          {saveStatus === "error" && `Error: ${errorMsg}`}
        </span>
        <button
          type="button"
          className="vc-save-btn"
          onClick={handleSave}
          disabled={!isDirty || isPending}
        >
          {isPending ? "Guardando..." : "Guardar configuración"}
        </button>
      </div>

      <style>{`
        .variant-config { margin-top: 16px; }
        .vc-section { margin-bottom: 24px; }
        .vc-title {
          font-size: 13px; font-weight: 600;
          color: var(--s-text, #23211d); margin-bottom: 4px;
        }
        .vc-desc {
          font-size: 12px; color: var(--s-muted, #73726c);
          margin-bottom: 12px; line-height: 1.5;
        }
        .vc-hint {
          font-size: 11px; color: var(--s-muted, #73726c);
          margin-top: 4px;
        }
        .vc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .vc-chip {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 14px; font-size: 12px;
          border-radius: 6px; border: 1px solid var(--s-border, #e5e2da);
          background: var(--s-bg, #fff); color: var(--s-muted, #73726c);
          cursor: pointer; transition: all 0.15s;
          font-family: inherit;
        }
        .vc-chip:hover { border-color: var(--s-border-hover, #c5c2ba); }
        .vc-chip--selected {
          background: var(--s-accent-bg, #e8f0fa);
          border-color: var(--s-accent, #378ADD);
          color: var(--s-accent, #378ADD); font-weight: 600;
        }
        .vc-chip-check {
          width: 14px; height: 14px; border-radius: 3px;
          border: 1px solid var(--s-border, #d5d2ca);
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; line-height: 1;
        }
        .vc-chip--selected .vc-chip-check {
          background: var(--s-accent, #378ADD);
          border-color: var(--s-accent, #378ADD); color: #fff;
        }
        .vc-chip--custom { font-family: var(--font-mono, monospace); }
        .vc-chip-remove {
          font-size: 14px; margin-left: 2px; opacity: 0.6;
        }
        .vc-custom-row { display: flex; gap: 8px; margin-top: 8px; }
        .vc-custom-input {
          flex: 1; font-size: 12px; padding: 6px 10px;
          border: 1px solid var(--s-border, #e5e2da); border-radius: 6px;
          background: var(--s-bg, #fff); color: var(--s-text, #23211d);
          font-family: inherit;
        }
        .vc-custom-input:focus {
          outline: none; border-color: var(--s-accent, #378ADD);
        }
        .vc-custom-btn {
          font-size: 11px; padding: 6px 14px; white-space: nowrap;
          border: 1px solid var(--s-border, #e5e2da); border-radius: 6px;
          background: var(--s-bg, #fff); color: var(--s-text, #23211d);
          cursor: pointer; font-family: inherit;
        }
        .vc-custom-btn:hover:not(:disabled) {
          background: var(--s-surface, #f5f2eb);
        }
        .vc-custom-btn:disabled { opacity: 0.4; cursor: default; }
        .vc-textarea {
          width: 100%; min-height: 72px; font-size: 12px;
          font-family: inherit; padding: 10px 12px;
          border: 1px solid var(--s-border, #e5e2da); border-radius: 6px;
          background: var(--s-bg, #fff); color: var(--s-text, #23211d);
          resize: vertical; line-height: 1.6;
        }
        .vc-textarea:focus {
          outline: none; border-color: var(--s-accent, #378ADD);
        }
        .vc-attr-list { display: flex; flex-wrap: wrap; gap: 4px; }
        .vc-attr {
          padding: 3px 10px; font-size: 11px; border-radius: 0;
          background: var(--s-surface, #f5f2eb);
          color: var(--s-muted, #73726c);
        }
        .vc-attr--required {
          border-left: 2px solid var(--s-accent, #378ADD);
        }
        .vc-attr--optional {
          border-left: 2px solid var(--s-border, #e5e2da);
        }
        .vc-empty {
          font-size: 12px; color: var(--s-muted, #73726c);
          font-style: italic;
        }
        .vc-preview {
          background: var(--s-surface, #f5f2eb); border-radius: 8px;
          padding: 14px 16px; margin-bottom: 16px;
        }
        .vc-preview-title {
          font-size: 11px; font-weight: 600;
          color: var(--s-muted, #73726c); text-transform: uppercase;
          letter-spacing: 0.04em; margin-bottom: 8px;
        }
        .vc-preview-code {
          font-size: 12px; color: var(--s-muted, #73726c);
          font-family: var(--font-mono, 'DM Mono', monospace);
          line-height: 1.6; white-space: pre-wrap; margin: 0;
        }
        .vc-save-bar {
          display: flex; align-items: center;
          justify-content: space-between; padding: 12px 0;
          border-top: 1px solid var(--s-border, #e5e2da);
        }
        .vc-save-status {
          font-size: 12px; color: var(--s-muted, #73726c);
        }
        .vc-save-btn {
          padding: 8px 20px; font-size: 13px; font-weight: 600;
          background: var(--s-accent, #378ADD); color: #fff;
          border: none; border-radius: 6px; cursor: pointer;
          font-family: inherit;
        }
        .vc-save-btn:hover:not(:disabled) { opacity: 0.9; }
        .vc-save-btn:disabled { opacity: 0.5; cursor: default; }
      `}</style>
    </div>
  );
}
