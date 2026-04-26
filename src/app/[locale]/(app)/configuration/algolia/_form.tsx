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
import {
  testAlgoliaConnection,
  saveAlgoliaConfig,
} from "./actions";

type InitialValues = {
  appId: string;
  region: string;
  searchApiKey: string;
  primaryIndex: string;
  lastVerifiedAt?: string;
  lastHttpStatus?: number;
};

type Props = {
  tenantId: number;
  initialValues: InitialValues;
  /** Whether an admin key is already stored in Vault. */
  hasAdminKey: boolean;
};

export function AlgoliaForm({ tenantId, initialValues, hasAdminKey }: Props) {
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

  // ── Verification status (local, updated optimistically) ─────────────────────
  const [verifiedAt, setVerifiedAt] = useState(initialValues.lastVerifiedAt);
  const [httpStatus, setHttpStatus] = useState(initialValues.lastHttpStatus);

  const [isPending, startTransition] = useTransition();

  // ── Test only (no save) ─────────────────────────────────────────────────────
  function handleTest() {
    if (!appId || (!replacingKey && !hasAdminKey) || (replacingKey && !adminApiKey)) {
      toast.error(t("toast.testFailed"), {
        description: "Completa App ID y Admin API Key antes de probar.",
      });
      return;
    }

    // For test-only we need the admin key in the browser when replacing,
    // or we delegate to the server when using the existing key.
    if (replacingKey) {
      startTransition(async () => {
        const result = await testAlgoliaConnection(appId, adminApiKey);
        if (result.ok) {
          toast.success(t("toast.testSuccess"), {
            description: `HTTP ${result.status}`,
          });
        } else {
          toast.error(t("toast.testFailed"), {
            description: result.message ?? `HTTP ${result.status}`,
          });
        }
      });
    } else {
      // Delegate: save triggers a test internally; here we just trigger a
      // lightweight save-with-test via saveAlgoliaConfig (no key replacement).
      startTransition(async () => {
        const result = await saveAlgoliaConfig({
          tenantId,
          appId,
          region,
          searchApiKey,
          primaryIndex,
          // adminApiKey omitted → server reuses stored key
        });
        if (result.verified) {
          toast.success(t("toast.testSuccess"), {
            description: `HTTP ${result.httpStatus}`,
          });
          setVerifiedAt(new Date().toISOString());
          setHttpStatus(result.httpStatus);
        } else {
          toast.error(t("toast.testFailed"), {
            description: result.error ?? `HTTP ${result.httpStatus ?? 0}`,
          });
          setVerifiedAt(new Date().toISOString());
          setHttpStatus(result.httpStatus);
        }
      });
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  function handleSave() {
    startTransition(async () => {
      const result = await saveAlgoliaConfig({
        tenantId,
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

      // After a successful save with a new key, switch back to "key is stored" state
      if (replacingKey && adminApiKey) {
        setReplacingKey(false);
        setAdminApiKey("");
      }
    });
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
            <SelectItem value="us">{t("fields.regionUs")}</SelectItem>
            <SelectItem value="eu">{t("fields.regionEu")}</SelectItem>
            <SelectItem value="de">{t("fields.regionDe")}</SelectItem>
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
            {t("status.verified")}
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
