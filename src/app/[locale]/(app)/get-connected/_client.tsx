"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Globe, Code2, ArrowLeft } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/**
 * Platform chooser + guide renderer. The decision comes FIRST and gates
 * everything: only the chosen track's instructions are shown. The choice is
 * remembered per browser (localStorage) so returning users land back in
 * their track; it is NOT yet persisted to the instance — that lands with the
 * onboarding-checklist iteration (M3), which will want it server-side.
 */

type Platform = "wordpress" | "proprietary";
const STORAGE_KEY = "grolabs_get_connected_platform";
const CHANGE_EVENT = "grolabs:get-connected-platform";

// localStorage as an external store (useSyncExternalStore, same pattern as
// the Sidebar's persisted state) — avoids setState-in-effect and renders the
// saved choice without a hydration mismatch (server snapshot is null → the
// chooser; the client snapshot swaps in the saved track post-hydration).
function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}
function getSnapshot(): Platform | null {
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "wordpress" || v === "proprietary" ? v : null;
}
function getServerSnapshot(): Platform | null {
  return null;
}

export function GetConnectedClient({
  intro,
  wordpress,
  proprietary,
}: {
  intro: string;
  wordpress: string;
  proprietary: string;
}) {
  const t = useTranslations("getConnected");
  const platform = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const choose = useCallback((p: Platform) => {
    window.localStorage.setItem(STORAGE_KEY, p);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  const reset = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  if (platform === null) {
    return (
      <div>
        <div className="prose prose-sm max-w-none gl-guide-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <PlatformCard
            icon={<Icon icon={Globe} size={20} />}
            title={t("chooser.wordpressTitle")}
            body={t("chooser.wordpressBody")}
            cta={t("chooser.choose")}
            onClick={() => choose("wordpress")}
          />
          <PlatformCard
            icon={<Icon icon={Code2} size={20} />}
            title={t("chooser.proprietaryTitle")}
            body={t("chooser.proprietaryBody")}
            cta={t("chooser.choose")}
            onClick={() => choose("proprietary")}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={reset}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          background: "transparent",
          border: "none",
          color: "var(--gl-accent)",
          cursor: "pointer",
          padding: 0,
          marginBottom: 16,
        }}
      >
        <Icon icon={ArrowLeft} size={12} />
        {t("changePlatform")}
      </button>
      <div className="prose prose-sm max-w-none gl-guide-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {platform === "wordpress" ? wordpress : proprietary}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function PlatformCard({
  icon,
  title,
  body,
  cta,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "1 1 280px",
        textAlign: "left",
        padding: 20,
        borderRadius: "var(--gl-radius-md)",
        border: "0.5px solid var(--gl-border-strong)",
        background: "var(--gl-surface)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 15 }}>
        {icon}
        {title}
      </div>
      <div style={{ fontSize: 13, color: "var(--gl-text-secondary)", lineHeight: 1.5 }}>{body}</div>
      <div style={{ fontSize: 13, color: "var(--gl-accent)", marginTop: 4 }}>{cta} →</div>
    </button>
  );
}
