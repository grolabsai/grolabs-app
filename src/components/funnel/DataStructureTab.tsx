"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeModel } from "@/lib/funnel/computeModel";
import type {
  FunnelDataset,
  FunnelDatasetTransitionValue,
  FunnelFlow,
  FunnelFrictionFinding,
  FunnelFrictionPoint,
  FunnelInstance,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

type Props = {
  instance: FunnelInstance;
  flow: FunnelFlow;
  dataset: FunnelDataset | null;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
  frictionPoints: FunnelFrictionPoint[];
  frictionFindings: FunnelFrictionFinding[];
};

/**
 * Read-only view of the funnel's structural data: a header row of four
 * summary cards plus two tables (stages with reach, transitions with
 * conversion + total). Editing happens on the maintenance tab.
 */
export function DataStructureTab({
  instance,
  flow,
  dataset,
  stages,
  transitions,
  values,
  frictionPoints,
  frictionFindings,
}: Props) {
  const t = useTranslations("funnel.dataStructure");
  const tType = useTranslations("funnel.instanceTypes");

  const model = useMemo(
    () => computeModel({ stages, transitions, values }),
    [stages, transitions, values],
  );

  const stagesById = new Map(stages.map((s) => [s.funnel_stage_id, s]));
  const stageReachBySlug = model.reach;

  return (
    <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ─── Summary row ───────────────────────────────────────────────── */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
      >
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("instance")}
            </div>
            <div className="mt-1 text-base font-bold text-slate-900">
              {instance.name}
            </div>
            <div className="text-xs text-slate-500">
              {tType(instance.funnel_instance_type)}
              {instance.industry ? ` · ${instance.industry}` : ""}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("flow")}
            </div>
            <div className="mt-1 text-base font-bold text-slate-900">
              {flow.name}
            </div>
            <div className="text-xs text-slate-500">
              {t("flowMeta", {
                stages: stages.length,
                transitions: transitions.length,
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("dataset")}
            </div>
            <div className="mt-1 text-base font-bold text-slate-900">
              {dataset?.name ?? t("noDataset")}
            </div>
            <div className="text-xs text-slate-500">
              {t("datasetMeta", { count: values.length })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("frictionModel")}
            </div>
            <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
              {frictionPoints.length}
            </div>
            <div className="text-xs text-slate-500">
              {t("frictionMeta", {
                points: frictionPoints.length,
                findings: frictionFindings.length,
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Stages + Transitions tables ──────────────────────────────── */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)" }}
      >
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 text-sm font-bold text-slate-900">
              {t("stages")}
            </div>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("stageId")}
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("stageLabel")}
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("stageReach")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stages.map((stage) => (
                    <TableRow key={stage.funnel_stage_id}>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {stage.slug}
                      </TableCell>
                      <TableCell>{stage.label}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {(stageReachBySlug[stage.slug] ?? 0).toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-3 text-sm font-bold text-slate-900">
              {t("transitions")}
            </div>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("transition")}
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("transitionType")}
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("conversion")}
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("total")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.edges.map((edge) => {
                    const sourceStage = stagesById.get(edge.source_stage_id);
                    const targetStage = stagesById.get(edge.target_stage_id);
                    const tone =
                      edge.transition_type === "dropoff"
                        ? "destructive"
                        : edge.transition_type === "backward"
                          ? "outline"
                          : "secondary";
                    return (
                      <TableRow key={edge.funnel_transition_id}>
                        <TableCell className="font-mono text-xs">
                          <span className="text-slate-700">
                            {sourceStage?.label ?? edge.source_slug}
                          </span>
                          <span className="mx-1 text-slate-400">→</span>
                          <span className="text-slate-700">
                            {targetStage?.label ?? edge.target_slug}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={tone}>{edge.transition_type}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {edge.conversion_pct.toFixed(0)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {edge.pct_total.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
