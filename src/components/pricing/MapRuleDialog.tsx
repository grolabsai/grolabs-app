"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AsyncVariantPicker } from "@/components/pricing/AsyncVariantPicker";
import {
  saveMapRule,
  type MapRuleRow,
  type MapRuleType,
  type MapRuleSourceType,
  type BrandRow,
  type ProviderRow,
} from "@/lib/actions/pricing";

/**
 * Create / edit a MAP rule.
 *
 * The form swaps fields based on two pivots:
 *   - rule_type (MAP_min / max_price / custom) drives which of min_price /
 *     max_price are shown. 'custom' shows both.
 *   - source_type (brand / provider) swaps the source dropdown between
 *     the brand list and the provider list.
 *
 * Variant pickers stay async + server-backed because the catalog can be
 * large; brand and provider lists arrive pre-loaded since they're small.
 */
export function MapRuleDialog({
  open,
  onOpenChange,
  initial,
  brands,
  providers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MapRuleRow | null; // null = create
  brands: BrandRow[];
  providers: ProviderRow[];
}) {
  const t = useTranslations("pricing.mapRules.dialog");
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();

  const isEdit = initial !== null;

  const [ruleType, setRuleType] = useState<MapRuleType>(
    initial?.rule_type ?? "MAP_min",
  );
  const [sourceType, setSourceType] = useState<MapRuleSourceType>(
    initial?.source_type ?? "brand",
  );
  const [sourceId, setSourceId] = useState<number | null>(
    initial?.source_id ?? null,
  );
  const [appliesTo, setAppliesTo] = useState<"all" | "specific">(
    initial?.variant_id ? "specific" : "all",
  );
  const [variantId, setVariantId] = useState<number | null>(
    initial?.variant_id ?? null,
  );
  const [variantLabel, setVariantLabel] = useState<string | null>(
    initial?.variant_label ?? null,
  );
  const [minPrice, setMinPrice] = useState<string>(
    initial?.min_price !== null && initial?.min_price !== undefined
      ? String(initial.min_price)
      : "",
  );
  const [maxPrice, setMaxPrice] = useState<string>(
    initial?.max_price !== null && initial?.max_price !== undefined
      ? String(initial.max_price)
      : "",
  );
  const [effectiveDate, setEffectiveDate] = useState<string>(
    initial?.effective_date ?? new Date().toISOString().slice(0, 10),
  );
  const [expiresAt, setExpiresAt] = useState<string>(
    initial?.expires_at ?? "",
  );
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);

  const showMin = ruleType === "MAP_min" || ruleType === "custom";
  const showMax = ruleType === "max_price" || ruleType === "custom";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sourceId === null) {
      toast.error(t("toast.sourceRequired"));
      return;
    }
    if (appliesTo === "specific" && variantId === null) {
      toast.error(t("toast.variantRequired"));
      return;
    }

    const minNum = minPrice.trim() === "" ? null : Number.parseFloat(minPrice);
    const maxNum = maxPrice.trim() === "" ? null : Number.parseFloat(maxPrice);

    if (showMin && (minNum === null || !Number.isFinite(minNum) || minNum < 0)) {
      toast.error(t("toast.invalidMin"));
      return;
    }
    if (showMax && (maxNum === null || !Number.isFinite(maxNum) || maxNum < 0)) {
      toast.error(t("toast.invalidMax"));
      return;
    }
    if (
      minNum !== null &&
      maxNum !== null &&
      Number.isFinite(minNum) &&
      Number.isFinite(maxNum) &&
      minNum > maxNum
    ) {
      toast.error(t("toast.minAboveMax"));
      return;
    }

    startSubmit(async () => {
      const res = await saveMapRule({
        map_rule_id: initial?.map_rule_id ?? null,
        rule_type: ruleType,
        source_type: sourceType,
        source_id: sourceId,
        variant_id: appliesTo === "specific" ? variantId : null,
        min_price: showMin ? minNum : null,
        max_price: showMax ? maxNum : null,
        is_active: isActive,
        effective_date: effectiveDate,
        expires_at: expiresAt.trim() === "" ? null : expiresAt,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      if (!res.ok) {
        toast.error(t("toast.saveError"), { description: res.error });
        return;
      }
      toast.success(isEdit ? t("toast.updated") : t("toast.created"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("titleEdit") : t("titleNew")}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {/* Rule type + source type */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <Field label={t("fields.ruleType")}>
              <Select
                value={ruleType}
                onValueChange={(v) => setRuleType(v as MapRuleType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MAP_min">
                    {t("ruleTypes.MAP_min")}
                  </SelectItem>
                  <SelectItem value="max_price">
                    {t("ruleTypes.max_price")}
                  </SelectItem>
                  <SelectItem value="custom">
                    {t("ruleTypes.custom")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Hint text={t(`ruleTypeHint.${ruleType}`)} />
            </Field>
            <Field label={t("fields.sourceType")}>
              <Select
                value={sourceType}
                onValueChange={(v) => {
                  setSourceType(v as MapRuleSourceType);
                  setSourceId(null);
                  // If we already had a variant chosen for one source kind,
                  // it might not match the new source's brand — easiest is
                  // to clear it and let the user re-pick.
                  setVariantId(null);
                  setVariantLabel(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="brand">
                    {t("sourceTypes.brand")}
                  </SelectItem>
                  <SelectItem value="provider">
                    {t("sourceTypes.provider")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Source picker */}
          <Field label={t(`fields.source.${sourceType}`)}>
            <Select
              value={sourceId !== null ? String(sourceId) : ""}
              onValueChange={(v) => setSourceId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t(`placeholders.source.${sourceType}`)} />
              </SelectTrigger>
              <SelectContent>
                {sourceType === "brand"
                  ? brands.map((b) => (
                      <SelectItem key={b.brand_id} value={String(b.brand_id)}>
                        {b.brand_name}
                      </SelectItem>
                    ))
                  : providers.map((p) => (
                      <SelectItem
                        key={p.provider_id}
                        value={String(p.provider_id)}
                      >
                        {p.provider_name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Applies to */}
          <Field label={t("fields.appliesTo")}>
            <div style={{ display: "flex", gap: 16, paddingTop: 4 }}>
              <RadioRow
                checked={appliesTo === "all"}
                onClick={() => {
                  setAppliesTo("all");
                  setVariantId(null);
                  setVariantLabel(null);
                }}
                label={t("appliesTo.all")}
              />
              <RadioRow
                checked={appliesTo === "specific"}
                onClick={() => setAppliesTo("specific")}
                label={t("appliesTo.specific")}
              />
            </div>
            {appliesTo === "specific" ? (
              <div style={{ marginTop: 8 }}>
                <AsyncVariantPicker
                  value={variantId}
                  valueLabel={variantLabel}
                  onChange={(id, label) => {
                    setVariantId(id);
                    setVariantLabel(label);
                  }}
                  sourceType={sourceType}
                  sourceId={sourceId}
                />
              </div>
            ) : null}
          </Field>

          {/* Prices */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            {showMin ? (
              <Field
                label={t("fields.minPrice")}
                hint={t("fields.minPriceHint")}
              >
                <PriceInput value={minPrice} onChange={setMinPrice} />
              </Field>
            ) : null}
            {showMax ? (
              <Field
                label={t("fields.maxPrice")}
                hint={t("fields.maxPriceHint")}
              >
                <PriceInput value={maxPrice} onChange={setMaxPrice} />
              </Field>
            ) : null}
          </div>

          {/* Validity dates */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <Field label={t("fields.effectiveDate")}>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field
              label={t("fields.expiresAt")}
              hint={t("fields.expiresAtHint")}
            >
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>

          {/* Notes */}
          <Field label={t("fields.notes")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </Field>

          {/* Active toggle (edit only) */}
          {isEdit ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingTop: 4,
              }}
            >
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <span style={{ fontSize: 13, color: "var(--gl-text-secondary)" }}>
                {isActive ? t("active") : t("inactive")}
              </span>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("buttons.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("buttons.saving") : t("buttons.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid var(--gl-border-strong)",
  borderRadius: "var(--gl-radius-md)",
  background: "var(--gl-surface)",
  color: "var(--gl-text)",
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--gl-text-secondary)",
        }}
      >
        {label}
      </span>
      {children}
      {hint ? <Hint text={hint} /> : null}
    </label>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span style={{ fontSize: 11, color: "var(--gl-text-tertiary)" }}>{text}</span>
  );
}

function RadioRow({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 0",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        color: "var(--gl-text)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `2px solid ${
            checked ? "var(--gl-accent)" : "var(--gl-border-strong)"
          }`,
          background: checked ? "var(--gl-accent)" : "transparent",
          boxShadow: checked ? "inset 0 0 0 3px var(--gl-surface)" : "none",
        }}
      />
      {label}
    </button>
  );
}

function PriceInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <span
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 13,
          color: "var(--gl-text-tertiary)",
          pointerEvents: "none",
        }}
      >
        Q
      </span>
      <input
        type="number"
        step="0.01"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, paddingLeft: 28 }}
      />
    </div>
  );
}
