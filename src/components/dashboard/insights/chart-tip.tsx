"use client";

/**
 * Shared hover/focus tooltip layer for the interactive dashboard charts
 * (Signals + Overview). Content (ChartTip) is prebuilt on the server so i18n
 * and number formatting never cross into the client; this layer only positions
 * and displays. Keyboard focus shows the same tooltip as hover.
 */

import { useRef, useState, type PointerEvent, type FocusEvent, type ReactNode } from "react";
import type { ChartTip } from "./signal-chart-util";

interface TipState {
  x: number;
  y: number;
  flip: boolean;
  tip: ChartTip;
}

export function useChartTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tt, setTt] = useState<TipState | null>(null);

  const showAt = (clientX: number, clientY: number, tip: ChartTip) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = clientX - r.left;
    setTt({ x, y: clientY - r.top, flip: x > r.width * 0.62, tip });
  };
  const show = (e: PointerEvent, tip: ChartTip) => showAt(e.clientX, e.clientY, tip);
  const showFocus = (e: FocusEvent<SVGElement>, tip: ChartTip) => {
    const b = (e.target as SVGGraphicsElement).getBoundingClientRect();
    showAt(b.left + b.width / 2, b.top, tip);
  };
  const hide = () => setTt(null);

  const wrap = (children: ReactNode) => (
    <div ref={ref} style={{ position: "relative" }}>
      {children}
      {tt ? (
        <div
          className="sig-tt"
          style={{
            left: tt.x + (tt.flip ? -12 : 12),
            top: Math.max(tt.y - 10, 0),
            transform: tt.flip ? "translateX(-100%)" : undefined,
          }}
        >
          <div className="t">{tt.tip.title}</div>
          {tt.tip.rows.map((r, i) => (
            <div className="r" key={i}>
              <span className="n">{r.k}</span>
              <span className="v">{r.v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return { show, showFocus, hide, wrap };
}

/** Invisible, generously-sized hit target over a point mark. */
export function Hit({
  x, y, r = 13, tip, api,
}: {
  x: number;
  y: number;
  r?: number;
  tip: ChartTip;
  api: ReturnType<typeof useChartTip>;
}) {
  return (
    <circle
      cx={x} cy={y} r={r} fill="transparent" tabIndex={0}
      style={{ outline: "none", cursor: "default" }}
      onPointerEnter={(e) => api.show(e, tip)}
      onPointerMove={(e) => api.show(e, tip)}
      onPointerLeave={api.hide}
      onFocus={(e) => api.showFocus(e, tip)}
      onBlur={api.hide}
    />
  );
}
