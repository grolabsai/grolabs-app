"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FunnelCanvas } from "./FunnelCanvas";
import { DiagramInspector } from "./DiagramInspector";
import { computeModel } from "@/lib/funnel/computeModel";
import type {
  FunnelDataset,
  FunnelDatasetTransitionValue,
  FunnelFrictionFinding,
  FunnelFrictionPoint,
  FunnelInstance,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

type Props = {
  instance: FunnelInstance;
  dataset: FunnelDataset | null;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
  frictionPoints: FunnelFrictionPoint[];
  frictionFindings: FunnelFrictionFinding[];
};

/**
 * Diagram tab — owns the highlight state and the what-if inputs so the
 * inspector and the canvas stay in sync. What-if inputs are local-only
 * by design (per spec §"Scenario revenue from selected stage" — the
 * selected stage drives the projection without writing back to the DB).
 */
export function DiagramTab({
  instance,
  dataset,
  stages,
  transitions,
  values,
  frictionPoints,
  frictionFindings,
}: Props) {
  const tControls = useTranslations("funnel.controls");

  const [activeStageSlug, setActiveStageSlug] = useState<string | null>(null);
  const [activeEdgeSlug, setActiveEdgeSlug] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [monthlyTraffic, setMonthlyTraffic] = useState(instance.monthly_traffic);
  const [averageOrderValue, setAverageOrderValue] = useState(
    instance.average_order_value,
  );
  const [averageCartSkus, setAverageCartSkus] = useState(
    instance.average_cart_skus,
  );

  const model = useMemo(
    () => computeModel({ stages, transitions, values }),
    [stages, transitions, values],
  );

  const handleClear = () => {
    setActiveStageSlug(null);
    setActiveEdgeSlug(null);
  };

  return (
    <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Button
          type="button"
          variant={showLabels ? "default" : "outline"}
          size="sm"
          onClick={() => setShowLabels((v) => !v)}
        >
          {showLabels ? tControls("hideLabels") : tControls("showLabels")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={!activeStageSlug && !activeEdgeSlug}
        >
          {tControls("clear")}
        </Button>
      </div>

      <div
        style={{
          height: 640,
          width: "100%",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          overflow: "hidden",
          background: "white",
        }}
      >
        <FunnelCanvas
          stages={stages}
          model={model}
          activeStageSlug={activeStageSlug}
          activeEdgeSlug={activeEdgeSlug}
          onActiveStageChange={setActiveStageSlug}
          onActiveEdgeChange={setActiveEdgeSlug}
          showLabels={showLabels}
        />
      </div>

      <DiagramInspector
        activeStageSlug={activeStageSlug}
        instance={instance}
        dataset={dataset}
        stages={stages}
        values={values}
        model={model}
        frictionPoints={frictionPoints}
        frictionFindings={frictionFindings}
        monthlyTraffic={monthlyTraffic}
        averageOrderValue={averageOrderValue}
        averageCartSkus={averageCartSkus}
        onMonthlyTrafficChange={setMonthlyTraffic}
        onAverageOrderValueChange={setAverageOrderValue}
        onAverageCartSkusChange={setAverageCartSkus}
      />
    </div>
  );
}
