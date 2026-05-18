"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Copy, Info, XCircle } from "lucide-react";
import { toast } from "sonner";

import { useActivityStream } from "@/components/shell/ActivityStreamContext";
import { Icon } from "@/components/ui/icon";
import type { ActivityEvent } from "@/lib/activity/event";

/**
 * Right-side Activity Stream — a global, in-memory operator event log.
 * Full transparency: every sync run, agent call and uncaught error lands
 * here with its full payload, copy-pasteable. Newest at top.
 *
 * Collapsible to a 32px rail; preference persists in localStorage. Same
 * layout slot and dimensions as before — only the contents changed.
 */
export function ActivityStream() {
  const t = useTranslations("activityStream");
  const { events, clear } = useActivityStream();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("activity-stream-collapsed");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("activity-stream-collapsed", String(next));
    } catch {
      // localStorage unavailable
    }
  }

  // Avoid layout shift before localStorage is read
  if (!mounted) return <div style={{ width: 32, flexShrink: 0 }} />;

  if (collapsed) {
    return (
      <div
        style={{
          width: 32,
          flexShrink: 0,
          borderLeft: "0.5px solid var(--s-border)",
          background: "var(--s-surface-alt)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
          position: "relative",
        }}
        onClick={toggle}
        title={t("title")}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--s-text-tertiary)",
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          {t("title")}
        </span>
        {events.length > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 6,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              background: "var(--scout-accent)",
              color: "white",
              fontSize: 10,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {events.length}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        borderLeft: "0.5px solid var(--s-border)",
        background: "var(--s-surface-alt)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          borderBottom: "0.5px solid var(--s-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background:
              events.length > 0 ? "var(--scout-accent)" : "var(--s-text-muted)",
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--s-text)" }}>
          {t("title")}
        </span>
        {events.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              padding: "2px 6px",
            }}
          >
            {t("clear")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--s-text-tertiary)",
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 4px",
            fontFamily: "var(--s-font)",
          }}
          title={t("collapseTitle")}
        >
          ›
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: events.length === 0 ? "14px" : "10px 10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {events.length === 0 ? (
          <div
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              padding: "12px 14px",
              fontSize: 12,
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("empty")}
          </div>
        ) : (
          events.map((e) => <Row key={e.id} event={e} />)
        )}
      </div>
    </div>
  );
}

// ─── One event row ─────────────────────────────────────────────────────────

function Row({ event }: { event: ActivityEvent }) {
  const t = useTranslations("activityStream");
  const [open, setOpen] = useState(false);
  const palette = paletteFor(event.severity);

  function copyPayload(e: React.MouseEvent) {
    e.stopPropagation();
    const text = JSON.stringify(event.payload ?? null, null, 2);
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));
  }

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: `0.5px solid ${palette.border}`,
        borderLeft: `2px solid ${palette.accent}`,
        borderRadius: "var(--s-radius-md)",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div
        onClick={() => setOpen((x) => !x)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          cursor: "pointer",
        }}
      >
        <span
          title={event.severity}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: palette.accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--s-text-tertiary)",
            background: "var(--s-surface-alt)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-sm)",
            padding: "1px 5px",
            flexShrink: 0,
          }}
        >
          {t(`actor.${event.actor}`)}
        </span>
        <span
          style={{
            flex: 1,
            color: "var(--s-text)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`${event.type} — ${event.title}`}
        >
          {event.title}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            flexShrink: 0,
          }}
        >
          {formatTime(event.timestamp)}
        </span>
      </div>
      {open ? (
        <div style={{ padding: "0 10px 10px" }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--s-text-tertiary)",
              fontFamily: "var(--s-font-mono)",
              marginBottom: 6,
            }}
          >
            {event.type}
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 280,
              overflow: "auto",
              background: "var(--s-surface-alt)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-sm)",
              padding: "8px 10px",
              fontSize: 11,
              fontFamily: "var(--s-font-mono)",
              whiteSpace: "pre",
              color: "var(--s-text)",
            }}
          >
            {JSON.stringify(event.payload ?? null, null, 2)}
          </pre>
          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={copyPayload}
              title={t("copyHint")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--s-text-secondary)",
                background: "transparent",
                border: "0.5px solid var(--s-border)",
                borderRadius: "var(--s-radius-sm)",
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              <Icon icon={Copy} size={11} />
              {t("copy")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function paletteFor(severity: ActivityEvent["severity"]) {
  switch (severity) {
    case "success":
      return { icon: CheckCircle2, accent: "var(--s-success)", border: "var(--s-border)" };
    case "warn":
      return { icon: AlertTriangle, accent: "var(--s-warning)", border: "var(--s-border)" };
    case "error":
      return { icon: XCircle, accent: "var(--s-danger)", border: "var(--s-border)" };
    case "info":
    default:
      return { icon: Info, accent: "var(--s-text-tertiary)", border: "var(--s-border)" };
  }
}

function formatTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
