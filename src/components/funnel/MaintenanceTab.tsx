"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { StageMaintenance } from "./maintenance/StageMaintenance";
import { TransitionMaintenance } from "./maintenance/TransitionMaintenance";
import {
  validateFlowStructure,
  type FlowStructureWarning,
} from "@/lib/funnel/validation";
import type {
  FunnelFlow,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

type Props = {
  flow: FunnelFlow;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
};

/**
 * Maintenance tab — Pass 6a wires the shared-table sections (stages and
 * transitions). Pass 6b adds the per-tenant sections: dataset transition
 * values, benchmark sources, friction findings, plus the shared-but-
 * read-only friction point list.
 */
export function MaintenanceTab({ flow, stages, transitions }: Props) {
  const t = useTranslations("funnel.maintenance");

  const warnings = useMemo(
    () => validateFlowStructure({ stages, transitions }),
    [stages, transitions],
  );

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
