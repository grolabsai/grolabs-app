"use client";

import { useEffect, useRef } from "react";
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
import { useAgentPanel } from "@/components/shell/AgentPanelContext";
import { useFieldHintState } from "@/components/shell/FieldHintContext";
import { Icon } from "@/components/ui/icon";
import type { AgentMessage } from "@/lib/import/types";

/**
 * Right-side Assistant panel — global, shared across the app. Renders the
 * agent narrative log fed by `useAgentLog().append(...)`. Today the only
 * pusher is the import wizard; future features can push too without
 * touching this component.
 *
 * Collapsible to a rail; the user's collapse state and dragged width both
 * persist in localStorage (see `AgentPanelContext`). When expanded, shows
 * messages chronologically (oldest top, newest bottom). Each message can
 * carry a structured `raw` payload that the user can copy verbatim — useful
 * for sharing exact agent responses back to support.
 *
 * The panel auto-opens whenever a new message is logged, so errors routed
 * here (instead of to a fleeting toast) are never missed.
 */
export function AgentPanel() {
  const t = useTranslations("agentPanel");
  const { messages, clear } = useAgentLog();
  const { collapsed, mounted, width, toggle, open, setWidth } = useAgentPanel();
  const { active: fieldHint } = useFieldHintState();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-open the panel when a new message lands so it can't be missed.
  const prevCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevCount.current && collapsed) open();
    prevCount.current = messages.length;
  }, [messages.length, collapsed, open]);

  // Auto-scroll to newest message on expand or when a message lands.
  useEffect(() => {
    if (collapsed) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, collapsed]);

  // ── Divider drag: resize the panel by dragging its left edge ───────────────
  const dragging = useRef(false);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      // Panel hugs the right edge, so its width is the gap from the cursor
      // to the viewport's right edge.
      setWidth(window.innerWidth - e.clientX);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setWidth]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
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
            border: "1px solid var(--gl-border)",
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
              color: "var(--gl-text-tertiary)",
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
                background: "var(--gl-accent)",
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
        width,
        flexShrink: 0,
        padding: "24px 24px 24px 0",
        display: "flex",
        position: "relative",
      }}
    >
      {/* Drag handle — resize the panel by dragging its left edge. */}
      <div
        onMouseDown={startDrag}
        title={t("resizeHint")}
        style={{
          position: "absolute",
          left: -3,
          top: 24,
          bottom: 24,
          width: 10,
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <span
          style={{
            width: 3,
            height: 36,
            borderRadius: 3,
            background: "var(--gl-border)",
          }}
        />
      </div>
    <div
      style={{
        flex: 1,
        background: "#ffffff",
        border: "1px solid var(--gl-border)",
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
          borderBottom: "0.5px solid var(--gl-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--gl-success)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--gl-text-secondary)",
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
              color: "var(--gl-text-tertiary)",
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
            color: "var(--gl-text-tertiary)",
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 4px",
            fontFamily: "var(--gl-font)",
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
          padding: "10px 10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Field-hint card: shown when an input has focus elsewhere on
            the page. Yellow background always — same look in dark and
            light themes. Replaces the in-input "?" icon pattern. */}
        {fieldHint && <FieldHintCard hint={fieldHint} />}

        {!fieldHint && messages.length === 0 ? (
          <div
            style={{
              background: "var(--gl-surface)",
              border: "0.5px solid var(--gl-border)",
              borderRadius: "var(--gl-radius-md)",
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--gl-text-tertiary)", marginBottom: 4 }}>
              {t("noActivity")}
            </div>
            <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>{t("hint")}</div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "0.5px solid var(--gl-border)",
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

// ─── Field hint card ──────────────────────────────────────────────────────
// Yellow background in both themes. Appears at the top of the agent panel
// when an input on the page has focus; vanishes on blur. Replaces the
// in-input "?" affordance with a roomier surface that can carry multi-
// line copy.

function FieldHintCard({ hint }: { hint: { label: string; body: string } }) {
  return (
    <div
      style={{
        background: "#fae194", // GL always-yellow — not theme-aware
        color: "#131316", // dark text on yellow for contrast in both themes
        borderRadius: "var(--gl-radius-md)",
        padding: "14px 16px",
        boxShadow: "0 6px 24px rgba(250, 225, 148, 0.18)",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.3,
          marginBottom: 8,
        }}
      >
        {hint.label}
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {hint.body}
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
        background: "var(--gl-surface)",
        border: `0.5px solid ${palette.border}`,
        borderLeft: `2px solid ${palette.accent}`,
        borderRadius: "var(--gl-radius-md)",
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
            color: "var(--gl-text-tertiary)",
          }}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div style={{ color: "var(--gl-text)", whiteSpace: "pre-wrap" }}>{message.body}</div>
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
              color: "var(--gl-text-secondary)",
              background: "transparent",
              border: "0.5px solid var(--gl-border)",
              borderRadius: "var(--gl-radius-sm)",
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
        accent: "var(--gl-accent)",
        border: "var(--gl-border)",
        titleColor: "var(--gl-accent-800)",
      };
    case "success":
      return {
        icon: CheckCircle2,
        accent: "var(--gl-success)",
        border: "var(--gl-border)",
        titleColor: "var(--gl-success-text)",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        accent: "var(--gl-warning)",
        border: "var(--gl-border)",
        titleColor: "var(--gl-warning-text)",
      };
    case "error":
      return {
        icon: XCircle,
        accent: "var(--gl-danger)",
        border: "var(--gl-border)",
        titleColor: "var(--gl-danger-text)",
      };
    case "info":
    default:
      return {
        icon: Info,
        accent: "var(--gl-text-tertiary)",
        border: "var(--gl-border)",
        titleColor: "var(--gl-text)",
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
