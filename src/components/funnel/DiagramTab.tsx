"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FunnelCanvas } from "./FunnelCanvas";
import type {
  FunnelDatasetTransitionValue,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

type Props = {
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
};

/**
 * Diagram tab — Pass 3 shape: a toolbar (showLabels toggle) above the
 * ReactFlow canvas. Pass 4 adds the DiagramInspector below the canvas
 * with what-if inputs (monthly traffic, AOV, average cart SKUs) and the
 * three inspector cards (output / incoming / friction).
 */
export function DiagramTab({ stages, transitions, values }: Props) {
  const t = useTranslations("funnel.controls");
  const [showLabels, setShowLabels] = useState(false);

  return (
    <div style={{ paddingTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Button
          type="button"
          variant={showLabels ? "default" : "outline"}
          size="sm"
          onClick={() => setShowLabels((v) => !v)}
        >
          {showLabels ? t("hideLabels") : t("showLabels")}
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
          transitions={transitions}
          values={values}
          showLabels={showLabels}
        />
      </div>
    </div>
  );
}
