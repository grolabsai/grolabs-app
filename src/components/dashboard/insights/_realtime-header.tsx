"use client";

import { useEffect, useState } from "react";

interface RealtimeResponse {
  ok: boolean;
  activeUsers: number | null;
  error?: string;
}

const POLL_MS = 30_000;

/**
 * Header realtime indicator: pulsing dot + "Realtime" label + live active-user
 * count. Polls the GA4 realtime endpoint every 30s and degrades to "—" on any
 * error (policy §7). `label` is passed in so the string stays i18n-owned.
 */
export function RealtimeHeader({ label }: { label: string }) {
  const [state, setState] = useState<RealtimeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/v1/integrations/ga4/realtime", {
          cache: "no-store",
        });
        const j = (await r.json()) as RealtimeResponse;
        if (!cancelled) setState(j);
      } catch {
        if (!cancelled) {
          setState({ ok: false, activeUsers: null, error: "network" });
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

  const live = state?.ok && typeof state.activeUsers === "number";

  return (
    <div className="realtime">
      <span className={`pulse-dot${live ? "" : " off"}`} />
      <span className="label">{label}</span>
      <span className="val num">{live ? state!.activeUsers : "—"}</span>
    </div>
  );
}
