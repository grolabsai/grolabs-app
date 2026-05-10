import { getTranslations } from "next-intl/server";
import {
  Activity,
  AlertTriangle,
  ChartLine,
  ExternalLink,
  Globe,
} from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";

/**
 * Shown on /dashboard/traffic when GA4 is not connected.
 * Mirrors the Traffic Empty State mockup: breadcrumb + headline + 4 benefits
 * + CTA pointing to /configuration/ga4.
 */
export async function TrafficEmptyState() {
  const t = await getTranslations("traffic.emptyState");

  const benefits: Array<{ icon: typeof Activity; titleKey: string; descKey: string }> = [
    { icon: Activity, titleKey: "benefit1.title", descKey: "benefit1.description" },
    { icon: AlertTriangle, titleKey: "benefit2.title", descKey: "benefit2.description" },
    { icon: ChartLine, titleKey: "benefit3.title", descKey: "benefit3.description" },
    { icon: Globe, titleKey: "benefit4.title", descKey: "benefit4.description" },
  ];

  return (
    <div className="s-page-content">
      <div
        style={{
          fontSize: 12,
          color: "var(--s-text-tertiary)",
          marginBottom: 16,
        }}
      >
        <Link
          href="/dashboard"
          style={{ color: "var(--s-text-secondary)", textDecoration: "none" }}
        >
          Dashboard
        </Link>
        <span style={{ margin: "0 6px" }}>›</span>
        <span>{t("breadcrumb")}</span>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            marginBottom: 4,
            letterSpacing: "-0.02em",
          }}
        >
          {t("pageTitle")}
        </h1>
        <div style={{ fontSize: 13, color: "var(--s-text-secondary)" }}>
          {t("pageSubtitle")}
        </div>
      </div>

      <div
        style={{
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          padding: 40,
          maxWidth: 720,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            margin: "0 auto 20px",
            borderRadius: "50%",
            background: "var(--scout-accent-50)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--scout-accent)",
          }}
        >
          <Icon icon={ChartLine} size={28} />
        </div>

        <h2
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "var(--s-text)",
            marginBottom: 8,
          }}
        >
          {t("title")}
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "var(--s-text-secondary)",
            marginBottom: 28,
            maxWidth: 480,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {t("description")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 16,
            margin: "0 auto 28px",
            maxWidth: 560,
            textAlign: "left",
          }}
        >
          {benefits.map((b, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: 12,
                border: "0.5px solid var(--s-border)",
                borderRadius: "var(--s-radius-md)",
              }}
            >
              <div
                style={{
                  color: "var(--scout-accent)",
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                <Icon icon={b.icon} size={16} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--s-text)",
                    marginBottom: 2,
                  }}
                >
                  {t(b.titleKey)}
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--s-text-secondary)" }}
                >
                  {t(b.descKey)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <Link href="/configuration/ga4">
          <Button type="button">
            <Icon icon={ExternalLink} size={14} />
            <span style={{ marginLeft: 6 }}>{t("cta")}</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
