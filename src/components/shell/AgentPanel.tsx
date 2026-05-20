"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useAgentLog } from "@/components/shell/AgentLogContext";
import { Icon } from "@/components/ui/icon";
import type { AgentMessage } from "@/lib/import/types";

/**
 * Right-side Assistant panel — global, shared across the app. Renders the
 * agent narrative log fed by `useAgentLog().append(...)`. Today the only
 * pusher is the import wizard; future features can push too without
 * touching this component.
 *
 * Collapsible to a 32px rail; user preference persists in localStorage.
 * When expanded, shows messages chronologically (oldest top, newest
 * bottom). Each message can carry a structured `raw` payload that the
 * user can copy verbatim — useful for sharing exact agent responses
 * back to support.
 */
export function AgentPanel() {
  const t = useTranslations("agentPanel");
  const { messages, clear } = useAgentLog();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("agent-panel-collapsed");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Auto-scroll to newest message on expand or when a message lands.
  useEffect(() => {
    if (collapsed) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, collapsed]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("agent-panel-collapsed", String(next));
    } catch {
      // localStorage unavailable
    }
  }

  // Avoid layout shift before localStorage is read
  if (!mounted) return <div style={{ width: 56, flexShrink: 0 }} />;

  if (collapsed) {
    return (
      <div
        style={{
          width: 56,
          flexShrink: 0,
          padding: "24px 24px 24px 0",
          display: "flex",
        }}
      >
        <button
          type="button"
          onClick={toggle}
          title={t("title")}
          style={{
            flex: 1,
            background: "#ffffff",
            border: "1px solid var(--s-border)",
            borderRadius: 14,
            boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            position: "relative",
            padding: 0,
            fontFamily: "inherit",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--s-text-tertiary)",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {t("title")}
          </span>
          {messages.length > 0 ? (
            <span
              style={{
                position: "absolute",
                top: 10,
                right: 8,
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 9,
                background: "var(--scout-accent)",
                color: "#18181b",
                fontSize: 10,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              {messages.length}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 384,
        flexShrink: 0,
        padding: "24px 24px 24px 0",
        display: "flex",
      }}
    >
    <div
      style={{
        flex: 1,
        background: "#ffffff",
        border: "1px solid var(--s-border)",
        borderRadius: 14,
        boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
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
            background: "var(--s-success)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--s-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {t("title")}
        </span>
        {messages.length > 0 ? (
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
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: messages.length === 0 ? "14px" : "10px 10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--s-text-tertiary)", marginBottom: 4 }}>
              {t("noActivity")}
            </div>
            <div style={{ fontSize: 11, color: "var(--s-text-muted)" }}>{t("hint")}</div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "0.5px solid var(--s-border)",
          padding: "10px 12px",
          flexShrink: 0,
          display: "flex",
          gap: 8,
        }}
      >
        <textarea
          className="s-textarea"
          rows={2}
          placeholder={t("inputPlaceholder")}
          style={{ flex: 1, fontSize: 12, resize: "none" }}
        />
        <button
          type="button"
          className="s-btn s-btn-primary"
          style={{ alignSelf: "flex-end", height: 32, fontSize: 12, padding: "0 12px" }}
          disabled
        >
          {t("send")}
        </button>
      </div>
    </div>
    </div>
  );
}

// ─── One bubble ────────────────────────────────────────────────────────────

function Bubble({ message }: { message: AgentMessage }) {
  const t = useTranslations("agentPanel");
  const palette = paletteFor(message.kind);

  function copyRaw() {
    if (message.raw === undefined) return;
    const text =
      typeof message.raw === "string"
        ? message.raw
        : JSON.stringify(message.raw, null, 2);
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
        padding: "10px 12px",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Icon icon={palette.icon} size={12} />
        <span style={{ fontWeight: 500, color: palette.titleColor }}>{message.title}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "var(--s-text-tertiary)",
          }}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div style={{ color: "var(--s-text)", whiteSpace: "pre-wrap" }}>{message.body}</div>
      {message.raw !== undefined ? (
        <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={copyRaw}
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
      ) : null}
    </div>
  );
}

function paletteFor(kind: AgentMessage["kind"]) {
  switch (kind) {
    case "thinking":
      return {
        icon: Loader2,
        accent: "var(--scout-accent)",
        border: "var(--s-border)",
        titleColor: "var(--scout-accent-800)",
      };
    case "success":
      return {
        icon: CheckCircle2,
        accent: "var(--s-success)",
        border: "var(--s-border)",
        titleColor: "var(--s-success-text)",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        accent: "var(--s-warning)",
        border: "var(--s-border)",
        titleColor: "var(--s-warning-text)",
      };
    case "error":
      return {
        icon: XCircle,
        accent: "var(--s-danger)",
        border: "var(--s-border)",
        titleColor: "var(--s-danger-text)",
      };
    case "info":
    default:
      return {
        icon: Info,
        accent: "var(--s-text-tertiary)",
        border: "var(--s-border)",
        titleColor: "var(--s-text)",
      };
  }
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
