"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
 */

const AXIS_ICONS: Record<string, LucideIcon> = {
  weight: Scale,
  volume: Droplets,
  size: Ruler,
  color: Palette,
  length: MoveHorizontal,
  flavor: Beef,
  count: Hash,
  material: Layers,
};

const STANDARD_AXIS_KEYS = Object.keys(AXIS_ICONS);

function AxisIcon({ axis, size = 14 }: { axis: string; size?: number }) {
  const Icon = AXIS_ICONS[axis];
  if (!Icon) return null;
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
  const t = useTranslations("catalog.variantAxis");

  const axisNameMap = new Map(resolvedAxes.map((r) => [r.axis, r.attributeName]));

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

  function axisLabel(axis: string): string {
    const key = `axes.${axis}` as Parameters<typeof t>[0];
    try {
      return t(key);
    } catch {
      return axis;
    }
  }

  function displayName(axis: string): string {
    return axisNameMap.get(axis) || axisLabel(axis);
  }

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
      const result = await updateVariantConfig(categoryId, ownAxes, note || null);
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
          <div className="s-variant-label">{t("inheritedLabel")}</div>
          <div className="s-variant-desc">{t("inheritedDesc")}</div>
          <div className="s-axis-chips">
            {inheritedAxes.map((r) => (
              <span
                key={r.axis}
                className="s-axis-chip selected"
                style={{ cursor: "default", opacity: 0.7 }}
                title={t("inheritedFrom", { name: r.fromCategoryName })}
              >
                <AxisIcon axis={r.axis} />
                {r.attributeName || axisLabel(r.axis)}
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
        {t("ownLabel", { categoryName })}
      </div>
      <div className="s-variant-desc">{t("ownDesc")}</div>

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
              title={t("removeHint")}
            >
              <AxisIcon axis={a} />
              {displayName(a)}
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
            title={t("addHint")}
          >
            <AxisIcon axis={k} />
            {displayName(k)}
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
              placeholder={t("customPlaceholder")}
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
            {t("addOther")}
          </button>
        )}
      </div>

      {/* ── Parsing note ── */}
      <div className="s-variant-label" style={{ marginTop: 16 }}>
        {t("noteLabel")}
        <span
          style={{
            fontWeight: 400,
            color: "var(--s-text-tertiary)",
            marginLeft: 6,
          }}
        >
          {t("noteOptional")}
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
        placeholder={t("notePlaceholder")}
      />

      {/* ── Agent preview — shows full resolved pool ── */}
      {fullPool.length > 0 && (
        <div className="s-agent-preview">
          <div className="s-agent-preview-label">{t("previewLabel")}</div>
          <div className="s-agent-preview-body">
            <span style={{ color: "var(--s-text-tertiary)" }}>
              {t("previewAxes")}
            </span>{" "}
            {fullPool.map((a) => displayName(a)).join(", ")}
            {note ? (
              <>
                <br />
                <span style={{ color: "var(--s-text-tertiary)" }}>
                  {t("previewNote")}
                </span>{" "}
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
          {isPending ? t("saving") : t("saveButton")}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "var(--s-success)" }}>
            {t("saved")}
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
