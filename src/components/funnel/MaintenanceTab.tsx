"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { StageMaintenance } from "./maintenance/StageMaintenance";
import { TransitionMaintenance } from "./maintenance/TransitionMaintenance";
import { DatasetValuesMaintenance } from "./maintenance/DatasetValuesMaintenance";
import { BenchmarkSourceMaintenance } from "./maintenance/BenchmarkSourceMaintenance";
import { FrictionPointSection } from "./maintenance/FrictionPointSection";
import { FrictionFindingMaintenance } from "./maintenance/FrictionFindingMaintenance";
import {
  validateFlowStructure,
  type FlowStructureWarning,
} from "@/lib/funnel/validation";
import type {
  FunnelBenchmarkSource,
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
  benchmarks: FunnelBenchmarkSource[];
  frictionPoints: FunnelFrictionPoint[];
  frictionFindings: FunnelFrictionFinding[];
};

/**
 * Maintenance tab — composes:
 *   - Flow validation panel (validateFlowStructure)
 *   - Stage CRUD (shared, service-role)
 *   - Transition CRUD (shared, service-role)
 *   - Dataset transition values CRUD (per-tenant)
 *   - Benchmark source CRUD (per-tenant)
 *   - Friction point read-only list (shared, platform-managed note)
 *   - Friction finding CRUD (per-tenant; locked when on a template
 *     because RLS denies writes for instance_id = 0).
 */
export function MaintenanceTab({
  instance,
  flow,
  dataset,
  stages,
  transitions,
  values,
  benchmarks,
  frictionPoints,
  frictionFindings,
}: Props) {
  const t = useTranslations("funnel.maintenance");

  const warnings = useMemo(
    () => validateFlowStructure({ stages, transitions }),
    [stages, transitions],
  );

  const isTemplate = instance.instance_id === 0;

  return (
    <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h2 className="text-base font-bold text-slate-900">{t("title")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("description")}</p>
      </header>

      <FlowWarningsPanel warnings={warnings} />

      <StageMaintenance funnelFlowId={flow.funnel_flow_id} stages={stages} />

      <TransitionMaintenance
        funnelFlowId={flow.funnel_flow_id}
        stages={stages}
        transitions={transitions}
      />

      <DatasetValuesMaintenance
        dataset={dataset}
        stages={stages}
        transitions={transitions}
        values={values}
      />

      <BenchmarkSourceMaintenance
        benchmarks={benchmarks}
        values={values}
        transitions={transitions}
        stages={stages}
        readOnly={isTemplate}
      />

      <FrictionPointSection
        frictionPoints={frictionPoints}
        stages={stages}
      />

      <FrictionFindingMaintenance
        funnelInstanceId={instance.funnel_instance_id}
        frictionPoints={frictionPoints}
        frictionFindings={frictionFindings}
        readOnly={isTemplate}
      />
    </div>
  );
}

function FlowWarningsPanel({ warnings }: { warnings: FlowStructureWarning[] }) {
  const t = useTranslations("funnel.maintenance.flowWarnings");

  if (warnings.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            {t("title")}
          </div>
          <p className="mt-1 text-sm text-emerald-900">{t("healthy")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          {t("title")}
        </div>
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-900 space-y-1">
          {warnings.map((w, i) => (
            <li key={i}>
              {w.kind === "missingRequiredStage"
                ? t("missingStage", { slug: w.slug })
                : w.kind === "transitionSourceMissing"
                  ? t("transitionSourceMissing", { slug: w.transition_slug })
                  : t("transitionTargetMissing", { slug: w.transition_slug })}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
