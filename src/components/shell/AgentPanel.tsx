"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

export function AgentPanel() {
  const t = useTranslations("agentPanel");
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

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
            background: "var(--s-text-muted)",
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--s-text)" }}>
          {t("title")}
        </span>
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
          title="Colapsar"
        >
          ›
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
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
  );
}
