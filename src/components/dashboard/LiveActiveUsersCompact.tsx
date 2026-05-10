"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { KpiSparkline } from "./KpiSparkline";

interface RealtimeResponse {
  ok: boolean;
  activeUsers: number | null;
  error?: string;
}

const POLL_MS = 30_000;
const SPARK_HISTORY = 10;

/**
 * Compact horizontal "Activos ahora" widget for the Traffic Detail page.
 * Pulses, polls every 30s, accumulates a tiny sparkline of recent values.
 *
 * Falls back to "—" on any error per policy §7.
 */
export function LiveActiveUsersCompact() {
  const t = useTranslations("traffic.live");
  const [state, setState] = useState<RealtimeResponse | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);
  const [history, setHistory] = useState<{ date: string; value: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/v1/integrations/ga4/realtime", {
          cache: "no-store",
        });
        const j = (await r.json()) as RealtimeResponse;
        if (cancelled) return;
        setState(j);
        setUpdatedAt(Date.now());
        if (j.ok && typeof j.activeUsers === "number") {
          const point = {
            date: new Date().toISOString(),
            value: j.activeUsers,
          };
          setHistory((h) => [...h, point].slice(-SPARK_HISTORY));
        }
      } catch {
        if (!cancelled) {
          setState({ ok: false, activeUsers: null, error: "network" });
          setUpdatedAt(Date.now());
        }
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (updatedAt === null) return;
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - updatedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [updatedAt]);

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 24,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--s-success)",
              boxShadow: "0 0 0 4px rgba(29, 158, 117, 0.18)",
            }}
          />
          {t("label")}
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {state?.ok ? state.activeUsers : "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
          {updatedAt === null
            ? t("loading")
            : t("updatedAgo", { seconds: secondsAgo ?? 0 })}
          {state && !state.ok && state.error
            ? ` · ${state.error}`
            : null}
        </div>
      </div>
      <div style={{ flex: 1, height: 40, minWidth: 120 }}>
        <KpiSparkline
          data={history}
          color="#378ADD"
          strokeWidth={2}
          height={40}
        />
      </div>
    </div>
  );
}
