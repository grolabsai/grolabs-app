import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import {
  ENGAGEMENT_DROP_ABS,
  SESSIONS_THRESHOLD_PCT,
  SHARE_SHIFT_ABS,
} from "@/lib/integrations/ga4/constants";

/**
 * Read-only display of the locked alert thresholds.
 *
 * Per docs/policy/ga4-integration.md §13.3 thresholds are locked in v1;
 * merchant-configurable values are v3. The mockup shows editable inputs but
 * we render values + a v3 footnote instead.
 */
export function AlertThresholdsCard() {
  const t = useTranslations("configuration.ga4.thresholds");

  const rows: { labelKey: string; value: string }[] = [
    {
      labelKey: "sessionsLabel",
      value: `±${(SESSIONS_THRESHOLD_PCT * 100).toFixed(0)}%`,
    },
    {
      labelKey: "engagementLabel",
      value: `−${(ENGAGEMENT_DROP_ABS * 100).toFixed(0)}pp`,
    },
    {
      labelKey: "trafficShareLabel",
      value: `>${(SHARE_SHIFT_ABS * 100).toFixed(0)}pp`,
    },
  ];

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
          marginBottom: 6,
        }}
      >
        <Icon icon={Bell} size={14} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>{t("title")}</div>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--s-text-secondary)",
          marginBottom: 16,
        }}
      >
        {t("description")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.labelKey}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              fontSize: 13,
            }}
          >
            <div style={{ color: "var(--s-text)" }}>{t(r.labelKey)}</div>
            <div
              style={{
                fontFamily: "monospace",
                color: "var(--s-text-secondary)",
              }}
            >
              {r.value}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: 11,
          color: "var(--s-text-tertiary)",
          marginTop: 12,
        }}
      >
        {t("v3Footnote")}
      </p>
    </div>
  );
}
