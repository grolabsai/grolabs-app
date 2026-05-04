"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { resolveStageIcon } from "@/lib/funnel/stageIcons";
import { NODE_HEIGHT, NODE_WIDTH, portTop } from "@/lib/funnel/edgeRouting";
import type { ComputedEdge } from "@/lib/funnel/types";

export type FunnelNodeData = {
  slug: string;
  label: string;
  color: string | null;
  iconKey: string | null;
  isDrop: boolean;
  ports: {
    incoming: ComputedEdge[];
    outgoing: ComputedEdge[];
    dropOutgoing: ComputedEdge[];
  };
  pct: number;
  focused: boolean;
  connected: boolean;
  dimmed: boolean;
};

export type FunnelNodeType = Node<FunnelNodeData, "funnelNode">;

export function FunnelNode({ data }: NodeProps<FunnelNodeType>) {
  const t = useTranslations("funnel.node");
  const StageIcon = resolveStageIcon(data.iconKey);
  const accentColor = data.color ?? "#94a3b8";

  const borderClass = data.focused
    ? "border-slate-900 scale-[1.03]"
    : data.connected
      ? "border-slate-400"
      : "border-slate-200";

  const opacityClass = data.dimmed && !data.focused ? "opacity-25" : "";
  const totalOutputs =
    data.ports.outgoing.length + data.ports.dropOutgoing.length;

  return (
    <div
      className={`relative rounded-2xl border bg-white shadow-md transition-all ${borderClass} ${opacityClass}`}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      {/* Accent strip on the left edge — uses the stage's color from DB */}
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full rounded-l-2xl"
        style={{ width: 8, background: accentColor }}
      />

      {/* Incoming port handles, distributed along the left face */}
      {data.ports.incoming.map((edge, i) => (
        <Handle
          key={`in-${edge.slug}`}
          id={`in-${edge.slug}`}
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !bg-slate-400 !border-0"
          style={{ top: portTop(i, data.ports.incoming.length) }}
        />
      ))}

      {/* Outgoing port handles, distributed along the right face */}
      {data.ports.outgoing.map((edge, i) => (
        <Handle
          key={`out-${edge.slug}`}
          id={`out-${edge.slug}`}
          type="source"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !bg-slate-500 !border-0"
          style={{ top: portTop(i, data.ports.outgoing.length) }}
        />
      ))}

      {/* Drop outputs leave from the bottom face */}
      {data.ports.dropOutgoing.map((edge, i) => (
        <Handle
          key={`drop-${edge.slug}`}
          id={`drop-${edge.slug}`}
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !bg-red-600 !border-0"
          style={{ left: portTop(i, data.ports.dropOutgoing.length) }}
        />
      ))}

      {/* The drop node has a single absorbing target on its left face */}
      {data.isDrop && (
        <Handle
          id="drop-target"
          type="target"
          position={Position.Left}
          className="!h-4 !w-4 !bg-red-600 !border-0"
        />
      )}

      <div className="px-4 pl-5 py-3">
        <div className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-900">
          <Icon icon={StageIcon} size={16} />
          <span className="truncate">{data.label}</span>
        </div>
        <div className="mt-1 text-xs font-semibold text-slate-500 tabular-nums">
          {t("percentOfTotal", { pct: data.pct.toFixed(1) })}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          {data.isDrop
            ? t("lossCollector")
            : t("outputs", { count: totalOutputs })}
        </div>
      </div>
    </div>
  );
}
