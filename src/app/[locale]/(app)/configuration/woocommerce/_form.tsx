"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Eye, EyeOff, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import {
  saveWooCommerceConfig,
  testWooCommerceConnection,
  detectWooCommerceFieldSinks,
} from "./actions";
import type {
  FieldDetectionReport,
  SinkScore,
} from "@/lib/sync/woocommerce-field-detection";

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
  siteUrl: string;
  consumerKey: string;
  lastVerifiedAt?: string;
  lastHttpStatus?: number;
  lastVerifiedLatencyMs?: number;
};

type Props = {
  instanceId: number;
  initialValues: InitialValues;
  hasConsumerSecret: boolean;
  initialFieldSinks: FieldDetectionReport | null;
};

export function WooCommerceForm({
  instanceId,
  initialValues,
  hasConsumerSecret,
  initialFieldSinks,
}: Props) {
  const t = useTranslations("configuration.woocommerce");

  const [siteUrl, setSiteUrl] = useState(initialValues.siteUrl);
  const [consumerKey, setConsumerKey] = useState(initialValues.consumerKey);

  // Consumer secret behaves like Algolia's admin key — hidden when on file,
  // user clicks Replace to set a new one.
  const [editSecret, setEditSecret] = useState(!hasConsumerSecret);
  const [consumerSecret, setConsumerSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const [pending, startTransition] = useTransition();
  const [verifyState, setVerifyState] = useState<{
    ok: boolean;
    status: number;
    latencyMs: number;
    message?: string;
  } | null>(null);
  const [detectPending, startDetectTransition] = useTransition();
  const [fieldSinks, setFieldSinks] = useState<FieldDetectionReport | null>(
    initialFieldSinks,
  );

  const canTest =
    siteUrl.trim() && consumerKey.trim() && (editSecret ? consumerSecret.trim() : hasConsumerSecret);

  function onTest() {
    if (!canTest) return;
    startTransition(async () => {
      const secret = editSecret ? consumerSecret : "";
      // Reuse the saved one for the test — otherwise we'd need a separate path.
      // The simplest UX: ask the user to save first if they only typed URL/key.
      if (!secret && hasConsumerSecret) {
        toast.error(t("toast.testNeedsSecret"));
        return;
      }
      const r = await testWooCommerceConnection(siteUrl, consumerKey, secret || consumerSecret);
      setVerifyState(r);
      if (r.ok) toast.success(t("toast.testSuccess"));
      else toast.error(t("toast.testFailed"), { description: r.message });
    });
  }

  function onDetect() {
    startDetectTransition(async () => {
      const r = await detectWooCommerceFieldSinks(instanceId);
      if (!r.ok) {
        toast.error(t("toast.detectFailed"), { description: r.error });
        return;
      }
      setFieldSinks(r.report);
      toast.success(t("toast.detectSuccess"));
    });
  }

  function onSave() {
    if (!siteUrl.trim() || !consumerKey.trim()) {
      toast.error(t("toast.missingFields"));
      return;
    }
    if (editSecret && !consumerSecret.trim()) {
      toast.error(t("toast.missingSecret"));
      return;
    }
    startTransition(async () => {
      const r = await saveWooCommerceConfig({
        instanceId,
        siteUrl,
        consumerKey,
        consumerSecret: editSecret ? consumerSecret : undefined,
      });
      if (!r.ok) {
        toast.error(t("toast.saveFailed"), { description: r.error });
        return;
      }
      setVerifyState({
        ok: r.verified,
        status: r.httpStatus ?? 0,
        latencyMs: r.latencyMs ?? 0,
      });
      if (r.verified) toast.success(t("toast.saveSuccess"));
      else toast.error(t("toast.saveButFailedVerify"));
      // Hide the secret field after a successful save with a fresh secret
      if (editSecret) {
        setEditSecret(false);
        setConsumerSecret("");
      }
    });
  }

  const verifiedAt = initialValues.lastVerifiedAt;
  const verifiedOk = (initialValues.lastHttpStatus ?? 0) === 200;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      {/* URL */}
      <div>
        <FloatingLabelInput
          id="wc-site-url"
          label={t("fields.siteUrl")}
          placeholder="https://shop.example.com"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          disabled={pending}
        />
        <p style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginTop: 4 }}>
          {t("fields.siteUrlHint")}
        </p>
      </div>

      {/* Consumer key */}
      <FloatingLabelInput
        id="wc-consumer-key"
        label={t("fields.consumerKey")}
        placeholder="ck_..."
        value={consumerKey}
        onChange={(e) => setConsumerKey(e.target.value)}
        disabled={pending}
      />

      {/* Consumer secret */}
      <div>
        {editSecret ? (
          <div style={{ position: "relative" }}>
            <FloatingLabelInput
              id="wc-consumer-secret"
              label={t("fields.consumerSecret")}
              type={showSecret ? "text" : "password"}
              placeholder="cs_..."
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              disabled={pending}
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--gl-text-tertiary)",
              }}
              aria-label={showSecret ? t("actions.hideKey") : t("actions.showKey")}
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            {hasConsumerSecret ? (
              <button
                type="button"
                onClick={() => {
                  setEditSecret(false);
                  setConsumerSecret("");
                  setShowSecret(false);
                }}
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  background: "transparent",
                  border: "none",
                  color: "var(--gl-accent)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {t("actions.cancelReplace")}
              </button>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              padding: "10px 12px",
              border: "0.5px dashed var(--gl-border-strong)",
              borderRadius: "var(--gl-radius-md)",
              fontSize: 12,
              color: "var(--gl-text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>🔒 {t("fields.consumerSecretHidden")}</span>
            <button
              type="button"
              onClick={() => setEditSecret(true)}
              style={{
                fontSize: 12,
                background: "transparent",
                border: "none",
                color: "var(--gl-accent)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {t("actions.replaceKey")}
            </button>
          </div>
        )}
        <p style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginTop: 4 }}>
          {t("fields.consumerSecretHint")}
        </p>
      </div>

      {/* Status badge */}
      {verifiedAt || verifyState ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: "var(--gl-radius-md)",
            background: (verifyState?.ok ?? verifiedOk)
              ? "var(--gl-success-bg)"
              : "var(--gl-danger-bg)",
            color: (verifyState?.ok ?? verifiedOk)
              ? "var(--gl-success-text)"
              : "var(--gl-danger-text)",
            fontSize: 12,
          }}
        >
          {(verifyState?.ok ?? verifiedOk) ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {verifyState
            ? verifyState.ok
              ? t("status.verifiedNow", { latency: verifyState.latencyMs })
              : t("status.failedNow", { status: verifyState.status })
            : t("status.verifiedAgo", {
                time: timeAgo(verifiedAt!),
                latency: initialValues.lastVerifiedLatencyMs ?? 0,
              })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--gl-text-tertiary)" }}>
          {t("status.notVerified")}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          type="button"
          variant="outline"
          onClick={onTest}
          disabled={pending || !canTest}
        >
          {t("actions.test")}
        </Button>
        <Button type="button" onClick={onSave} disabled={pending}>
          {t("actions.save")}
        </Button>
      </div>

      {/* Field-mapping detection ─────────────────────────────────────────
       *  Probes the connected WC site to figure out where brand / barcode /
       *  cost are stored, so a follow-up "Set as write target" UI can let
       *  the user pick where RRE pushes data back. Read-only — no WC
       *  data is modified by this button. */}
      <DetectFieldSinksSection
        canRun={hasConsumerSecret && !!initialValues.siteUrl.trim()}
        pending={detectPending}
        report={fieldSinks}
        onRun={onDetect}
      />
    </div>
  );
}

// ─── Field-sink detection section ─────────────────────────────────────────

function DetectFieldSinksSection({
  canRun,
  pending,
  report,
  onRun,
}: {
  canRun: boolean;
  pending: boolean;
  report: FieldDetectionReport | null;
  onRun: () => void;
}) {
  const t = useTranslations("configuration.woocommerce.detect");
  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 24,
        borderTop: "0.5px solid var(--gl-border)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{t("title")}</div>
        <p
          style={{
            fontSize: 12,
            color: "var(--gl-text-secondary)",
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          {t("subtitle")}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button
          type="button"
          variant="outline"
          onClick={onRun}
          disabled={pending || !canRun}
        >
          <Icon icon={Search} size={14} />
          <span style={{ marginLeft: 8 }}>
            {pending ? t("buttonRunning") : t("button")}
          </span>
        </Button>
        {!canRun && (
          <span style={{ fontSize: 12, color: "var(--gl-text-tertiary)" }}>
            {t("needsCredentials")}
          </span>
        )}
        {report && (
          <span style={{ fontSize: 12, color: "var(--gl-text-tertiary)" }}>
            {t("lastRun", {
              when: new Date(report.detected_at).toLocaleString(),
            })}
          </span>
        )}
      </div>

      {report && <FieldSinksReport report={report} />}
    </div>
  );
}

function FieldSinksReport({ report }: { report: FieldDetectionReport }) {
  const t = useTranslations("configuration.woocommerce.detect");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        marginTop: 4,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>
        {t("sampleSize", { n: report.sample_size })} ·{" "}
        {report.meta.wc_brands_endpoint_reachable
          ? t("brandsReachable")
          : t("brandsNotReachable")}{" "}
        ·{" "}
        {report.meta.wp_taxonomies_reachable
          ? t("taxonomiesReachable")
          : t("taxonomiesNotReachable")}
      </div>

      <ConceptBlock title={t("concept.brand")} sinks={report.brand} />
      <ConceptBlock title={t("concept.barcode")} sinks={report.barcode} />
      <ConceptBlock title={t("concept.cost")} sinks={report.cost} />
    </div>
  );
}

function ConceptBlock({
  title,
  sinks,
}: {
  title: string;
  sinks: SinkScore[];
}) {
  const t = useTranslations("configuration.woocommerce.detect");
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{title}</div>
      <div
        style={{
          background: "var(--gl-surface-2)",
          borderRadius: "var(--gl-radius-md)",
          padding: 10,
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: "4px 16px",
          fontSize: 12,
        }}
      >
        <div style={{ color: "var(--gl-text-tertiary)" }}>{t("col.sink")}</div>
        <div style={{ color: "var(--gl-text-tertiary)" }}>{t("col.installed")}</div>
        <div style={{ color: "var(--gl-text-tertiary)" }}>{t("col.populated")}</div>
        {sinks.map((s) => (
          <SinkRow key={s.id} score={s} />
        ))}
      </div>
    </div>
  );
}

function SinkRow({ score }: { score: SinkScore }) {
  return (
    <>
      <div>
        <code style={{ fontSize: 11, color: "var(--gl-text)" }}>{score.id}</code>
        <div
          style={{
            fontSize: 11,
            color: "var(--gl-text-secondary)",
          }}
        >
          {score.label}
        </div>
        {score.samples && score.samples.length > 0 && (
          <div
            style={{
              fontSize: 11,
              color: "var(--gl-text-tertiary)",
              fontStyle: "italic",
              marginTop: 2,
            }}
          >
            {score.samples.join(" · ")}
          </div>
        )}
      </div>
      <div className="tabular">
        {score.installed ? (
          <CheckCircle2 size={14} style={{ color: "var(--gl-success)" }} />
        ) : (
          <XCircle size={14} style={{ color: "var(--gl-text-tertiary)" }} />
        )}
      </div>
      <div
        className="tabular"
        style={{
          color: score.populated_count > 0 ? "var(--gl-text)" : "var(--gl-text-tertiary)",
        }}
      >
        {score.populated_count}
      </div>
    </>
  );
}
