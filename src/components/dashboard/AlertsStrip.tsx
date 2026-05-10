import { AlertTriangle } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { Ga4Alert } from "@/lib/integrations/ga4/types";

/**
 * White card with a red left border listing currently-firing alerts.
 * Per the mockup: shown at the top of the Resumen tab when alerts are
 * active. Renders nothing when the alerts list is empty.
 *
 * For the inbox-style version with Confirmar/Ver configuración buttons,
 * use AlertsInbox instead.
 */
export function AlertsStrip({
  alerts,
  title,
  describe,
  timeAgo,
}: {
  alerts: Ga4Alert[];
  title: string;
  describe: (a: Ga4Alert) => { headline: string; detail: string };
  timeAgo: (iso: string) => string;
}) {
  if (alerts.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderLeft: "3px solid var(--s-danger)",
        borderRadius: "var(--s-radius-md)",
        padding: "14px 16px",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{ fontSize: 13, fontWeight: 500, color: "var(--s-text)" }}
        >
          {title}
        </div>
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
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {alerts.map((a) => {
          const d = describe(a);
          return (
            <div
              key={a.alert_id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
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
                    marginTop: 2,
                  }}
                >
                  {d.detail}
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
    </div>
  );
}
