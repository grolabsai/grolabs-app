"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const POLL_MS = 5_000;

type Tab = "events" | "searches" | "carts";

interface EventRow {
  id: number; created_at: string; event_type: string | null; event_name: string | null;
  placement: string | null; user_id: string | null; account_id: string | null;
  object_id: string | null; object_name: string | null; position: number | null;
  cart_id: string | null; order_id: string | null; value: number | null;
  quantity: number | null; query_uid: string | null; origin: string | null;
}
interface SearchRow {
  id: number; created_at: string; query: string | null; total_hits: number | null;
  is_committed: boolean | null; commit_reason: string | null; user_id: string | null;
  account_id: string | null; query_uid: string | null; intent_group_id: string | null; origin: string | null;
}
interface CartRow {
  cart_id: string; status: string; value: number | null; item_count: number | null;
  total_quantity: number | null; account_id: string | null; order_id: string | null;
  created_at: string; last_event_at: string;
}
interface CartEventRow {
  id: number; created_at: string; event_type: string | null; event_name: string | null;
  object_id: string | null; object_name: string | null; quantity: number | null;
  placement: string | null; value: number | null; order_id: string | null;
}

const TYPE_COLOR: Record<string, string> = {
  click: "var(--gl-info, #7fb0c9)", conversion: "var(--gl-success, #5fbf6a)",
  cart_remove: "var(--gl-danger, #e0483b)", view: "var(--gl-warning, #d8a23a)",
  session: "var(--gl-text-tertiary, #888)",
};
const STATUS_COLOR: Record<string, string> = {
  open: "var(--gl-info, #7fb0c9)", completed: "var(--gl-success, #5fbf6a)",
  abandoned: "var(--gl-danger, #e0483b)", recovered: "var(--gl-warning, #d8a23a)",
};

function short(s: string | null, n = 10): string { if (!s) return "·"; return s.length > n ? s.slice(0, n) + "…" : s; }
function money(v: number | null): string { return v == null ? "·" : `$${Number(v).toLocaleString("en-US")}`; }
function clock(iso: string): string { return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function day(iso: string): string { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

export function EventsLogLive() {
  const t = useTranslations("configuration.events");
  const [tab, setTab] = useState<Tab>("events");
  const [rows, setRows] = useState<EventRow[]>([]);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [selCart, setSelCart] = useState<{ cart: CartRow | null; events: CartEventRow[] } | null>(null);
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState<string>("");
  const [err, setErr] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const path = tab === "events" ? "/api/events-log?limit=200"
        : tab === "searches" ? "/api/searches-log?limit=200"
        : "/api/cart-debug";
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) { setErr(true); return; }
      const json = await res.json();
      if (tab === "events") setRows((json.events ?? []) as EventRow[]);
      else if (tab === "searches") setSearches((json.searches ?? []) as SearchRow[]);
      else setCarts((json.carts ?? []) as CartRow[]);
      setErr(false);
      setUpdated(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { setErr(true); }
  }, [tab]);

  const openCart = useCallback(async (cartId: string) => {
    try {
      const res = await fetch(`/api/cart-debug?cart=${encodeURIComponent(cartId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setSelCart({ cart: json.cart ?? null, events: (json.events ?? []) as CartEventRow[] });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch on mount/tab change; setState runs after the await
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!live || selCart) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, refresh, selCart]);

  const count = tab === "events" ? rows.length : tab === "searches" ? searches.length : carts.length;

  const cell: React.CSSProperties = { padding: "6px 10px", fontSize: 11.5, fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-secondary)", whiteSpace: "nowrap", borderBottom: "0.5px solid var(--gl-border)" };
  const head: React.CSSProperties = { padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--gl-text-tertiary)", textAlign: "left", whiteSpace: "nowrap", borderBottom: "0.5px solid var(--gl-border)", position: "sticky", top: 0, background: "var(--gl-surface)" };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: "5px 14px", borderRadius: "var(--gl-radius-md)", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "0.5px solid var(--gl-border)", background: active ? "var(--gl-text-primary)" : "transparent", color: active ? "var(--gl-surface)" : "var(--gl-text-secondary)" });
  const box: React.CSSProperties = { background: "var(--gl-surface)", border: "0.5px solid var(--gl-border)", borderRadius: "var(--gl-radius-lg)", overflow: "auto", maxHeight: "70vh" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => { setTab("events"); setSelCart(null); }} style={tabBtn(tab === "events")}>{t("tabEvents")}</button>
        <button onClick={() => { setTab("searches"); setSelCart(null); }} style={tabBtn(tab === "searches")}>{t("tabSearches")}</button>
        <button onClick={() => { setTab("carts"); setSelCart(null); }} style={tabBtn(tab === "carts")}>{t("tabCarts")}</button>
      </div>

      {!selCart && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={() => setLive((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: "var(--gl-radius-md)", border: "0.5px solid var(--gl-border)", background: "var(--gl-surface)", color: "var(--gl-text-primary)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: live && !err ? "#2ecc71" : err ? "#d0a020" : "var(--gl-text-tertiary)", boxShadow: live && !err ? "0 0 0 3px rgba(46,204,113,0.18)" : "none" }} />
            {live ? t("live") : t("paused")}
          </button>
          <button onClick={refresh} style={{ padding: "5px 12px", borderRadius: "var(--gl-radius-md)", border: "0.5px solid var(--gl-border)", background: "transparent", color: "var(--gl-text-secondary)", fontSize: 12, cursor: "pointer" }}>{t("refresh")}</button>
          <span style={{ fontSize: 11, color: "var(--gl-text-tertiary)", fontFamily: "var(--gl-font-mono)" }}>{t("status", { count, time: updated || "—" })}</span>
        </div>
      )}

      {/* ── EVENTS ── */}
      {tab === "events" && (
        <div style={box}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
            <thead><tr>{["time","type","event_name","placement","user_id","account_id","object","cart_id","order_id","value","qty","pos","query_uid","origin"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={14} style={{ ...cell, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>{t("empty")}</td></tr>
              : rows.map((r) => (
                <tr key={r.id}>
                  <td style={cell}><span style={{ color: "var(--gl-text-primary)" }}>{clock(r.created_at)}</span> <span style={{ color: "var(--gl-text-tertiary)" }}>{day(r.created_at)}</span></td>
                  <td style={cell}><span style={{ color: TYPE_COLOR[r.event_type ?? ""] ?? "var(--gl-text-secondary)", fontWeight: 600 }}>{r.event_type ?? "·"}</span></td>
                  <td style={{ ...cell, color: "var(--gl-text-primary)" }}>{r.event_name ?? "·"}</td>
                  <td style={cell} title={r.placement ?? ""}>{short(r.placement, 16)}</td>
                  <td style={cell} title={r.user_id ?? ""}>{short(r.user_id)}</td>
                  <td style={cell} title={r.account_id ?? ""}>{short(r.account_id)}</td>
                  <td style={cell} title={r.object_name ?? r.object_id ?? ""}>{short(r.object_name ?? r.object_id, 16)}</td>
                  <td style={{ ...cell, cursor: r.cart_id ? "pointer" : undefined, color: r.cart_id ? "var(--gl-info, #7fb0c9)" : undefined }} title={r.cart_id ?? ""} onClick={() => r.cart_id && (setTab("carts"), openCart(r.cart_id))}>{short(r.cart_id)}</td>
                  <td style={cell} title={r.order_id ?? ""}>{short(r.order_id)}</td>
                  <td style={{ ...cell, color: r.value != null ? "var(--gl-success, #5fbf6a)" : undefined }}>{money(r.value)}</td>
                  <td style={cell}>{r.quantity ?? "·"}</td>
                  <td style={cell}>{r.position ?? "·"}</td>
                  <td style={cell} title={r.query_uid ?? ""}>{short(r.query_uid)}</td>
                  <td style={cell} title={r.origin ?? ""}>{short(r.origin, 18)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SEARCHES ── */}
      {tab === "searches" && (
        <div style={box}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
            <thead><tr>{["time","query","hits","committed","reason","user_id","account_id","query_uid","origin"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
            <tbody>
              {searches.length === 0 ? <tr><td colSpan={9} style={{ ...cell, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>{t("empty")}</td></tr>
              : searches.map((r) => (
                <tr key={r.id}>
                  <td style={cell}><span style={{ color: "var(--gl-text-primary)" }}>{clock(r.created_at)}</span> <span style={{ color: "var(--gl-text-tertiary)" }}>{day(r.created_at)}</span></td>
                  <td style={{ ...cell, color: "var(--gl-text-primary)" }} title={r.query ?? ""}>{short(r.query, 28)}</td>
                  <td style={{ ...cell, color: r.total_hits === 0 ? "var(--gl-danger, #e0483b)" : "var(--gl-text-secondary)" }}>{r.total_hits ?? "·"}</td>
                  <td style={cell}>{r.is_committed == null ? "·" : r.is_committed ? "yes" : "no"}</td>
                  <td style={cell} title={r.commit_reason ?? ""}>{short(r.commit_reason, 14)}</td>
                  <td style={cell} title={r.user_id ?? ""}>{short(r.user_id)}</td>
                  <td style={cell} title={r.account_id ?? ""}>{short(r.account_id)}</td>
                  <td style={cell} title={r.query_uid ?? ""}>{short(r.query_uid)}</td>
                  <td style={cell} title={r.origin ?? ""}>{short(r.origin, 18)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── CARTS ── */}
      {tab === "carts" && !selCart && (
        <div style={box}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1000 }}>
            <thead><tr>{["cart_id","status","value","items","qty","account_id","order_id","created","last event"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
            <tbody>
              {carts.length === 0 ? <tr><td colSpan={9} style={{ ...cell, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>{t("empty")}</td></tr>
              : carts.map((c) => (
                <tr key={c.cart_id}>
                  <td style={{ ...cell, cursor: "pointer", color: "var(--gl-info, #7fb0c9)" }} title={c.cart_id} onClick={() => openCart(c.cart_id)}>{short(c.cart_id, 18)}</td>
                  <td style={cell}><span style={{ color: STATUS_COLOR[c.status] ?? "var(--gl-text-secondary)", fontWeight: 600 }}>{c.status}</span></td>
                  <td style={{ ...cell, color: "var(--gl-text-primary)" }}>{money(c.value)}</td>
                  <td style={cell}>{c.item_count ?? "·"}</td>
                  <td style={cell}>{c.total_quantity ?? "·"}</td>
                  <td style={cell} title={c.account_id ?? ""}>{short(c.account_id)}</td>
                  <td style={cell} title={c.order_id ?? ""}>{short(c.order_id)}</td>
                  <td style={cell}>{clock(c.created_at)} {day(c.created_at)}</td>
                  <td style={cell}>{clock(c.last_event_at)} {day(c.last_event_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── CART TIMELINE (detail) ── */}
      {tab === "carts" && selCart && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
            <button onClick={() => setSelCart(null)} style={{ padding: "5px 12px", borderRadius: "var(--gl-radius-md)", border: "0.5px solid var(--gl-border)", background: "transparent", color: "var(--gl-text-secondary)", fontSize: 12, cursor: "pointer" }}>← {t("tabCarts")}</button>
            {selCart.cart && (
              <span style={{ fontSize: 12, fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-secondary)" }}>
                <b style={{ color: STATUS_COLOR[selCart.cart.status] ?? "var(--gl-text-primary)" }}>{selCart.cart.status}</b>
                {"  ·  value "}<b style={{ color: "var(--gl-text-primary)" }}>{money(selCart.cart.value)}</b>
                {"  ·  items "}{selCart.cart.item_count ?? 0}
                {"  ·  created "}{clock(selCart.cart.created_at)} {day(selCart.cart.created_at)}
                {selCart.cart.order_id ? `  ·  order ${selCart.cart.order_id}` : ""}
              </span>
            )}
          </div>
          <div style={box}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 800 }}>
              <thead><tr>{["time","type","event_name","object","qty","placement","value","order_id"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {selCart.events.length === 0 ? <tr><td colSpan={8} style={{ ...cell, textAlign: "center", color: "var(--gl-text-tertiary)", padding: 28 }}>{t("empty")}</td></tr>
                : selCart.events.map((e) => (
                  <tr key={e.id}>
                    <td style={cell}><span style={{ color: "var(--gl-text-primary)" }}>{clock(e.created_at)}</span> <span style={{ color: "var(--gl-text-tertiary)" }}>{day(e.created_at)}</span></td>
                    <td style={cell}><span style={{ color: TYPE_COLOR[e.event_type ?? ""] ?? "var(--gl-text-secondary)", fontWeight: 600 }}>{e.event_type ?? "·"}</span></td>
                    <td style={{ ...cell, color: "var(--gl-text-primary)" }}>{e.event_name ?? "·"}</td>
                    <td style={cell} title={e.object_name ?? e.object_id ?? ""}>{short(e.object_name ?? e.object_id, 18)}</td>
                    <td style={cell}>{e.quantity ?? "·"}</td>
                    <td style={cell} title={e.placement ?? ""}>{short(e.placement, 16)}</td>
                    <td style={{ ...cell, color: e.value != null ? "var(--gl-success, #5fbf6a)" : undefined }}>{money(e.value)}</td>
                    <td style={cell} title={e.order_id ?? ""}>{short(e.order_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
