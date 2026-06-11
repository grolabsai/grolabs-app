"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, EyeOff, CheckCircle2, XCircle, Clock } from "lucide-react";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { testAlgoliaConnection, saveAlgoliaConfig } from "./actions";

/** Returns a short relative time string: "12s", "5m", "2h", "3d", or a date. */
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
  appId: string;
  region: string;
  searchApiKey: string;
  primaryIndex: string;
  lastVerifiedAt?: string;
  lastHttpStatus?: number;
  lastVerifiedLatencyMs?: number;
};

type Props = {
  instanceId: number;
  initialValues: InitialValues;
  /** Whether an admin key is already stored in Vault. */
  hasAdminKey: boolean;
};

const REGIONS = [
  "us", "eu", "de", "in", "sg", "au", "br", "ca", "za", "uae", "uk", "jp", "hk",
] as const;

export function AlgoliaForm({ instanceId, initialValues, hasAdminKey }: Props) {
  const t = useTranslations("configuration.algolia");

  // ── Field state ─────────────────────────────────────────────────────────────
  const [appId, setAppId] = useState(initialValues.appId);
  const [region, setRegion] = useState(initialValues.region);
  const [searchApiKey, setSearchApiKey] = useState(initialValues.searchApiKey);
  const [primaryIndex, setPrimaryIndex] = useState(initialValues.primaryIndex);

  // Admin key: hidden when an existing key is on file unless user clicks "Replace"
  const [replacingKey, setReplacingKey] = useState(!hasAdminKey);
  const [adminApiKey, setAdminApiKey] = useState("");
  const [showAdminKey, setShowAdminKey] = useState(false);

  // ── Verification status (updated after test/save) ───────────────────────────
  const [verifiedAt, setVerifiedAt] = useState(initialValues.lastVerifiedAt);
  const [httpStatus, setHttpStatus] = useState(initialValues.lastHttpStatus);
  const [latencyMs, setLatencyMs] = useState(initialValues.lastVerifiedLatencyMs);

  const [isPending, startTransition] = useTransition();

  // ── Test only (no save) ─────────────────────────────────────────────────────
  // Read-only probe: needs App ID + Search API Key + index. The write key is
  // never required to verify connectivity — a merchant may only hand us
  // search-only credentials, and we should still be able to confirm we can read.
  function handleTest() {
    if (!appId || !searchApiKey || !primaryIndex) {
      toast.error(t("toast.testFailed"), {
        description: t("toast.testMissingFields"),
      });
      return;
    }

    startTransition(async () => {
      const result = await testAlgoliaConnection(appId, searchApiKey, primaryIndex);
      setVerifiedAt(new Date().toISOString());
      setHttpStatus(result.status);
      setLatencyMs(result.latencyMs);
      if (result.ok) {
        toast.success(t("toast.testSuccess"), {
          description: `HTTP ${result.status} · ${result.latencyMs}ms`,
        });
      } else {
        toast.error(t("toast.testFailed"), {
          description: result.message ?? `HTTP ${result.status}`,
        });
      }
    });
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  function handleSave() {
    startTransition(async () => {
      const result = await saveAlgoliaConfig({
        instanceId,
        appId,
        region,
        searchApiKey,
        primaryIndex,
        adminApiKey: replacingKey ? adminApiKey : undefined,
      });

      if (!result.ok) {
        toast.error(t("toast.saveFailed"), { description: result.error });
        return;
      }

      toast.success(t("toast.saveSuccess"));
      setVerifiedAt(new Date().toISOString());
      setHttpStatus(result.httpStatus);
      setLatencyMs(result.latencyMs);

      // After a successful save with a new key, switch back to "key is stored" state
      if (replacingKey && adminApiKey) {
        setReplacingKey(false);
        setAdminApiKey("");
      }
    });
  }

  // ── Region key → i18n key mapping ──────────────────────────────────────────
  function regionKey(code: string): string {
    const map: Record<string, string> = {
      us: "regionUs", eu: "regionEu", de: "regionDe", in: "regionIn",
      sg: "regionSg", au: "regionAu", br: "regionBr", ca: "regionCa",
      za: "regionZa", uae: "regionUae", uk: "regionUk", jp: "regionJp",
      hk: "regionHk",
    };
    return map[code] ?? code;
  }

  return (
    <div className="s-config-form">
      {/* ── App ID ── */}
      <FloatingLabelInput
        id="algolia-app-id"
        label={t("fields.appId")}
        value={appId}
        onChange={(e) => setAppId(e.target.value)}
        autoComplete="off"
      />

      {/* ── Region ── */}
      <div className="s-field">
        <Label htmlFor="algolia-region" className="s-field-label--select">
          {t("fields.region")}
        </Label>
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger id="algolia-region">
            <SelectValue placeholder={t("fields.regionPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {REGIONS.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`fields.${regionKey(code)}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Search API Key ── */}
      <FloatingLabelInput
        id="algolia-search-key"
        label={t("fields.searchApiKey")}
        value={searchApiKey}
        onChange={(e) => setSearchApiKey(e.target.value)}
        autoComplete="off"
      />

      {/* ── Admin API Key ── */}
      {!replacingKey ? (
        <div className="s-field s-field--inline">
          <span className="s-field-stored-label">
            {t("fields.adminApiKeyHidden")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReplacingKey(true)}
          >
            {t("fields.replaceKey")}
          </Button>
        </div>
      ) : (
        <div className="s-field s-field--password">
          <FloatingLabelInput
            id="algolia-admin-key"
            label={t("fields.adminApiKey")}
            type={showAdminKey ? "text" : "password"}
            value={adminApiKey}
            onChange={(e) => setAdminApiKey(e.target.value)}
            autoComplete="new-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="s-field-eye"
            aria-label={showAdminKey ? t("actions.hideKey") : t("actions.showKey")}
            onClick={() => setShowAdminKey((v) => !v)}
          >
            {showAdminKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </Button>
        </div>
      )}

      {/* ── Primary Index ── */}
      <FloatingLabelInput
        id="algolia-primary-index"
        label={t("fields.primaryIndex")}
        value={primaryIndex}
        onChange={(e) => setPrimaryIndex(e.target.value)}
        autoComplete="off"
      />

      {/* ── Status row ── */}
      <div className="s-config-status-row">
        <span className="s-status-label">{t("status.label")}</span>
        {!verifiedAt ? (
          <span className="s-status-badge s-status-badge--neutral">
            <Clock size={14} />
            {t("status.notVerified")}
          </span>
        ) : httpStatus && httpStatus >= 200 && httpStatus < 300 ? (
          <span className="s-status-badge s-status-badge--success">
            <CheckCircle2 size={14} />
            {t("status.verified", {
              time: timeAgo(verifiedAt),
              latency: latencyMs ?? 0,
            })}
          </span>
        ) : (
          <span className="s-status-badge s-status-badge--danger">
            <XCircle size={14} />
            {t("status.failed")}
          </span>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="s-config-actions">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleTest}
        >
          {t("actions.test")}
        </Button>
        <Button
          type="button"
          disabled={isPending}
          onClick={handleSave}
        >
          {t("actions.save")}
        </Button>
      </div>
    </div>
  );
}
