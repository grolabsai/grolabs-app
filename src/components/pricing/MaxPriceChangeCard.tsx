"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  savePricingConfig,
  type PricingConfig,
} from "@/lib/actions/pricing";

/**
 * Fourth and last card on /pricing/policies. Configures the threshold the
 * worksheet uses to flag rows whose new price differs from the variant's
 * current selling price by more than X%. Symmetric — both increases and
 * decreases trigger the warning, since either direction is worth a sanity
 * check before sync.
 *
 * Saves through the shared savePricingConfig: this card passes through
 * the keys owned by other cards (calculation_mode + defaults) so a write
 * here can't wipe the mode card's state.
 */
export function MaxPriceChangeCard({ initial }: { initial: PricingConfig }) {
  const t = useTranslations("pricing.maxPriceChange");
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();

  const [enabled, setEnabled] = useState(initial.max_price_change_enabled);
  const [pct, setPct] = useState<string>(initial.max_price_change_pct.toString());

  const pctNum = Number.parseFloat(pct);

  // Worked example: a hypothetical current price of Q 100 and a small set
  // of candidate new prices that bracket the threshold so the user can see
  // exactly which would trigger the warning.
  const examples = useMemo(() => {
    const current = 100;
    const threshold = Number.isFinite(pctNum) ? pctNum : 0;
    const newPrices = [
      current * (1 + threshold * 1.5 / 100),
      current * (1 + threshold * 0.5 / 100),
      current * (1 - threshold * 1.5 / 100),
    ];
    return newPrices.map((newPrice) => {
      const changePct = ((newPrice - current) / current) * 100;
      const triggers = enabled && Math.abs(changePct) >= threshold;
      return {
        current,
        newPrice,
        changePct,
        triggers,
      };
    });
  }, [pctNum, enabled]);

  const dirty =
    enabled !== initial.max_price_change_enabled ||
    pctNum !== initial.max_price_change_pct;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(pctNum) || pctNum < 0) {
      toast.error(t("toastInvalidPct"));
      return;
    }
    startSubmit(async () => {
      const res = await savePricingConfig({
        calculation_mode: initial.calculation_mode,
        default_target_pct: initial.default_target_pct,
        default_min_pct: initial.default_min_pct,
        max_price_change_enabled: enabled,
        max_price_change_pct: pctNum,
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
            color: "var(--gl-text)",
            marginBottom: 4,
          }}
        >
          {t("title")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--gl-text-tertiary)" }}>
          {t("subtitle")}
        </p>
      </header>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <span style={{ fontSize: 14, color: "var(--gl-text)" }}>
          {t("toggle")}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr",
          gap: 16,
          alignItems: "start",
          opacity: enabled ? 1 : 0.55,
          transition: "opacity 0.12s",
          marginBottom: 20,
        }}
      >
        <Field
          label={t("threshold")}
          hint={t("thresholdHint")}
        >
          <PercentInput
            value={pct}
            onChange={setPct}
            disabled={!enabled}
          />
        </Field>

        <div
          style={{
            background: "var(--gl-surface-alt)",
            borderRadius: "var(--gl-radius-md)",
            padding: 14,
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--gl-text-tertiary)",
              marginBottom: 10,
            }}
          >
            {t("example.heading", {
              current: examples[0]?.current.toFixed(2) ?? "0.00",
              pct: Number.isFinite(pctNum) ? pctNum.toFixed(1) : "?",
            })}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {examples.map((ex, i) => (
              <ExampleRow key={i} {...ex} />
            ))}
          </div>
        </div>
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

function ExampleRow({
  current,
  newPrice,
  changePct,
  triggers,
}: {
  current: number;
  newPrice: number;
  changePct: number;
  triggers: boolean;
}) {
  const t = useTranslations("pricing.maxPriceChange");
  const sign = changePct >= 0 ? "+" : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 13,
      }}
    >
      <span
        style={{
          fontFamily: "var(--gl-font-mono)",
          color: "var(--gl-text)",
        }}
      >
        Q {current.toFixed(2)} → Q {newPrice.toFixed(2)} ({sign}
        {changePct.toFixed(1)}%)
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          padding: "2px 8px",
          borderRadius: 999,
          background: triggers ? "#FFF7ED" : "var(--gl-success-bg)",
          color: triggers ? "#B45309" : "var(--gl-success-text)",
        }}
      >
        {triggers ? t("badges.warning") : t("badges.ok")}
      </span>
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
          color: "var(--gl-text-secondary)",
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ fontSize: 11, color: "var(--gl-text-tertiary)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function PercentInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
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
        disabled={disabled}
        style={{
          width: "100%",
          padding: "8px 28px 8px 12px",
          fontSize: 14,
          border: "1px solid var(--gl-border-strong)",
          borderRadius: "var(--gl-radius-md)",
          background: "var(--gl-surface)",
          color: "var(--gl-text)",
        }}
      />
      <span
        style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 13,
          color: "var(--gl-text-tertiary)",
          pointerEvents: "none",
        }}
      >
        %
      </span>
    </div>
  );
}
