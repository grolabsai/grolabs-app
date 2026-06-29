"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const POLL_MS = 5_000;

type Tab = "events" | "searches";

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

interface SearchRow {
  id: number;
  created_at: string;
  query: string | null;
  total_hits: number | null;
  is_committed: boolean | null;
  commit_reason: string | null;
  user_id: string | null;
  account_id: string | null;
  query_uid: string | null;
  intent_group_id: string | null;
  origin: string | null;
}

const TYPE_COLOR: Record<string, string> = {
  click: "var(--gl-info, #7fb0c9)",
  conversion: "var(--gl-success, #5fbf6a)",
  cart_remove: "var(--gl-danger, #e0483b)",
  view: "var(--gl-warning, #d8a23a)",
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
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EventsLogLive() {
  const t = useTranslations("configuration.events");
  const [tab, setTab] = useState<Tab>("events");
  const [rows, setRows] = useState<EventRow[]>([]);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState<string>("");
  const [err, setErr] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const path = tab === "events" ? "/api/events-log?limit=200" : "/api/searches-log?limit=200";
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) { setErr(true); return; }
      const json = await res.json();
      if (tab === "events") setRows((json.events ?? []) as EventRow[]);
      else setSearches((json.searches ?? []) as SearchRow[]);
      setErr(false);
      setUpdated(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      setErr(true);
    }
  }, [tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch on mount/tab change; setState runs after the await
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

  const count = tab === "events" ? rows.length : searches.length;

  const cellStyle: React.CSSProperties = {
    padding: "6px 10px", fontSize: 11.5, fontFamily: "var(--gl-font-mono)",
    color: "var(--gl-text-secondary)", whiteSpace: "nowrap", borderBottom: "0.5px solid var(--gl-border)",
  };
  const headStyle: React.CSSProperties = {
    padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
    color: "var(--gl-text-tertiary)", textAlign: "left", whiteSpace: "nowrap",
    borderBottom: "0.5px solid var(--gl-border)", position: "sticky", top: 0, background: "var(--gl-surface)",
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: "var(--gl-radius-md)", fontSize: 12, fontWeight: 500, cursor: "pointer",
    border: "0.5px solid var(--gl-border)",
    background: active ? "var(--gl-text-primary)" : "transparent",
    color: active ? "var(--gl-surface)" : "var(--gl-text-secondary)",
  });

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setTab("events")} style={tabBtn(tab === "events")}>{t("tabEvents")}</button>
        <button onClick={() => setTab("searches")} style={tabBtn(tab === "searches")}>{t("tabSearches")}</button>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          onClick={() => setLive((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px",
            borderRadius: "var(--gl-radius-md)", border: "0.5px solid var(--gl-border)",
            background: "var(--gl-surface)", color: "var(--gl-text-primary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: live && !err ? "#2ecc71" : err ? "#d0a020" : "var(--gl-text-tertiary)",
            boxShadow: live && !err ? "0 0 0 3px rgba(46,204,113,0.18)" : "none",
          }} />
          {live ? t("live") : t("paused")}
        </button>
        <button
          onClick={refresh}
          style={{
            padding: "5px 12px", borderRadius: "var(--gl-radius-md)", border: "0.5px solid var(--gl-border)",
            background: "transparent", color: "var(--gl-text-secondary)", fontSize: 12, cursor: "pointer",
          }}
        >
          {t("refresh")}
        </button>
        <span style={{ fontSize: 11, color: "var(--gl-text-tertiary)", fontFamily: "var(--gl-font-mono)" }}>
          {t("status", { count, time: updated || "—" })}
        </span>
      </div>

      {/* Table */}
      <div style={{
        background: "var(--gl-surface)", border: "0.5px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-lg)", overflow: "auto", maxHeight: "70vh",
      }}>
        {tab === "events" ? (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
            <thead>
              <tr>
                {["time", "type", "event_name", "placement", "user_id", "account_id", "object", "cart_id", "order_id", "value", "qty", "pos", "query_uid", "origin"].map((h) => (
                  <th key={h} style={headStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={14} style={{ ...cellStyle, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>{t("empty")}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td style={cellStyle}><span style={{ color: "var(--gl-text-primary)" }}>{clock(r.created_at)}</span> <span style={{ color: "var(--gl-text-tertiary)" }}>{day(r.created_at)}</span></td>
                  <td style={cellStyle}><span style={{ color: TYPE_COLOR[r.event_type ?? ""] ?? "var(--gl-text-secondary)", fontWeight: 600 }}>{r.event_type ?? "·"}</span></td>
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
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
            <thead>
              <tr>
                {["time", "query", "hits", "committed", "reason", "user_id", "account_id", "query_uid", "origin"].map((h) => (
                  <th key={h} style={headStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {searches.length === 0 ? (
                <tr><td colSpan={9} style={{ ...cellStyle, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>{t("empty")}</td></tr>
              ) : searches.map((r) => (
                <tr key={r.id}>
                  <td style={cellStyle}><span style={{ color: "var(--gl-text-primary)" }}>{clock(r.created_at)}</span> <span style={{ color: "var(--gl-text-tertiary)" }}>{day(r.created_at)}</span></td>
                  <td style={{ ...cellStyle, color: "var(--gl-text-primary)" }} title={r.query ?? ""}>{short(r.query, 28)}</td>
                  <td style={{ ...cellStyle, color: r.total_hits === 0 ? "var(--gl-danger, #e0483b)" : "var(--gl-text-secondary)" }}>{r.total_hits ?? "·"}</td>
                  <td style={cellStyle}>{r.is_committed == null ? "·" : r.is_committed ? "yes" : "no"}</td>
                  <td style={cellStyle} title={r.commit_reason ?? ""}>{short(r.commit_reason, 14)}</td>
                  <td style={cellStyle} title={r.user_id ?? ""}>{short(r.user_id)}</td>
                  <td style={cellStyle} title={r.account_id ?? ""}>{short(r.account_id)}</td>
                  <td style={cellStyle} title={r.query_uid ?? ""}>{short(r.query_uid)}</td>
                  <td style={cellStyle} title={r.origin ?? ""}>{short(r.origin, 18)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
