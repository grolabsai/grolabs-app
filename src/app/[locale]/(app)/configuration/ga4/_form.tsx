"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/agent-toast";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Unplug,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Icon } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { FloatingLabelSelect } from "@/components/ui/floating-label-select";
import type { Ga4PropertySummary } from "@/lib/integrations/ga4/client";
import {
  disconnectGa4,
  listGa4Properties,
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
  needsReauth?: boolean;
  reauthReason?: string;
};

type Props = {
  initialValues: InitialValues;
  hasRefreshToken: boolean;
  /** Instance this screen is configuring — shown so the user can never
   *  mistake which site they are connecting. */
  instanceName: string;
  /** Properties the stored token can reach, resolved server-side. `null`
   *  means "couldn't list them" — the form falls back to manual entry. */
  initialProperties: Ga4PropertySummary[] | null;
  /** Why the list couldn't be fetched, shown verbatim so a failure is
   *  diagnosable instead of looking like "there is no picker". */
  propertyError?: string;
};

export function Ga4Form({
  initialValues,
  hasRefreshToken,
  instanceName,
  initialProperties,
  propertyError,
}: Props) {
  const t = useTranslations("configuration.ga4");
  const params = useSearchParams();

  const [propertyId, setPropertyId] = useState(initialValues.propertyId ?? "");
  const [pending, startTransition] = useTransition();

  // ── Property picker state ───────────────────────────────────────────────
  // Seeded from the server. `null` means the list couldn't be fetched; the
  // manual numeric field is the fallback so the screen is never a dead end.
  const [properties, setProperties] = useState<Ga4PropertySummary[] | null>(
    initialProperties,
  );
  const [loadingProps, setLoadingProps] = useState(false);
  // Start in manual mode when there is nothing to pick from.
  const [manualEntry, setManualEntry] = useState(
    initialProperties === null || initialProperties.length === 0,
  );

  /** Retry the list on demand — an event handler, so no effect is involved. */
  function loadProperties() {
    setLoadingProps(true);
    startTransition(async () => {
      const r = await listGa4Properties();
      setLoadingProps(false);
      if (r.ok && r.properties.length > 0) {
        setProperties(r.properties);
        setManualEntry(false);
      } else {
        setProperties(null);
        setManualEntry(true);
        toast.error(t("toast.propertyListFailed"), {
          description: r.ok ? undefined : r.error,
        });
      }
    });
  }

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

  // ── Reconnect needed: the stored token is dead ──────────────────────────
  // Distinct from both healthy and never-connected. property_id and history
  // are preserved — reconnecting restores the setup, it does not rebuild it.
  if (hasRefreshToken && initialValues.needsReauth) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: "var(--gl-radius-md)",
            background: "var(--gl-warning-bg)",
            color: "var(--gl-warning-text)",
            fontSize: 12,
          }}
        >
          <Icon icon={AlertTriangle} size={14} />
          <span>{t("reauth.badge")}</span>
        </div>
        <p style={{ fontSize: 14, color: "var(--gl-text-secondary)", margin: 0 }}>
          {t("reauth.body", { instance: instanceName })}
        </p>
        <p style={{ fontSize: 13, color: "var(--gl-text-secondary)", margin: 0 }}>
          {t("reauth.anyAccount")}
        </p>
        {initialValues.reauthReason ? (
          <p style={{ fontSize: 11, color: "var(--gl-text-tertiary)", margin: 0 }}>
            {initialValues.reauthReason}
          </p>
        ) : null}
        <div>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /api/v1/* is an API route, not a Next page. */}
          <a href="/api/v1/integrations/ga4/auth">
            <Button type="button">
              <Icon icon={ExternalLink} size={16} />
              <span style={{ marginLeft: 6 }}>{t("actions.reconnect")}</span>
            </Button>
          </a>
        </div>
      </div>
    );
  }

  // ── Pre-connect: render CTA only ────────────────────────────────────────
  if (!hasRefreshToken) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <p style={{ fontSize: 13, color: "var(--gl-text-tertiary)", margin: 0 }}>
          {t("preConnect.forInstance", { instance: instanceName })}
        </p>
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
              <Icon icon={ExternalLink} size={16} />
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
    // Changing to a DIFFERENT property discards stored history — every saved
    // row belongs to the old property, and blending two sites into one
    // dashboard would be worse than the problem the picker solves. Confirm
    // explicitly; a first-time set or a re-save of the same id passes through.
    const previous = initialValues.propertyId ?? "";
    if (previous && previous !== propertyId.trim()) {
      if (!window.confirm(t("propertyChange.confirm"))) return;
    }
    startTransition(async () => {
      const r = await saveGa4PropertyId({ propertyId });
      if (!r.ok) {
        toast.error(t("toast.saveFailed"), { description: r.error });
        return;
      }
      toast.success(t("toast.propertyIdSaved"));
      if (r.purgedRows && r.purgedRows > 0) {
        toast.success(t("toast.historyDiscarded", { rows: r.purgedRows }));
      }
      // Saving also pulls data immediately — report what came back.
      if (r.pull?.ok) {
        toast.success(t("toast.pullSuccess"), {
          description: t("toast.pullSummary", { rows: r.pull.rows }),
        });
      } else if (r.pull && !r.pull.ok) {
        toast.error(t("toast.pullFailed"), { description: r.pull.error });
      }
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
        <Icon icon={CheckCircle2} size={14} />
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
        {/* Picker when we could list properties; manual numeric entry as the
            fallback (list call failed, no properties, or user opted out). */}
        {properties !== null && properties.length > 0 && !manualEntry ? (
          <>
            <FloatingLabelSelect
              id="ga4-property-id"
              label={t("fields.property")}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              disabled={pending || loadingProps}
            >
              <option value="" />
              {properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.accountName
                    ? `${p.accountName} — ${p.displayName} (#${p.propertyId})`
                    : `${p.displayName} (#${p.propertyId})`}
                </option>
              ))}
            </FloatingLabelSelect>
            <button
              type="button"
              onClick={() => setManualEntry(true)}
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--gl-text-tertiary)",
                textDecoration: "underline",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              {t("fields.enterManually")}
            </button>
          </>
        ) : (
          <>
            <FloatingLabelInput
              id="ga4-property-id"
              label={t("fields.propertyId")}
              value={propertyId}
              onChange={(e) =>
                setPropertyId(e.target.value.replace(/[^0-9]/g, ""))
              }
              disabled={pending}
            />
            <p
              style={{
                fontSize: 11,
                color: "var(--gl-text-tertiary)",
                marginTop: 4,
              }}
            >
              {t("fields.propertyIdHint")}
            </p>
            {propertyError ? (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--gl-warning-text)",
                  marginTop: 6,
                  wordBreak: "break-word",
                }}
              >
                {t("fields.listUnavailable")} {propertyError}
              </p>
            ) : null}
            {properties !== null && properties.length > 0 ? (
              <button
                type="button"
                onClick={() => setManualEntry(false)}
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--gl-text-tertiary)",
                  textDecoration: "underline",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {t("fields.chooseFromList")}
              </button>
            ) : (
              <button
                type="button"
                onClick={loadProperties}
                disabled={pending || loadingProps}
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--gl-text-tertiary)",
                  textDecoration: "underline",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {loadingProps
                  ? t("fields.loadingProperties")
                  : t("fields.retryList")}
              </button>
            )}
          </>
        )}
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={onSavePropertyId}
            disabled={pending}
          >
            {t("actions.savePropertyId")}
          </button>
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
              <Icon icon={ExternalLink} size={14} />
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
              <Icon icon={CheckCircle2} size={14} color="var(--gl-success-text)" />
            ) : (
              <Icon icon={XCircle} size={14} color="var(--gl-danger-text)" />
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
          <Icon icon={RefreshCw} size={14} />
          <span style={{ marginLeft: 6 }}>{t("actions.pullNow")}</span>
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
  );
}
