"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acknowledgeAlert } from "@/app/[locale]/(app)/dashboard/traffic/actions";
import type { Ga4Alert } from "@/lib/integrations/ga4/types";

/**
 * Inbox-style listing of firing alerts with Confirmar / Ver configuración
 * buttons. Used at the bottom of the Resumen tab and on the Traffic Detail
 * page. Shows an empty-state when nothing is firing.
 */
export function AlertsInbox({
  alerts,
  describe,
  timeAgo,
}: {
  alerts: Ga4Alert[];
  describe: (a: Ga4Alert) => { headline: string; detail: string };
  timeAgo: (iso: string) => string;
}) {
  const t = useTranslations("dashboard.alerts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onAck(id: number) {
    startTransition(async () => {
      const r = await acknowledgeAlert(id);
      if (r.ok) {
        toast.success(t("acknowledged"));
        router.refresh();
      } else {
        toast.error(t("acknowledgeFailed"), { description: r.error });
      }
    });
  }

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500 }}>{t("inboxTitle")}</div>
        {alerts.length > 0 ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 18,
              height: 18,
              padding: "0 6px",
              borderRadius: 999,
              background: "var(--s-danger)",
              color: "white",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {alerts.length}
          </span>
        ) : null}
      </div>

      {alerts.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: "24px 0",
            color: "var(--s-text-tertiary)",
          }}
        >
          <Icon icon={CheckCircle2} size={24} />
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--s-text-secondary)" }}>
            {t("emptyTitle")}
          </div>
          <div style={{ fontSize: 12 }}>{t("emptyDescription")}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {alerts.map((a) => {
            const d = describe(a);
            return (
              <div
                key={a.alert_id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: 12,
                  border: "0.5px solid var(--s-border)",
                  borderLeft: "3px solid var(--s-danger)",
                  borderRadius: "var(--s-radius-md)",
                }}
              >
                <div
                  style={{
                    color: "var(--s-danger)",
                    paddingTop: 2,
                    flexShrink: 0,
                  }}
                >
                  <Icon icon={AlertTriangle} size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--s-text)",
                    }}
                  >
                    {d.headline}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--s-text-secondary)",
                      marginTop: 4,
                    }}
                  >
                    {d.detail}
                  </div>
                  <div
                    style={{ display: "flex", gap: 8, marginTop: 10 }}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onAck(a.alert_id)}
                      disabled={pending}
                    >
                      {t("acknowledge")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/configuration/ga4")}
                    >
                      {t("viewConfig")}
                    </Button>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--s-text-tertiary)",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {timeAgo(a.fired_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
