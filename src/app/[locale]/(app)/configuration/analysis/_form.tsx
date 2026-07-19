"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HintedInput, HintedSelect } from "@/components/ui/hinted-field";
import { WEEK_DAYS, type AnalysisConfig, type WeekDay } from "@/lib/analytics/analysis-config";
import { updateAnalysisConfig } from "./actions";

/**
 * Per-instance analysis settings. Every number the signal engine judges with
 * is a variable here (design decision 2026-07-19: industries differ). The
 * right quarter of the screen stays free for the agent panel (CLAUDE.md §14).
 */

export interface GoalRowDef {
  key: string;
  label: string;
  isMoney: boolean;
  isRate: boolean;
}

export function AnalysisSettingsForm({
  initialTimezone, initialCurrency, config, goalRows,
}: {
  initialTimezone: string;
  initialCurrency: string;
  config: AnalysisConfig;
  goalRows: GoalRowDef[];
}) {
  const t = useTranslations("configuration.analysis");
  const [pending, startTransition] = useTransition();

  const [timezone, setTimezone] = useState(initialTimezone);
  const [currency, setCurrency] = useState(initialCurrency);
  const [weekEnd, setWeekEnd] = useState<WeekDay>(config.week_end_day);
  const [deltaPct, setDeltaPct] = useState(String(config.delta_threshold_pct));
  const [minDen, setMinDen] = useState(String(config.min_weekly_denominator));
  const [baseline, setBaseline] = useState(String(config.baseline_weeks));
  const [goals, setGoals] = useState<Record<string, { target: string; lower: string }>>(
    Object.fromEntries(goalRows.map((r) => {
      const g = config.metric_goals[r.key];
      const show = (v: number | null | undefined) =>
        v == null ? "" : r.isRate ? String(v * 100) : String(v);
      return [r.key, { target: show(g?.target), lower: show(g?.lower_threshold) }];
    })),
  );

  const setGoal = (key: string, field: "target" | "lower", v: string) =>
    setGoals((g) => ({ ...g, [key]: { ...g[key], [field]: v } }));

  function submit() {
    startTransition(async () => {
      const metric_goals: Record<string, { target?: number | null; lower_threshold?: number | null }> = {};
      for (const r of goalRows) {
        const raw = goals[r.key];
        const parse = (s: string) => {
          const n = Number(s);
          if (s.trim() === "" || !Number.isFinite(n)) return null;
          return r.isRate ? n / 100 : n; // rates entered as %, stored as fractions
        };
        const target = parse(raw.target);
        const lower = parse(raw.lower);
        if (target != null || lower != null) {
          metric_goals[r.key] = { target, lower_threshold: lower };
        }
      }
      const res = await updateAnalysisConfig({
        timezone, currency,
        week_end_day: weekEnd,
        delta_threshold_pct: Number(deltaPct),
        min_weekly_denominator: Number(minDen),
        baseline_weeks: Number(baseline),
        metric_goals,
      });
      if (res.ok) toast.success(t("saved"));
      else toast.error(t(`errors.${res.error ?? "db"}`));
    });
  }

  const num = (id: string, label: string, value: string, set: (v: string) => void, hintKey: string) => (
    <HintedInput
      id={id} label={label} value={value} type="number"
      onChange={(e) => set(e.target.value)}
      hint={{ label, body: t(hintKey) }}
    />
  );

  return (
    <div style={{ maxWidth: 720, display: "grid", gap: 24 }}>
      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("sections.general")}</h2>
        <HintedInput
          id="tz" label={t("fields.timezone")} value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          hint={{ label: t("fields.timezone"), body: t("hints.timezone") }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <HintedSelect
            id="weekEnd" label={t("fields.weekEnd")} value={weekEnd}
            onChange={(e) => setWeekEnd(e.target.value as WeekDay)}
            hint={{ label: t("fields.weekEnd"), body: t("hints.weekEnd") }}
          >
            {WEEK_DAYS.map((d) => (
              <option key={d} value={d}>{t(`days.${d}`)}</option>
            ))}
          </HintedSelect>
          <HintedInput
            id="currency" label={t("fields.currency")} value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            hint={{ label: t("fields.currency"), body: t("hints.currency") }}
          />
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("sections.engine")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {num("deltaPct", t("fields.deltaPct"), deltaPct, setDeltaPct, "hints.deltaPct")}
          {num("minDen", t("fields.minDen"), minDen, setMinDen, "hints.minDen")}
          {num("baseline", t("fields.baseline"), baseline, setBaseline, "hints.baseline")}
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("sections.goals")}</h2>
        <p style={{ fontSize: 13, color: "var(--gl-text-secondary)", margin: 0, maxWidth: "65ch" }}>
          {t("goalsIntro")}
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {goalRows.map((r) => (
            <div key={r.key}
              style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 13.5 }}>
                {r.label}
                <span style={{ color: "var(--gl-text-tertiary)", fontSize: 11.5, marginLeft: 6 }}>
                  {r.isRate ? "%" : r.isMoney ? currency : ""}
                </span>
              </span>
              <HintedInput
                id={`goal-${r.key}-t`} label={t("fields.target")} type="number"
                value={goals[r.key].target}
                onChange={(e) => setGoal(r.key, "target", e.target.value)}
                hint={{ label: `${r.label} — ${t("fields.target")}`, body: t("hints.target") }}
              />
              <HintedInput
                id={`goal-${r.key}-l`} label={t("fields.lower")} type="number"
                value={goals[r.key].lower}
                onChange={(e) => setGoal(r.key, "lower", e.target.value)}
                hint={{ label: `${r.label} — ${t("fields.lower")}`, body: t("hints.lower") }}
              />
            </div>
          ))}
        </div>
      </section>

      <div>
        <button type="button" className="s-btn s-btn-primary" onClick={submit} disabled={pending}>
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}
