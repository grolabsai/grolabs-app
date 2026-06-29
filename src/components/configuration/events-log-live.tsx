"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const POLL_MS = 5_000;

interface EventRow {
  id: number;
  created_at: string;
  event_type: string | null;
  event_name: string | null;
  placement: string | null;
  user_id: string | null;
  account_id: string | null;
  object_id: string | null;
  object_name: string | null;
  position: number | null;
  cart_id: string | null;
  order_id: string | null;
  value: number | null;
  quantity: number | null;
  query_uid: string | null;
  origin: string | null;
}

const TYPE_COLOR: Record<string, string> = {
  click: "var(--gl-info, #7fb0c9)",
  conversion: "var(--gl-success, #5fbf6a)",
  cart_remove: "var(--gl-danger, #e0483b)",
  session: "var(--gl-text-tertiary, #888)",
};

function short(s: string | null, n = 10): string {
  if (!s) return "·";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function money(v: number | null): string {
  return v == null ? "·" : `$${Number(v).toLocaleString("en-US")}`;
}
function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EventsLogLive() {
  const t = useTranslations("configuration.events");
  const [rows, setRows] = useState<EventRow[]>([]);
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState<string>("");
  const [err, setErr] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/events-log?limit=200", { cache: "no-store" });
      if (!res.ok) { setErr(true); return; }
      const json = (await res.json()) as { events: EventRow[] };
      setRows(json.events ?? []);
      setErr(false);
      setUpdated(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch on mount; setState runs after the await, not synchronously
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!live) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, refresh]);

  const cellStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 11.5,
    fontFamily: "var(--gl-font-mono)",
    color: "var(--gl-text-secondary)",
    whiteSpace: "nowrap",
    borderBottom: "0.5px solid var(--gl-border)",
  };
  const headStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--gl-text-tertiary)",
    textAlign: "left",
    whiteSpace: "nowrap",
    borderBottom: "0.5px solid var(--gl-border)",
    position: "sticky",
    top: 0,
    background: "var(--gl-surface)",
  };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          onClick={() => setLive((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 12px", borderRadius: "var(--gl-radius-md)",
            border: "0.5px solid var(--gl-border)", background: "var(--gl-surface)",
            color: "var(--gl-text-primary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 8, height: 8, borderRadius: "50%",
              background: live && !err ? "#2ecc71" : err ? "#d0a020" : "var(--gl-text-tertiary)",
              boxShadow: live && !err ? "0 0 0 3px rgba(46,204,113,0.18)" : "none",
            }}
          />
          {live ? t("live") : t("paused")}
        </button>
        <button
          onClick={refresh}
          style={{
            padding: "5px 12px", borderRadius: "var(--gl-radius-md)",
            border: "0.5px solid var(--gl-border)", background: "transparent",
            color: "var(--gl-text-secondary)", fontSize: 12, cursor: "pointer",
          }}
        >
          {t("refresh")}
        </button>
        <span style={{ fontSize: 11, color: "var(--gl-text-tertiary)", fontFamily: "var(--gl-font-mono)" }}>
          {t("status", { count: rows.length, time: updated || "—" })}
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          background: "var(--gl-surface)",
          border: "0.5px solid var(--gl-border)",
          borderRadius: "var(--gl-radius-lg)",
          overflow: "auto",
          maxHeight: "70vh",
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={headStyle}>time</th>
              <th style={headStyle}>type</th>
              <th style={headStyle}>event_name</th>
              <th style={headStyle}>placement</th>
              <th style={headStyle}>user_id</th>
              <th style={headStyle}>account_id</th>
              <th style={headStyle}>object</th>
              <th style={headStyle}>cart_id</th>
              <th style={headStyle}>order_id</th>
              <th style={headStyle}>value</th>
              <th style={headStyle}>qty</th>
              <th style={headStyle}>pos</th>
              <th style={headStyle}>query_uid</th>
              <th style={headStyle}>origin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={14} style={{ ...cellStyle, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={cellStyle}>
                    <span style={{ color: "var(--gl-text-primary)" }}>{clock(r.created_at)}</span>{" "}
                    <span style={{ color: "var(--gl-text-tertiary)" }}>{day(r.created_at)}</span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: TYPE_COLOR[r.event_type ?? ""] ?? "var(--gl-text-secondary)", fontWeight: 600 }}>
                      {r.event_type ?? "·"}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, color: "var(--gl-text-primary)" }}>{r.event_name ?? "·"}</td>
                  <td style={cellStyle} title={r.placement ?? ""}>{short(r.placement, 16)}</td>
                  <td style={cellStyle} title={r.user_id ?? ""}>{short(r.user_id)}</td>
                  <td style={cellStyle} title={r.account_id ?? ""}>{short(r.account_id)}</td>
                  <td style={cellStyle} title={r.object_name ?? r.object_id ?? ""}>{short(r.object_name ?? r.object_id, 16)}</td>
                  <td style={cellStyle} title={r.cart_id ?? ""}>{short(r.cart_id)}</td>
                  <td style={cellStyle} title={r.order_id ?? ""}>{short(r.order_id)}</td>
                  <td style={{ ...cellStyle, color: r.value != null ? "var(--gl-success, #5fbf6a)" : undefined }}>{money(r.value)}</td>
                  <td style={cellStyle}>{r.quantity ?? "·"}</td>
                  <td style={cellStyle}>{r.position ?? "·"}</td>
                  <td style={cellStyle} title={r.query_uid ?? ""}>{short(r.query_uid)}</td>
                  <td style={cellStyle} title={r.origin ?? ""}>{short(r.origin, 18)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
