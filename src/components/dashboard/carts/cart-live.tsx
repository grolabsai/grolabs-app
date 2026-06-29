"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { fmtInt, fmtMoney } from "@/components/dashboard/insights/charts";
import type { CartLive } from "@/lib/analytics/carts-live";

const POLL_MS = 15_000;

/**
 * Realtime open-cart panel. Polls /api/dashboard/carts every 15s (and on tab
 * refocus) — this view reads live state, never a rollup. Renders the headline
 * Amount + cart count and a single 100%-width bar split proportionally across
 * the six age buckets (fresh → stale). Bucket %s and counts are exact; Amount is
 * AOV-estimated until carts carry a subtotal (see data layer).
 */
export function CartLivePanel({ initial }: { initial: CartLive }) {
  const t = useTranslations("dashboard.carts");
  const [data, setData] = useState<CartLive>(initial);
  const [stale, setStale] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/carts", { cache: "no-store" });
      if (!res.ok) { setStale(true); return; }
      setData((await res.json()) as CartLive);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    timer.current = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer.current) clearInterval(timer.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const updated = new Date(data.generatedAt).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="cart-live">
      {/* Headline: Amount (big) + Carts */}
      <div className="cl-head">
        <div className="cl-metric">
          <span className="cl-label">{t("amount")}</span>
          <div className="cl-figure">
            <span className="cl-amount">{fmtMoney(data.amount)}</span>
            {data.amountEstimated && (
              <span className="cl-est" title={t("estimatedHint")}>{t("estimated")}</span>
            )}
          </div>
        </div>
        <div className="cl-metric">
          <span className="cl-label">{t("carts")}</span>
          <span className="cl-carts">{fmtInt(data.carts)}</span>
        </div>
        <div className="cl-live">
          <span className={`cl-dot${stale ? " off" : ""}`} />
          <span className="cl-live-txt">{stale ? t("reconnecting") : t("live")}</span>
          <span className="cl-updated">{t("updated", { time: updated })}</span>
        </div>
      </div>

      {data.carts > 0 ? (
        <>
          {/* One 100%-width bar, split proportionally by age bucket */}
          <div className="cl-bar" role="img" aria-label={t("barAria")}>
            {data.buckets.map((b, i) => (
              <div
                key={b.key}
                className="cl-seg"
                title={`${t(`buckets.${b.key}`)} · ${fmtInt(b.count)} (${b.pct.toFixed(1)}%)`}
                style={{
                  width: `${b.pct}%`,
                  minWidth: b.count > 0 ? 3 : 0,
                  background: b.color,
                  borderTopLeftRadius: i === 0 ? 6 : 0,
                  borderBottomLeftRadius: i === 0 ? 6 : 0,
                  borderTopRightRadius: i === data.buckets.length - 1 ? 6 : 0,
                  borderBottomRightRadius: i === data.buckets.length - 1 ? 6 : 0,
                }}
              >
                <span className="cl-seg-pct">{b.pct >= 5 ? `${Math.round(b.pct)}%` : ""}</span>
                <span className="cl-seg-lbl">{b.pct >= 5 ? t(`buckets.${b.key}`) : ""}</span>
              </div>
            ))}
          </div>

          {/* Full legend — covers the thin slivers the bar can't label */}
          <div className="cl-legend">
            {data.buckets.map((b) => (
              <div key={b.key} className="cl-leg">
                <span className="cl-leg-dot" style={{ background: b.color }} />
                <span className="cl-leg-lbl">{t(`buckets.${b.key}`)}</span>
                <span className="cl-leg-val">{fmtInt(b.count)}</span>
                <span className="cl-leg-pct">{b.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="cl-empty">{t("empty")}</div>
      )}
    </div>
  );
}
