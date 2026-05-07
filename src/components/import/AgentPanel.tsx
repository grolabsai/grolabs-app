"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  MessageSquare,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useWizard } from "@/components/import/WizardContext";
import { Icon } from "@/components/ui/icon";
import type { AgentMessage } from "@/lib/import/types";

/**
 * Right-side narrative panel for the wizard.
 *
 * Surfaces the agent's responses chronologically — what's happening, what
 * came back, what failed. Each message can carry a structured payload the
 * user can copy to share verbatim. Today this is one-way (system → user);
 * the data shape is intentionally chat-like so a future iteration can add
 * user-side messages without a model migration.
 */
export function AgentPanel() {
  const t = useTranslations("import.wizard.agentPanel");
  const { state, dispatch } = useWizard();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message when one lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.agentMessages.length]);

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 480,
        background: "var(--s-surface-alt)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "0.5px solid var(--s-border)",
          background: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon icon={MessageSquare} size={14} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{t("title")}</span>
        </div>
        {state.agentMessages.length > 0 ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "CLEAR_AGENT_MESSAGES" })}
            style={{
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {t("clear")}
          </button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {state.agentMessages.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {t("emptyState")}
          </div>
        ) : (
          state.agentMessages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>
    </aside>
  );
}

// ─── One bubble ────────────────────────────────────────────────────────────

function Bubble({ message }: { message: AgentMessage }) {
  const t = useTranslations("import.wizard.agentPanel");
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
        background: "white",
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
        <span style={{ fontWeight: 500, color: palette.titleColor }}>
          {message.title}
        </span>
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

// ─── Helpers ───────────────────────────────────────────────────────────────

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
