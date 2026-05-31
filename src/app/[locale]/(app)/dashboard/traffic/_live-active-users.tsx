"use client";

import { useEffect, useState } from "react";

interface RealtimeResponse {
  ok: boolean;
  activeUsers: number | null;
  error?: string;
}

const POLL_MS = 30_000;

/**
 * Live "Active users right now" widget.
 * Polls /api/v1/integrations/ga4/realtime every 30s. Shows "—" on any error
 * per policy §7 (graceful degradation).
 */
export function LiveActiveUsers() {
  const [state, setState] = useState<RealtimeResponse | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/v1/integrations/ga4/realtime", {
          cache: "no-store",
        });
        const j = (await r.json()) as RealtimeResponse;
        if (!cancelled) {
          setState(j);
          setUpdatedAt(Date.now());
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

  // Tick the "Xs ago" display every second without re-fetching.
  useEffect(() => {
    if (updatedAt === null) return;
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - updatedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [updatedAt]);

  return (
    <div style={{ padding: 12, border: "0.5px solid var(--gl-border)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "var(--gl-text-tertiary)" }}>
        Active users (live)
      </div>
      <div style={{ fontSize: 32, fontWeight: 600 }}>
        {state?.ok ? state.activeUsers : "—"}
      </div>
      <div style={{ fontSize: 11, color: "var(--gl-text-tertiary)" }}>
        {updatedAt === null
          ? "loading…"
          : `updated ${secondsAgo ?? 0}s ago`}
        {state && !state.ok && state.error ? ` · ${state.error}` : null}
      </div>
    </div>
  );
}
