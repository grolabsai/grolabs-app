"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createVariant, checkSkuUnique } from "../../../_actions";
import { Combobox } from "@/components/ui/combobox";
import type { AxisDef } from "../../../_types";

type UnitOption = {
  unit_id: number;
  code: string;
  name: string;
  dimension: string;
};

type AxisValue = {
  value_id: number | null;
  value_text: string | null;
  value_number: number | null;
  unit_id: number | null;
};

type Props = {
  productId: number;
  productName: string;
  axes: AxisDef[];
  units: UnitOption[];
};

export function VariantCreateForm({ productId, productName, axes, units }: Props) {
  const t = useTranslations("catalog.variants");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [axisValues, setAxisValues] = useState<Record<number, AxisValue>>(
    Object.fromEntries(
      axes.map((ax) => [
        ax.attribute_id,
        { value_id: null, value_text: null, value_number: null, unit_id: null },
      ]),
    ),
  );

  const [labelOverride, setLabelOverride] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [skuError, setSkuError] = useState<string | null>(null);

  function setAxisValue(attributeId: number, patch: Partial<AxisValue>) {
    setAxisValues((prev) => ({ ...prev, [attributeId]: { ...prev[attributeId], ...patch } }));
    setError(null);
  }

  function getAxisDisplayValue(ax: AxisDef): string {
    const v = axisValues[ax.attribute_id];
    if (!v) return "";
    if (ax.data_type === "list") {
      return ax.options.find((o) => o.value_id === v.value_id)?.value ?? "";
    }
    if (ax.data_type === "quantity") {
      if (v.value_number == null) return "";
      const unit = units.find((u) => u.unit_id === v.unit_id);
      return `${v.value_number}${unit ? " " + unit.code : ""}`;
    }
    if (ax.data_type === "number") {
      return v.value_number != null ? String(v.value_number) : "";
    }
    return v.value_text ?? "";
  }

  // Derive label and name during render — no useEffect needed
  const autoLabel = axes.map((ax) => getAxisDisplayValue(ax)).filter(Boolean).join(" · ");
  const variantLabel = labelOverride ?? autoLabel;
  const autoName = variantLabel ? `${productName} ${variantLabel}` : productName;
  const variantName = nameOverride ?? autoName;

  async function handleSkuBlur() {
    const trimmed = sku.trim();
    if (!trimmed) return;
    const result = await checkSkuUnique(trimmed);
    if ("error" in result) return;
    if (!result.unique) setSkuError(t("form.validation.skuTaken"));
    else setSkuError(null);
  }

  function handleSave() {
    if (!sku.trim()) { setError(t("form.validation.skuRequired")); return; }
    if (!listPrice || Number(listPrice) <= 0) {
      setError(t("form.validation.pricePositive"));
      return;
    }
    for (const ax of axes) {
      const v = axisValues[ax.attribute_id];
      if (!v) continue;
      if (ax.data_type === "list" && v.value_id == null) {
        setError(t("form.validation.axisRequired")); return;
      }
      if (ax.data_type === "text" && !v.value_text?.trim()) {
        setError(t("form.validation.axisRequired")); return;
      }
      if ((ax.data_type === "number" || ax.data_type === "quantity") && v.value_number == null) {
        setError(t("form.validation.axisRequired")); return;
      }
    }

    const axisValuesList = axes.map((ax) => ({
      attribute_id: ax.attribute_id,
      ...(axisValues[ax.attribute_id] ?? {
        value_id: null, value_text: null, value_number: null, unit_id: null,
      }),
    }));

    startTransition(async () => {
      const result = await createVariant({
        product_id: productId,
        variant_name: variantName,
        variant_label: variantLabel,
        sku: sku.trim(),
        list_price: Number(listPrice),
        axis_values: axisValuesList,
      });
      if ("error" in result) {
        setError(result.error ?? null);
      } else {
        router.push(`/catalog/products/${productId}/variants/${result.data!.variant_id}`);
      }
    });
  }

  return (
    <div style={{ maxWidth: 600 }}>
      {axes.length > 0 ? (
        <>
          <SectionHeader>{t("form.sections.axes")}</SectionHeader>
          {axes.map((ax) => (
            <AxisInput
              key={ax.attribute_id}
              axis={ax}
              value={axisValues[ax.attribute_id] ?? { value_id: null, value_text: null, value_number: null, unit_id: null }}
              units={units.filter((u) => !ax.dimension || u.dimension === ax.dimension)}
              onChange={(patch) => setAxisValue(ax.attribute_id, patch)}
              pickerPlaceholder={t("axes.pickerPlaceholder")}
              freeTextPlaceholder={t("axes.freeTextPlaceholder")}
              freeNumberPlaceholder={t("axes.freeNumberPlaceholder")}
              inheritedLabel={t("axes.inheritedFrom", { categoryName: ax.from_category_name })}
            />
          ))}
        </>
      ) : (
        <div style={{ marginBottom: 20, fontSize: 12, color: "var(--s-text-secondary)" }}>
          {t("axes.noAxes")}
        </div>
      )}

      <SectionHeader style={{ marginTop: axes.length > 0 ? 20 : 0 }}>
        {t("form.sections.identity")}
      </SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.variantLabel")}</label>
        <input
          type="text"
          className="s-input"
          value={variantLabel}
          onChange={(e) => setLabelOverride(e.target.value)}
        />
        <div style={{ fontSize: 10, color: "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
          {t("form.fields.variantLabelHint")}
        </div>
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.variantName")}</label>
        <input
          type="text"
          className="s-input"
          value={variantName}
          onChange={(e) => setNameOverride(e.target.value)}
        />
        <div style={{ fontSize: 10, color: "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
          {t("form.fields.variantNameHint")}
        </div>
      </div>

      <div className="s-row-pair">
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.sku")}</label>
          <input
            type="text"
            className="s-input s-input-mono"
            value={sku}
            placeholder={t("form.fields.skuPlaceholder")}
            onChange={(e) => { setSku(e.target.value); setSkuError(null); }}
            onBlur={handleSkuBlur}
          />
          <div style={{ fontSize: 10, color: skuError ? "var(--s-danger)" : "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
            {skuError ?? t("form.fields.skuHint")}
          </div>
        </div>
        <div className="s-field" />
      </div>

      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.pricing")}</SectionHeader>

      <div className="s-row-pair">
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.listPrice")}</label>
          <input
            type="number"
            className="s-input"
            value={listPrice}
            placeholder={t("form.fields.listPricePlaceholder")}
            min="0"
            step="0.01"
            onChange={(e) => { setListPrice(e.target.value); setError(null); }}
          />
        </div>
        <div className="s-field" />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
          paddingTop: 16,
          borderTop: "0.5px solid var(--s-border)",
        }}
      >
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={handleSave}
          disabled={isPending || !!skuError}
        >
          {isPending ? t("actions.creating") : t("actions.create")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={() => router.push(`/catalog/products/${productId}`)}
          disabled={isPending}
        >
          {t("actions.back")}
        </button>
        {error && <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>}
      </div>
    </div>
  );
}

function AxisInput({
  axis,
  value,
  units,
  onChange,
  pickerPlaceholder,
  freeTextPlaceholder,
  freeNumberPlaceholder,
  inheritedLabel,
}: {
  axis: AxisDef;
  value: AxisValue;
  units: UnitOption[];
  onChange: (patch: Partial<AxisValue>) => void;
  pickerPlaceholder: string;
  freeTextPlaceholder: string;
  freeNumberPlaceholder: string;
  inheritedLabel: string;
}) {
  const listOptions = axis.options.map((o) => ({ value: o.value_id, label: o.value }));

  return (
    <div className="s-field">
      <label className="s-field-label">
        {axis.attribute_name}
        <span style={{ fontSize: 10, color: "var(--s-text-tertiary)", marginLeft: 6, fontWeight: 400 }}>
          {inheritedLabel}
        </span>
      </label>
      {axis.data_type === "list" ? (
        <Combobox
          options={listOptions}
          value={value.value_id}
          onValueChange={(v) => onChange({ value_id: v as number | null })}
          placeholder={pickerPlaceholder}
        />
      ) : axis.data_type === "quantity" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            className="s-input"
            style={{ flex: 1 }}
            value={value.value_number ?? ""}
            placeholder={freeNumberPlaceholder}
            min="0"
            step="any"
            onChange={(e) =>
              onChange({ value_number: e.target.value ? Number(e.target.value) : null })
            }
          />
          {units.length > 0 ? (
            <select
              className="s-input"
              style={{ width: 90 }}
              value={value.unit_id ?? ""}
              onChange={(e) =>
                onChange({ unit_id: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.unit_id} value={u.unit_id}>
                  {u.code}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : axis.data_type === "number" ? (
        <input
          type="number"
          className="s-input"
          value={value.value_number ?? ""}
          placeholder={freeNumberPlaceholder}
          step="any"
          onChange={(e) =>
            onChange({ value_number: e.target.value ? Number(e.target.value) : null })
          }
        />
      ) : (
        <input
          type="text"
          className="s-input"
          value={value.value_text ?? ""}
          placeholder={freeTextPlaceholder}
          onChange={(e) => onChange({ value_text: e.target.value || null })}
        />
      )}
    </div>
  );
}

function SectionHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: "0.5px solid var(--s-border)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
