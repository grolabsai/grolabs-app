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
import { testTypesenseConnection, saveTypesenseConfig } from "./actions";

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
  host: string;
  port: number;
  protocol: string;
  searchOnlyApiKey: string;
  primaryCollection: string;
  lastVerifiedAt?: string;
  lastHttpStatus?: number;
  lastVerifiedLatencyMs?: number;
};

type Props = {
  instanceId: number;
  initialValues: InitialValues;
  hasAdminKey: boolean;
};

const PROTOCOLS = ["https", "http"] as const;

export function TypesenseForm({ instanceId, initialValues, hasAdminKey }: Props) {
  const t = useTranslations("configuration.typesense");

  const [host, setHost] = useState(initialValues.host);
  const [port, setPort] = useState(String(initialValues.port));
  const [protocol, setProtocol] = useState(initialValues.protocol);
  const [searchOnlyApiKey, setSearchOnlyApiKey] = useState(
    initialValues.searchOnlyApiKey,
  );
  const [primaryCollection, setPrimaryCollection] = useState(
    initialValues.primaryCollection,
  );

  const [replacingKey, setReplacingKey] = useState(!hasAdminKey);
  const [adminApiKey, setAdminApiKey] = useState("");
  const [showAdminKey, setShowAdminKey] = useState(false);

  const [verifiedAt, setVerifiedAt] = useState(initialValues.lastVerifiedAt);
  const [httpStatus, setHttpStatus] = useState(initialValues.lastHttpStatus);
  const [latencyMs, setLatencyMs] = useState(initialValues.lastVerifiedLatencyMs);

  const [isPending, startTransition] = useTransition();

  function parsedPort(): number {
    const n = parseInt(port, 10);
    return Number.isFinite(n) && n > 0 ? n : protocol === "https" ? 443 : 80;
  }

  function handleTest() {
    if (!host || (!replacingKey && !hasAdminKey) || (replacingKey && !adminApiKey)) {
      toast.error(t("toast.testFailed"), {
        description: t("toast.missingFields"),
      });
      return;
    }

    if (replacingKey) {
      startTransition(async () => {
        const result = await testTypesenseConnection(
          host,
          parsedPort(),
          protocol,
          adminApiKey,
        );
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
    } else {
      startTransition(async () => {
        const result = await saveTypesenseConfig({
          instanceId,
          host,
          port: parsedPort(),
          protocol,
          searchOnlyApiKey,
          primaryCollection,
        });
        const now = new Date().toISOString();
        setVerifiedAt(now);
        setHttpStatus(result.httpStatus);
        setLatencyMs(result.latencyMs);
        if (result.verified) {
          toast.success(t("toast.testSuccess"), {
            description: `HTTP ${result.httpStatus} · ${result.latencyMs}ms`,
          });
        } else {
          toast.error(t("toast.testFailed"), {
            description: result.error ?? `HTTP ${result.httpStatus ?? 0}`,
          });
        }
      });
    }
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveTypesenseConfig({
        instanceId,
        host,
        port: parsedPort(),
        protocol,
        searchOnlyApiKey,
        primaryCollection,
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

      if (replacingKey && adminApiKey) {
        setReplacingKey(false);
        setAdminApiKey("");
      }
    });
  }

  return (
    <div className="s-config-form">
      <FloatingLabelInput
        id="typesense-host"
        label={t("fields.host")}
        value={host}
        onChange={(e) => setHost(e.target.value)}
        autoComplete="off"
      />

      <div className="s-field">
        <Label htmlFor="typesense-protocol" className="s-field-label--select">
          {t("fields.protocol")}
        </Label>
        <Select value={protocol} onValueChange={setProtocol}>
          <SelectTrigger id="typesense-protocol">
            <SelectValue placeholder={t("fields.protocolPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {PROTOCOLS.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FloatingLabelInput
        id="typesense-port"
        label={t("fields.port")}
        value={port}
        onChange={(e) => setPort(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
      />

      <FloatingLabelInput
        id="typesense-search-key"
        label={t("fields.searchOnlyApiKey")}
        value={searchOnlyApiKey}
        onChange={(e) => setSearchOnlyApiKey(e.target.value)}
        autoComplete="off"
      />

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
            id="typesense-admin-key"
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

      <FloatingLabelInput
        id="typesense-primary-collection"
        label={t("fields.primaryCollection")}
        value={primaryCollection}
        onChange={(e) => setPrimaryCollection(e.target.value)}
        autoComplete="off"
      />

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

      <div className="s-config-actions">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleTest}
        >
          {t("actions.test")}
        </Button>
        <Button type="button" disabled={isPending} onClick={handleSave}>
          {t("actions.save")}
        </Button>
      </div>
    </div>
  );
}
