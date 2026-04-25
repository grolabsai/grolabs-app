"use client";

import { useState, useTransition } from "react";
import { updateVariantConfig } from "@/lib/actions/category";
import type { ResolvedAxis } from "@/lib/resolveVariantAxes";
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
 * VariantAxisConfig — shows the full resolved axis pool for a category.
 *
 * Inherited axes (from parent categories) are shown as read-only chips
 * with a source label. Own axes (defined at this level) are editable.
 * Standard axes not yet assigned anywhere in the chain can be added.
 *
 * The parsing note is category-specific — it doesn't inherit.
 */

const AXIS_META: Record<string, { label: string; Icon: LucideIcon }> = {
  weight:   { label: "Peso",     Icon: Scale },
  volume:   { label: "Volumen",  Icon: Droplets },
  size:     { label: "Talla",    Icon: Ruler },
  color:    { label: "Color",    Icon: Palette },
  length:   { label: "Largo",    Icon: MoveHorizontal },
  flavor:   { label: "Sabor",    Icon: Beef },
  count:    { label: "Cantidad", Icon: Hash },
  material: { label: "Material", Icon: Layers },
};

const STANDARD_AXIS_KEYS = Object.keys(AXIS_META);

function axisLabel(axis: string): string {
  return AXIS_META[axis]?.label ?? axis;
}

function AxisIcon({ axis, size = 14 }: { axis: string; size?: number }) {
  const meta = AXIS_META[axis];
  if (!meta) return null;
  const Icon = meta.Icon;
  return <Icon size={size} strokeWidth={1.5} />;
}

export function VariantAxisConfig({
  categoryId,
  initialAxes,
  initialNote,
  resolvedAxes,
  categoryName,
}: {
  categoryId: number;
  initialAxes: string[];
  initialNote: string | null;
  resolvedAxes: ResolvedAxis[];
  categoryName: string;
}) {
  const [ownAxes, setOwnAxes] = useState<string[]>(initialAxes);
  const [note, setNote] = useState(initialNote ?? "");
  const [customAxis, setCustomAxis] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inherited axes = resolved axes NOT defined at this category
  const inheritedAxes = resolvedAxes.filter(
    (r) => r.fromCategoryId !== categoryId,
  );

  // Full pool = inherited + own (deduped)
  const inheritedSet = new Set(inheritedAxes.map((r) => r.axis));
  const fullPool = [
    ...inheritedAxes.map((r) => r.axis),
    ...ownAxes.filter((a) => !inheritedSet.has(a)),
  ];

  // Available to add = standard axes not already in the full pool
  const availableToAdd = STANDARD_AXIS_KEYS.filter(
    (k) => !fullPool.includes(k),
  );

  const dirty =
    JSON.stringify(ownAxes) !== JSON.stringify(initialAxes) ||
    (note || null) !== (initialNote || null);

  function addOwnAxis(value: string) {
    if (!ownAxes.includes(value) && !inheritedSet.has(value)) {
      setOwnAxes((prev) => [...prev, value]);
      setSaved(false);
    }
  }

  function removeOwnAxis(value: string) {
    setOwnAxes((prev) => prev.filter((a) => a !== value));
    setSaved(false);
  }

  function addCustom() {
    const v = customAxis.trim().toLowerCase().replace(/\s+/g, "_");
    if (v && !fullPool.includes(v)) {
      setOwnAxes((prev) => [...prev, v]);
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
        ownAxes,
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

      {/* ── Inherited axes (read-only) ── */}
      {inheritedAxes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="s-variant-label">
            Heredados de categorías superiores
          </div>
          <div className="s-variant-desc">
            Estos ejes se definieron en categorías padre y están disponibles
            automáticamente.
          </div>
          <div className="s-axis-chips">
            {inheritedAxes.map((r) => (
              <span
                key={r.axis}
                className="s-axis-chip selected"
                style={{ cursor: "default", opacity: 0.7 }}
                title={`Heredado de ${r.fromCategoryName}`}
              >
                <AxisIcon axis={r.axis} />
                {axisLabel(r.axis)}
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--s-text-muted)",
                    marginLeft: 4,
                    fontWeight: 400,
                  }}
                >
                  ← {r.fromCategoryName}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Own axes (editable) ── */}
      <div className="s-variant-label">
        Ejes definidos en {categoryName}
      </div>
      <div className="s-variant-desc">
        Estos ejes se suman a los heredados. El agente de importación usará
        el conjunto completo para detectar variantes en los nombres de producto.
      </div>

      <div className="s-axis-chips">
        {/* Own axes — removable */}
        {ownAxes
          .filter((a) => !inheritedSet.has(a))
          .map((a) => (
            <button
              key={a}
              type="button"
              className="s-axis-chip selected"
              onClick={() => removeOwnAxis(a)}
              title="Clic para quitar"
            >
              <AxisIcon axis={a} />
              {axisLabel(a)}
              <span className="s-axis-remove">×</span>
            </button>
          ))}

        {/* Available standard axes — clickable to add */}
        {availableToAdd.map((k) => (
          <button
            key={k}
            type="button"
            className="s-axis-chip"
            onClick={() => addOwnAxis(k)}
            title="Clic para agregar"
          >
            <AxisIcon axis={k} />
            {axisLabel(k)}
          </button>
        ))}

        {/* Custom axis input */}
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

      {/* ── Parsing note ── */}
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

      {/* ── Agent preview — shows full resolved pool ── */}
      {fullPool.length > 0 && (
        <div className="s-agent-preview">
          <div className="s-agent-preview-label">
            Vista previa del agente — pool completo para esta categoría
          </div>
          <div className="s-agent-preview-body">
            <span style={{ color: "var(--s-text-tertiary)" }}>
              Ejes de variante:
            </span>{" "}
            {fullPool.map((a) => axisLabel(a)).join(", ")}
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

      {/* ── Save ── */}
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
