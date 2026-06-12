"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/agent-toast";
import { pullNowGa4 } from "@/app/[locale]/(app)/configuration/ga4/actions";

/**
 * Refresh button on the traffic dashboard header. The dashboard reads stored
 * data, so reloading the page never fetches from GA4 — this button triggers an
 * actual pull (same server action as Configuration → GA4 → "Pull now"), then
 * refreshes the route so the freshly-stored rows render. Result is reported in
 * the Assistant panel.
 */
export function DashboardPullButton() {
  const t = useTranslations("dashboard.traffic.actions");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const r = await pullNowGa4();
      if (r.ok) {
        const rows =
          r.rowsBySurface.session +
          r.rowsBySurface.traffic +
          r.rowsBySurface.page +
          r.rowsBySurface.geo +
          r.rowsBySurface.device;
        toast.success(t("pullSuccess"), { description: t("pullRows", { rows }) });
        router.refresh();
      } else {
        toast.error(t("pullFailed"), { description: r.error ?? "" });
      }
    });
  }

  return (
    <button
      type="button"
      className="s-btn s-btn-primary"
      onClick={onClick}
      disabled={pending}
      style={{ height: 32, fontSize: 12, padding: "0 12px" }}
    >
      <RefreshCw size={14} className={pending ? "animate-spin" : undefined} />
      <span style={{ marginLeft: 6 }}>{pending ? t("refreshing") : t("refresh")}</span>
    </button>
  );
}
