"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Icon } from "@/components/ui/icon";

const NEW_INSTANCE_BANNER_KEY = "grolabs:new-instance-banner";

/**
 * One-shot banner shown right after a new instance is created and switched
 * into. CreateInstanceDialog writes the new instance id to sessionStorage;
 * this reads it on mount and shows the banner only while that instance is
 * current. Dismissing (or switching away) clears it.
 */
export function NewInstanceBanner({
  currentInstanceId,
}: {
  currentInstanceId: number | null;
}) {
  const t = useTranslations("shell.instanceSwitcher");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (currentInstanceId == null) return;
    let flagged: string | null = null;
    try {
      flagged = sessionStorage.getItem(NEW_INSTANCE_BANNER_KEY);
    } catch {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(flagged != null && Number(flagged) === currentInstanceId);
  }, [currentInstanceId]);

  function dismiss() {
    try {
      sessionStorage.removeItem(NEW_INSTANCE_BANNER_KEY);
    } catch {
      // best-effort
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      className="mb-4 flex items-center justify-between gap-3 rounded-[var(--s-radius-md)] px-4 py-2.5 text-[13px]"
      style={{
        background: "var(--s-surface-alt)",
        border: "0.5px solid var(--s-border)",
        color: "var(--s-text-secondary)",
      }}
    >
      <span>{t("emptyCatalogBanner")}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismissBanner")}
        className="flex items-center justify-center rounded-[var(--s-radius-sm)] p-1 hover:bg-[var(--s-surface)]"
        style={{ color: "var(--s-text-tertiary)" }}
      >
        <Icon icon={X} size={12} />
      </button>
    </div>
  );
}
