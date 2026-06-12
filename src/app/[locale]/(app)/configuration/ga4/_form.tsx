"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, Unplug, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
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

  // OAuth callback toasts
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

  // ── Pre-connect: render CTA only ────────────────────────────────────────
  if (!hasRefreshToken) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <p style={{ fontSize: 14, color: "var(--gl-text-secondary)" }}>
          {t("preConnect.intro")}
        </p>
        <ul style={{ fontSize: 13, color: "var(--gl-text-secondary)", paddingLeft: 18 }}>
          <li>{t("preConnect.bulletDaily")}</li>
          <li>{t("preConnect.bulletAlerts")}</li>
          <li>{t("preConnect.bulletRealtime")}</li>
        </ul>
        <div>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /api/v1/* is an API route, not a Next page; <Link> is wrong here. */}
          <a href="/api/v1/integrations/ga4/auth">
            <Button type="button">
              <ExternalLink size={16} />
              <span style={{ marginLeft: 6 }}>{t("actions.connect")}</span>
            </Button>
          </a>
        </div>
      </div>
    );
  }

  // ── Post-connect: status panel + property ID + actions ──────────────────
  const lastPull = initialValues.lastPullAt;
  const lastOk = initialValues.lastPullStatus === "ok";

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
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      {/* Connection status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: "var(--gl-radius-md)",
          background: "var(--gl-success-bg)",
          color: "var(--gl-success-text)",
          fontSize: 12,
        }}
      >
        <CheckCircle2 size={14} />
        <span>{t("postConnect.stepBadge")}</span>
        {initialValues.oauthAccountEmail ? (
          <span style={{ color: "var(--gl-text-secondary)" }}>
            · {initialValues.oauthAccountEmail}
          </span>
        ) : null}
      </div>

      {/* Two-step framing: account is connected (step 1); choosing the property is step 2 */}
      <p style={{ fontSize: 13, color: "var(--gl-text-secondary)", margin: 0 }}>
        {t("postConnect.intro")}
      </p>

      {/* Step 2 — Property ID */}
      <div>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--gl-text-strong)",
            margin: "0 0 8px",
          }}
        >
          {t("postConnect.step2Heading")}
        </p>
        <FloatingLabelInput
          id="ga4-property-id"
          label={t("fields.propertyId")}
          placeholder="123456789"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value.replace(/[^0-9]/g, ""))}
          disabled={pending}
        />
        <p style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginTop: 4 }}>
          {t("fields.propertyIdHint")}
        </p>
        <div style={{ marginTop: 8 }}>
          <Button
            type="button"
            variant="outline"
            onClick={onSavePropertyId}
            disabled={pending}
          >
            {t("actions.savePropertyId")}
          </Button>
        </div>

        {/* How to find the property ID — visible at the moment of need */}
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            border: "0.5px solid var(--gl-border)",
            borderRadius: "var(--gl-radius-md)",
            background: "var(--gl-surface)",
          }}
        >
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--gl-text-strong)",
              margin: "0 0 8px",
            }}
          >
            {t("postConnect.howToTitle")}
          </p>
          <ol
            style={{
              fontSize: 12,
              color: "var(--gl-text-secondary)",
              margin: 0,
              paddingLeft: 18,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <li>{t("postConnect.howToStep1")}</li>
            <li>{t("postConnect.howToStep2")}</li>
            <li>{t("postConnect.howToStep3")}</li>
            <li>{t("postConnect.howToStep4")}</li>
          </ol>
          <p
            style={{
              fontSize: 12,
              color: "var(--gl-warning-text)",
              margin: "8px 0 0",
            }}
          >
            {t("postConnect.howToWarning")}
          </p>
          <div style={{ marginTop: 10 }}>
            <a
              href="https://analytics.google.com/analytics/web/#/admin"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--gl-accent)",
              }}
            >
              <ExternalLink size={14} />
              {t("postConnect.openAnalytics")}
            </a>
          </div>
        </div>
      </div>

      {/* Last pull */}
      <div
        style={{
          padding: "10px 12px",
          border: "0.5px solid var(--gl-border)",
          borderRadius: "var(--gl-radius-md)",
          fontSize: 12,
          color: "var(--gl-text-secondary)",
        }}
      >
        {lastPull ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastOk ? (
              <CheckCircle2 size={14} color="var(--gl-success-text)" />
            ) : (
              <XCircle size={14} color="var(--gl-danger-text)" />
            )}
            <span>
              {lastOk
                ? t("status.lastPullOk", {
                    time: timeAgo(lastPull),
                    latency: initialValues.lastPullLatencyMs ?? 0,
                  })
                : t("status.lastPullFailed", {
                    time: timeAgo(lastPull),
                    error: initialValues.lastPullError ?? "",
                  })}
            </span>
          </div>
        ) : (
          <span>{t("status.neverPulled")}</span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
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
          onClick={onPullNow}
          disabled={pending || !propertyId}
        >
          <RefreshCw size={14} />
          <span style={{ marginLeft: 6 }}>{t("actions.pullNow")}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDisconnect}
          disabled={pending}
        >
          <Unplug size={14} />
          <span style={{ marginLeft: 6 }}>{t("actions.disconnect")}</span>
        </Button>
      </div>
    </div>
  );
}
