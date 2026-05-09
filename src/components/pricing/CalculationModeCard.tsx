"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  savePricingConfig,
  type PricingConfig,
} from "@/lib/actions/pricing";
import { targetPriceFromCost } from "@/lib/pricing/calculate";

/**
 * The pricing-mode card sits at the very top of /pricing/policies. The
 * user picks margin vs markup, sees the formulas for each, sees a worked
 * example with their own default percentage, and sets the defaults that
 * new categories will inherit.
 *
 * One source of truth — anywhere else in the app that renders a margin
 * percentage echoes the current mode but doesn't let the user change it.
 */
export function CalculationModeCard({
  initial,
}: {
  initial: PricingConfig;
}) {
  const t = useTranslations("pricing.calculationMode");
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();

  const [mode, setMode] = useState<PricingConfig["calculation_mode"]>(
    initial.calculation_mode,
  );
  const [target, setTarget] = useState<string>(
    initial.default_target_pct.toString(),
  );
  const [min, setMin] = useState<string>(initial.default_min_pct.toString());

  // Worked example uses Q 100 cost + the user's current target percentage
  // so they can see the price they'd get for both modes.
  const targetNum = Number.parseFloat(target);
  const exampleCost = 100;
  const examplePriceMargin = useMemo(
    () => targetPriceFromCost(exampleCost, targetNum, "margin"),
    [targetNum],
  );
  const examplePriceMarkup = useMemo(
    () => targetPriceFromCost(exampleCost, targetNum, "markup"),
    [targetNum],
  );

  const dirty =
    mode !== initial.calculation_mode ||
    Number.parseFloat(target) !== initial.default_target_pct ||
    Number.parseFloat(min) !== initial.default_min_pct;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t1 = Number.parseFloat(target);
    const t2 = Number.parseFloat(min);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
      toast.error(t("toastInvalidNumber"));
      return;
    }
    if (t2 > t1) {
      toast.error(t("toastMinAboveTarget"));
      return;
    }
    startSubmit(async () => {
      // Pass through the keys this card doesn't own so a save here can't
      // accidentally wipe settings managed by sibling cards on the page.
      const res = await savePricingConfig({
        calculation_mode: mode,
        default_target_pct: t1,
        default_min_pct: t2,
        max_price_change_enabled: initial.max_price_change_enabled,
        max_price_change_pct: initial.max_price_change_pct,
      });
      if (!res.ok) {
        toast.error(t("toastSaveError"), { description: res.error });
        return;
      }
      toast.success(t("toastSaved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="pricing-section" style={{ marginBottom: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--s-text)",
            marginBottom: 4,
          }}
        >
          {t("title")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
          {t("subtitle")}
        </p>
      </header>

      {/* Mode radios */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <ModeOption
          label={t("modes.margin.label")}
          description={t("modes.margin.description")}
          formulaPrice={t("modes.margin.formulaPrice")}
          formulaPct={t("modes.margin.formulaPct")}
          checked={mode === "margin"}
          onClick={() => setMode("margin")}
        />
        <ModeOption
          label={t("modes.markup.label")}
          description={t("modes.markup.description")}
          formulaPrice={t("modes.markup.formulaPrice")}
          formulaPct={t("modes.markup.formulaPct")}
          checked={mode === "markup"}
          onClick={() => setMode("markup")}
        />
      </div>

      {/* Worked example */}
      <div
        style={{
          background: "var(--s-surface-alt)",
          borderRadius: "var(--s-radius-md)",
          padding: 16,
          marginBottom: 24,
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--s-text-tertiary)",
            marginBottom: 8,
          }}
        >
          {t("example.heading", {
            cost: exampleCost.toFixed(2),
            pct: Number.isFinite(targetNum) ? targetNum.toFixed(1) : "?",
          })}
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            fontSize: 13,
            color: "var(--s-text)",
          }}
        >
          <ExampleLine
            label={t("modes.margin.label")}
            price={examplePriceMargin}
            highlighted={mode === "margin"}
          />
          <ExampleLine
            label={t("modes.markup.label")}
            price={examplePriceMarkup}
            highlighted={mode === "markup"}
          />
        </div>
      </div>

      {/* Defaults */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Field
          label={t("defaults.target")}
          hint={t("defaults.targetHint")}
        >
          <PercentInput value={target} onChange={setTarget} />
        </Field>
        <Field
          label={t("defaults.min")}
          hint={t("defaults.minHint")}
        >
          <PercentInput value={min} onChange={setMin} />
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="submit" disabled={!dirty || submitting}>
          {submitting ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

function ModeOption({
  label,
  description,
  formulaPrice,
  formulaPct,
  checked,
  onClick,
}: {
  label: string;
  description: string;
  formulaPrice: string;
  formulaPct: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      style={{
        textAlign: "left",
        background: checked ? "var(--scout-accent-50)" : "var(--s-surface)",
        border: `2px solid ${
          checked ? "var(--scout-accent)" : "var(--s-border)"
        }`,
        borderRadius: "var(--s-radius-md)",
        padding: 16,
        cursor: "pointer",
        transition: "all 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <RadioDot checked={checked} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--s-text)",
          }}
        >
          {label}
        </span>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--s-text-tertiary)",
          marginBottom: 10,
        }}
      >
        {description}
      </p>
      <div
        style={{
          fontFamily: "var(--s-font-mono)",
          fontSize: 12,
          color: "var(--s-text-secondary)",
          lineHeight: 1.7,
        }}
      >
        <div>{formulaPrice}</div>
        <div>{formulaPct}</div>
      </div>
    </button>
  );
}

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: `2px solid ${checked ? "var(--scout-accent)" : "var(--s-border-strong)"}`,
        background: checked ? "var(--scout-accent)" : "transparent",
        boxShadow: checked
          ? "inset 0 0 0 3px var(--s-surface)"
          : "none",
        flexShrink: 0,
      }}
    />
  );
}

function ExampleLine({
  label,
  price,
  highlighted,
}: {
  label: string;
  price: number;
  highlighted: boolean;
}) {
  const display = !Number.isFinite(price) ? "∞" : `Q ${price.toFixed(2)}`;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        opacity: highlighted ? 1 : 0.55,
        fontWeight: highlighted ? 600 : 400,
      }}
    >
      <span style={{ color: "var(--s-text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--s-text)" }}>{display}</span>
    </div>
  );
}

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
          color: "var(--s-text-secondary)",
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function PercentInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 28px 8px 12px",
          fontSize: 14,
          border: "1px solid var(--s-border-strong)",
          borderRadius: "var(--s-radius-md)",
          background: "var(--s-surface)",
          color: "var(--s-text)",
        }}
      />
      <span
        style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 13,
          color: "var(--s-text-tertiary)",
          pointerEvents: "none",
        }}
      >
        %
      </span>
    </div>
  );
}
