"use client";

import { useState, useTransition } from "react";
import { updateVariantConfig } from "@/lib/actions/category";
import {
  Scale,
  Droplets,
  Ruler,
  Palette,
  MoveHorizontal,
  Beef,
  Hash,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * VariantAxisConfig — editable chip selector for default_variant_axes
 * and a parsing_note textarea. Saves via server action.
 *
 * Standard axes are predefined; "custom" lets the user type one in.
 * The parsing note is optional — used for ambiguous cases where the
 * AI agent needs extra context (e.g. "Mediano refers to breed size,
 * not product size").
 */

const STANDARD_AXES: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: "weight", label: "Peso", Icon: Scale },
  { value: "volume", label: "Volumen", Icon: Droplets },
  { value: "size", label: "Talla", Icon: Ruler },
  { value: "color", label: "Color", Icon: Palette },
  { value: "length", label: "Largo", Icon: MoveHorizontal },
  { value: "flavor", label: "Sabor", Icon: Beef },
  { value: "count", label: "Cantidad", Icon: Hash },
  { value: "material", label: "Material", Icon: Layers },
];

export function VariantAxisConfig({
  categoryId,
  initialAxes,
  initialNote,
}: {
  categoryId: number;
  initialAxes: string[];
  initialNote: string | null;
}) {
  const [axes, setAxes] = useState<string[]>(initialAxes);
  const [note, setNote] = useState(initialNote ?? "");
  const [customAxis, setCustomAxis] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    JSON.stringify(axes) !== JSON.stringify(initialAxes) ||
    (note || null) !== (initialNote || null);

  function toggleAxis(value: string) {
    setAxes((prev) =>
      prev.includes(value)
        ? prev.filter((a) => a !== value)
        : [...prev, value],
    );
    setSaved(false);
  }

  function addCustom() {
    const v = customAxis.trim().toLowerCase().replace(/\s+/g, "_");
    if (v && !axes.includes(v)) {
      setAxes((prev) => [...prev, v]);
      setCustomAxis("");
      setShowCustom(false);
      setSaved(false);
    }
  }

  function handleSave() {
    startTransition(async () => {
      setError(null);
      const result = await updateVariantConfig(
        categoryId,
        axes,
        note || null,
      );
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <div className="s-variant-config">
      <div className="s-variant-label">Ejes de variante predeterminados</div>
      <div className="s-variant-desc">
        Define qué dimensiones generan variantes para productos en esta
        categoría. El agente de importación usará esta configuración para
        distinguir variantes de atributos.
      </div>

      <div className="s-axis-chips">
        {STANDARD_AXES.map((ax) => (
          <button
            key={ax.value}
            type="button"
            className={`s-axis-chip${axes.includes(ax.value) ? " selected" : ""}`}
            onClick={() => toggleAxis(ax.value)}
          >
            <ax.Icon size={14} strokeWidth={1.5} />
            {ax.label}
          </button>
        ))}

        {/* Custom axes that aren't in the standard list */}
        {axes
          .filter((a) => !STANDARD_AXES.some((s) => s.value === a))
          .map((a) => (
            <button
              key={a}
              type="button"
              className="s-axis-chip selected custom"
              onClick={() => toggleAxis(a)}
            >
              {a}
              <span className="s-axis-remove">×</span>
            </button>
          ))}

        {showCustom ? (
          <span className="s-axis-custom-input">
            <input
              type="text"
              value={customAxis}
              onChange={(e) => setCustomAxis(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
              placeholder="nombre…"
              autoFocus
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: "var(--s-font)",
                fontSize: 12,
                width: 80,
                color: "var(--s-text)",
              }}
            />
            <button
              type="button"
              onClick={addCustom}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 11,
                color: "var(--scout-accent)",
                fontWeight: 500,
              }}
            >
              ✓
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="s-axis-chip add"
            onClick={() => setShowCustom(true)}
          >
            + Otro
          </button>
        )}
      </div>

      <div className="s-variant-label" style={{ marginTop: 16 }}>
        Nota de contexto para el agente
        <span
          style={{
            fontWeight: 400,
            color: "var(--s-text-tertiary)",
            marginLeft: 6,
          }}
        >
          (opcional)
        </span>
      </div>
      <textarea
        className="s-variant-note"
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        placeholder='Ej: "Palabras como Mediano, Grande se refieren al tamaño de raza, no al tamaño del producto."'
      />

      {/* Agent preview */}
      {axes.length > 0 && (
        <div className="s-agent-preview">
          <div className="s-agent-preview-label">Vista previa del agente</div>
          <div className="s-agent-preview-body">
            <span style={{ color: "var(--s-text-tertiary)" }}>
              Ejes de variante:
            </span>{" "}
            {axes.join(", ")}
            {note ? (
              <>
                <br />
                <span style={{ color: "var(--s-text-tertiary)" }}>Nota:</span>{" "}
                {note}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Save button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={handleSave}
          disabled={!dirty || isPending}
          style={{ opacity: dirty ? 1 : 0.5 }}
        >
          {isPending ? "Guardando…" : "Guardar configuración"}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "var(--s-success)" }}>
            ✓ Guardado
          </span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "var(--s-danger)" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
