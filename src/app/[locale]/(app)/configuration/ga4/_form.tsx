"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChartLine,
  ExternalLink,
  Globe,
  RefreshCw,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Icon } from "@/components/ui/icon";
import { AlertThresholdsCard } from "./_alert-thresholds-card";
import {
  disconnectGa4,
  pullNowGa4,
  saveGa4PropertyId,
  testGa4Connection,
} from "./actions";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

type InitialValues = {
  propertyId?: string;
  oauthAccountEmail?: string;
  connectedAt?: string;
  lastPullAt?: string;
  lastPullStatus?: "ok" | "error";
  lastPullError?: string;
  lastPullLatencyMs?: number;
};

type Props = {
  initialValues: InitialValues;
  hasRefreshToken: boolean;
};

export function Ga4Form({ initialValues, hasRefreshToken }: Props) {
  const t = useTranslations("configuration.ga4");
  const params = useSearchParams();

  const [propertyId, setPropertyId] = useState(initialValues.propertyId ?? "");
  const [pending, startTransition] = useTransition();

  // Surface OAuth callback toasts (?error=… or ?connected=1)
  useEffect(() => {
    const err = params.get("error");
    if (err) {
      toast.error(t(`oauthErrors.${err}` as never), {
        description: t("oauthErrors.generic"),
      });
    } else if (params.get("connected") === "1") {
      toast.success(t("toast.connected"));
    }
  }, [params, t]);

  // ── Pre-connect: benefits panel + Connect CTA ─────────────────────────────
  if (!hasRefreshToken) {
    const benefits: Array<{ icon: typeof Activity; titleKey: string }> = [
      { icon: Activity, titleKey: "preConnect.benefits.realtime" },
      { icon: AlertTriangle, titleKey: "preConnect.benefits.alerts" },
      { icon: ChartLine, titleKey: "preConnect.benefits.trends" },
      { icon: Globe, titleKey: "preConnect.benefits.sources" },
    ];

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 640,
        }}
      >
        <p style={{ fontSize: 14, color: "var(--s-text-secondary)" }}>
          {t("preConnect.intro")}
        </p>

        <div
          style={{
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            padding: 16,
            background: "var(--s-surface-alt)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            {t("preConnect.benefitsTitle")}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {benefits.map((b, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  color: "var(--s-text)",
                }}
              >
                <div
                  style={{
                    color: "var(--scout-accent)",
                    flexShrink: 0,
                  }}
                >
                  <Icon icon={Check} size={14} />
                </div>
                <span>{t(b.titleKey)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /api/v1/* is an API route, not a Next page; <Link> is wrong here. */}
          <a href="/api/v1/integrations/ga4/auth">
            <Button type="button">
              <Icon icon={ExternalLink} size={14} />
              <span style={{ marginLeft: 6 }}>{t("actions.connect")}</span>
            </Button>
          </a>
        </div>

        <p style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
          {t("preConnect.helpText")}
        </p>
      </div>
    );
  }

  // ── Post-connect: status card + property ID + actions + thresholds ────────
  function onSavePropertyId() {
    if (!propertyId.trim()) {
      toast.error(t("toast.missingPropertyId"));
      return;
    }
    startTransition(async () => {
      const r = await saveGa4PropertyId({ propertyId });
      if (!r.ok) {
        toast.error(t("toast.saveFailed"), { description: r.error });
        return;
      }
      toast.success(t("toast.propertyIdSaved"));
    });
  }

  function onTest() {
    startTransition(async () => {
      const r = await testGa4Connection();
      if (r.ok) {
        toast.success(t("toast.testSuccess"), {
          description: `${r.latencyMs} ms`,
        });
      } else {
        toast.error(t("toast.testFailed"), { description: r.message });
      }
    });
  }

  function onPullNow() {
    startTransition(async () => {
      const r = await pullNowGa4();
      if (r.ok) {
        const total =
          r.rowsBySurface.session +
          r.rowsBySurface.traffic +
          r.rowsBySurface.page +
          r.rowsBySurface.geo +
          r.rowsBySurface.device;
        toast.success(t("toast.pullSuccess"), {
          description: t("toast.pullSummary", { rows: total }),
        });
      } else {
        toast.error(t("toast.pullFailed"), { description: r.error });
      }
    });
  }

  function onDisconnect() {
    if (!window.confirm(t("disconnect.confirm"))) return;
    startTransition(async () => {
      const r = await disconnectGa4();
      if (r.ok) toast.success(t("toast.disconnected"));
      else toast.error(t("toast.disconnectFailed"), { description: r.error });
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 640,
      }}
    >
      {/* Status card */}
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
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              background: "var(--s-success-bg)",
              color: "var(--s-success-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon icon={CheckCircle2} size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--s-text)",
              }}
            >
              {t("status.connected")}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}
            >
              {t("status.subtitle")}
            </div>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--s-success-bg)",
              color: "var(--s-success-text)",
            }}
          >
            {t("status.activeBadge")}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(120px, auto) 1fr",
            rowGap: 10,
            columnGap: 12,
            fontSize: 13,
            paddingTop: 12,
            borderTop: "0.5px solid var(--s-border)",
          }}
        >
          <div style={{ color: "var(--s-text-tertiary)" }}>
            {t("status.account")}
          </div>
          <div style={{ color: "var(--s-text)" }}>
            {initialValues.oauthAccountEmail || "—"}
          </div>

          <div style={{ color: "var(--s-text-tertiary)" }}>
            {t("status.property")}
          </div>
          <div
            style={{
              color: "var(--s-text)",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            {initialValues.propertyId
              ? `GA4-${initialValues.propertyId}`
              : t("status.noPropertyYet")}
          </div>

          <div style={{ color: "var(--s-text-tertiary)" }}>
            {t("status.lastSync")}
          </div>
          <div style={{ color: "var(--s-text-secondary)" }}>
            {initialValues.lastPullAt
              ? initialValues.lastPullStatus === "ok"
                ? t("status.lastPullOk", {
                    time: timeAgo(initialValues.lastPullAt),
                    latency: initialValues.lastPullLatencyMs ?? 0,
                  })
                : t("status.lastPullFailed", {
                    time: timeAgo(initialValues.lastPullAt),
                    error: initialValues.lastPullError ?? "",
                  })
              : t("status.neverPulled")}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "0.5px solid var(--s-border)",
          }}
        >
          <Button
            type="button"
            variant="outline"
            onClick={onPullNow}
            disabled={pending || !propertyId}
          >
            <Icon icon={RefreshCw} size={14} />
            <span style={{ marginLeft: 6 }}>{t("actions.pullNow")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={pending || !propertyId}
          >
            {t("actions.test")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDisconnect}
            disabled={pending}
          >
            <Icon icon={Unplug} size={14} />
            <span style={{ marginLeft: 6 }}>{t("actions.disconnect")}</span>
          </Button>
        </div>
      </div>

      {/* Property ID input (only relevant if not yet entered) */}
      <div
        style={{
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          padding: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
          {t("fields.propertyId")}
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--s-text-tertiary)",
            marginBottom: 12,
          }}
        >
          {t("fields.propertyIdHint")}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <FloatingLabelInput
              id="ga4-property-id"
              label={t("fields.propertyId")}
              placeholder="123456789"
              value={propertyId}
              onChange={(e) =>
                setPropertyId(e.target.value.replace(/[^0-9]/g, ""))
              }
              disabled={pending}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onSavePropertyId}
            disabled={pending}
          >
            {t("actions.savePropertyId")}
          </Button>
        </div>
      </div>

      {/* Locked alert thresholds */}
      <AlertThresholdsCard />
    </div>
  );
}
