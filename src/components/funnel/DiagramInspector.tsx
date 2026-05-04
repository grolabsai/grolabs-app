"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Icon } from "@/components/ui/icon";
import { resolveStageIcon } from "@/lib/funnel/stageIcons";
import { revenueFromStage } from "@/lib/funnel/revenue";
import type {
  ComputedModel,
  FunnelDataset,
  FunnelDatasetTransitionValue,
  FunnelFrictionFinding,
  FunnelFrictionPoint,
  FunnelInstance,
  FunnelSourceType,
  FunnelStage,
} from "@/lib/funnel/types";

type Props = {
  activeStageSlug: string | null;
  instance: FunnelInstance;
  dataset: FunnelDataset | null;
  stages: FunnelStage[];
  values: FunnelDatasetTransitionValue[];
  model: ComputedModel;
  frictionPoints: FunnelFrictionPoint[];
  frictionFindings: FunnelFrictionFinding[];
  monthlyTraffic: number;
  averageOrderValue: number;
  averageCartSkus: number;
  onMonthlyTrafficChange: (n: number) => void;
  onAverageOrderValueChange: (n: number) => void;
  onAverageCartSkusChange: (n: number) => void;
};

const SOURCE_TYPE_BADGE_TONE: Record<FunnelSourceType, string> = {
  benchmark: "bg-amber-50 text-amber-700",
  customer_actual: "bg-blue-50 text-blue-700",
  manual_estimate: "bg-slate-100 text-slate-600",
  api_extraction: "bg-emerald-50 text-emerald-700",
};

const SEVERITY_TONE: Record<
  FunnelFrictionFinding["severity"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  critical: "destructive",
};

export function DiagramInspector({
  activeStageSlug,
  instance,
  dataset,
  stages,
  values,
  model,
  frictionPoints,
  frictionFindings,
  monthlyTraffic,
  averageOrderValue,
  averageCartSkus,
  onMonthlyTrafficChange,
  onAverageOrderValueChange,
  onAverageCartSkusChange,
}: Props) {
  const t = useTranslations("funnel.inspector");
  const tInputs = useTranslations("funnel.inputs");
  const tBadges = useTranslations("funnel.badges");
  const tSeverity = useTranslations("funnel.severity");

  const activeStage = activeStageSlug
    ? stages.find((s) => s.slug === activeStageSlug) ?? null
    : null;

  // ─── Empty state — no stage selected ──────────────────────────────────────
  if (!activeStage) {
    const finalConversion = (model.reach["purchase"] ?? 0).toFixed(2);
    return (
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("summaryInstance")}
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              {instance.name}
            </div>
            {instance.industry ? (
              <div className="mt-1 text-xs text-slate-500">{instance.industry}</div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("summaryDataset")}
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              {dataset?.name ?? "—"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t("summarySelectStage")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("summaryFinalConversion")}
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-700 tabular-nums">
              {finalConversion}%
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Active stage state ───────────────────────────────────────────────────
  const StageIcon = resolveStageIcon(activeStage.icon_key);
  const sourceTypeByTransitionId = new Map(
    values.map((v) => [v.funnel_transition_id, v.source_type]),
  );
  const stageBySlug = new Map(stages.map((s) => [s.slug, s]));

  const incoming = model.edges.filter((e) => e.target_slug === activeStage.slug);
  const outgoing = model.edges.filter(
    (e) => e.source_slug === activeStage.slug && e.target_slug !== "drop",
  );
  const losses = model.edges.filter(
    (e) => e.source_slug === activeStage.slug && e.target_slug === "drop",
  );

  const stats = revenueFromStage({
    stageSlug: activeStage.slug,
    model,
    monthlyTraffic,
    averageOrderValue,
    averageCartSkus,
  });

  const outputRows = [...outgoing, ...losses].map((edge) => ({
    edge,
    targetStage: stageBySlug.get(edge.target_slug),
    qty: Math.round((edge.pct_total / 100) * monthlyTraffic),
    isDrop: edge.target_slug === "drop",
  }));

  const relatedFps = frictionPoints.filter(
    (fp) => fp.funnel_stage_id === activeStage.funnel_stage_id,
  );
  const relatedFpIds = new Set(relatedFps.map((fp) => fp.funnel_friction_point_id));
  const relatedFindings = frictionFindings.filter((ff) =>
    relatedFpIds.has(ff.funnel_friction_point_id),
  );

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      {/* ─── Card 1: Output from stage ──────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {t("outputFromStage")}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-base font-bold text-slate-900">
                <Icon icon={StageIcon} size={16} />
                {activeStage.label}
              </div>
            </div>
            <Badge variant={activeStage.is_dropoff ? "destructive" : "secondary"}>
              {(model.reach[activeStage.slug] ?? 0).toFixed(1)}%
            </Badge>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <FloatingLabelInput
              id="funnel-mt"
              label={tInputs("monthlyTraffic")}
              type="number"
              min={0}
              value={monthlyTraffic}
              onChange={(e) => onMonthlyTrafficChange(Number(e.target.value) || 0)}
            />
            <FloatingLabelInput
              id="funnel-aov"
              label={tInputs("averageOrderValue")}
              type="number"
              min={0}
              value={averageOrderValue}
              onChange={(e) => onAverageOrderValueChange(Number(e.target.value) || 0)}
            />
            <FloatingLabelInput
              id="funnel-acs"
              label={tInputs("averageCartSkus")}
              type="number"
              min={0}
              step="0.1"
              value={averageCartSkus}
              onChange={(e) => onAverageCartSkusChange(Number(e.target.value) || 0)}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                {t("convertsOnward")}
              </div>
              <div className="mt-1 text-base font-bold text-emerald-900 tabular-nums">
                {stats.convertsPct.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-emerald-900 tabular-nums">
                {t("users", { count: stats.convertedOrders })} · ${stats.revenue.toLocaleString()}
              </div>
              <div className="text-xs text-emerald-900 tabular-nums">
                {t("skuItems", { count: stats.estimatedSkuItemsPurchased })}
              </div>
            </div>
            <div className="rounded-xl bg-red-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700">
                {t("lostOnward")}
              </div>
              <div className="mt-1 text-base font-bold text-red-900 tabular-nums">
                {stats.lostPct.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-red-900 tabular-nums">
                {t("users", { count: stats.lostOrders })} · ${stats.lostRevenue.toLocaleString()}
              </div>
              <div className="text-xs text-red-900 tabular-nums">
                {t("skuItems", { count: stats.estimatedSkuItemsLost })}
              </div>
            </div>
          </div>

          {outputRows.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{t("destination")}</th>
                    <th className="px-3 py-2 text-right">{t("percentage")}</th>
                    <th className="px-3 py-2 text-right">{t("quantity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {outputRows.map((row) => {
                    const TargetIcon = resolveStageIcon(row.targetStage?.icon_key ?? null);
                    return (
                      <tr
                        key={row.edge.slug}
                        className={
                          row.isDrop
                            ? "bg-red-50 text-red-800"
                            : "border-t border-slate-100"
                        }
                      >
                        <td className="px-3 py-2 font-medium">
                          <span className="mr-1.5 inline-flex align-middle">
                            <Icon icon={TargetIcon} size={14} />
                          </span>
                          {row.targetStage?.label ?? row.edge.target_slug}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">
                          {row.edge.conversion_pct.toFixed(0)}%
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.qty.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Card 2: Incoming transitions ─────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">
            {t("incomingTransitions")}
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {incoming.length === 0 ? (
              <div className="text-slate-400">{t("noIncoming")}</div>
            ) : (
              incoming.map((edge) => {
                const sourceStage = stageBySlug.get(edge.source_slug);
                const SourceIcon = resolveStageIcon(sourceStage?.icon_key ?? null);
                const qty = Math.round((edge.pct_total / 100) * monthlyTraffic);
                const sourceType =
                  sourceTypeByTransitionId.get(edge.funnel_transition_id) ??
                  ("manual_estimate" as FunnelSourceType);
                return (
                  <div
                    key={edge.slug}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Icon icon={SourceIcon} size={14} />
                        <span className="font-medium text-slate-800">
                          {sourceStage?.label ?? edge.source_slug}
                        </span>
                        <span className="text-slate-500">→</span>
                        <span className="font-bold text-slate-900 tabular-nums">
                          {edge.conversion_pct.toFixed(0)}%
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          · {qty.toLocaleString()}
                        </span>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          SOURCE_TYPE_BADGE_TONE[sourceType] ??
                          "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {tBadges(sourceType)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Card 3: Friction findings ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("frictionFindings")}
            </div>
            <Badge variant="secondary">
              {t("findingsCount", { count: relatedFindings.length })}
            </Badge>
          </div>
          {relatedFps.length === 0 ? (
            <div className="mt-3 text-sm text-slate-400">{t("noFindings")}</div>
          ) : (
            <div className="mt-3 space-y-2">
              {relatedFps.map((fp) => {
                const fpFindings = relatedFindings.filter(
                  (ff) => ff.funnel_friction_point_id === fp.funnel_friction_point_id,
                );
                return (
                  <div
                    key={fp.funnel_friction_point_id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="text-sm font-bold text-slate-900">{fp.name}</div>
                    {fp.description ? (
                      <p className="mt-0.5 text-xs text-slate-600">{fp.description}</p>
                    ) : null}
                    {fpFindings.map((finding) => (
                      <div
                        key={finding.funnel_friction_finding_id}
                        className="mt-2 rounded-lg bg-white p-2 text-xs text-slate-700"
                      >
                        <div className="flex items-center gap-1">
                          <Badge variant={SEVERITY_TONE[finding.severity]}>
                            {tSeverity(finding.severity)}
                          </Badge>
                          {finding.source_system ? (
                            <span className="text-[10px] text-slate-500">
                              · {finding.source_system}
                            </span>
                          ) : null}
                          {finding.observed_at ? (
                            <span className="text-[10px] text-slate-400">
                              · {finding.observed_at}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-slate-700">{finding.evidence}</p>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
