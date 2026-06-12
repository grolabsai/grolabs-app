"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import { CheckCircle2, XCircle, Copy, Plus, X, RefreshCw, Database, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import {
  testMeilisearchConnection,
  saveStorefrontDomains,
  initializeIndex,
  runFullBackfill,
  getIndexingStatus,
  type ConnectionTestResult,
  type IndexingStatus,
} from "./actions";

type Props = {
  instanceId: number;
  indexUid: string;
  initialDomains: string[];
  initialHealth: ConnectionTestResult;
  initialStatus: IndexingStatus | null;
};

export function SearchSettingsForm({
  instanceId,
  indexUid,
  initialDomains,
  initialHealth,
  initialStatus,
}: Props) {
  const t = useTranslations("configuration.search");

  const [health, setHealth] = useState<ConnectionTestResult>(initialHealth);
  const [domains, setDomains] = useState<string[]>(initialDomains);
  const [newDomain, setNewDomain] = useState("");
  const [status, setStatus] = useState<IndexingStatus | null>(initialStatus);
  const [isTesting, startTest] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isInit, startInit] = useTransition();
  const [isReindexing, startReindex] = useTransition();
  const [isRefreshingStatus, startRefreshStatus] = useTransition();

  function handleTest() {
    startTest(async () => {
      const result = await testMeilisearchConnection();
      setHealth(result);
      if (result.ok) {
        toast.success(t("toast.connectionOk"), {
          description: t("toast.latency", { ms: result.latencyMs }),
        });
      } else {
        toast.error(t("toast.connectionFailed"), {
          description: result.message ?? t("toast.unreachable"),
        });
      }
    });
  }

  function handleAddDomain() {
    const trimmed = newDomain.trim();
    if (!trimmed) return;
    if (domains.includes(trimmed.toLowerCase())) {
      toast.error(t("toast.duplicateDomain"));
      return;
    }
    const next = [...domains, trimmed];
    setDomains(next);
    setNewDomain("");
    persistDomains(next);
  }

  function handleRemoveDomain(host: string) {
    const next = domains.filter((d) => d !== host);
    setDomains(next);
    persistDomains(next);
  }

  function persistDomains(next: string[]) {
    startSave(async () => {
      const result = await saveStorefrontDomains(instanceId, next);
      if (!result.ok) {
        toast.error(t("toast.saveFailed"), { description: result.message });
        // Roll back to last server-acknowledged state by reloading the page
        // implicitly via revalidatePath; for now just show the error.
        return;
      }
      // Server normalizes (lowercase, dedupe) — adopt the canonical form.
      setDomains(result.domains);
      toast.success(t("toast.saved"));
    });
  }

  function handleCopyInstanceId() {
    void navigator.clipboard.writeText(String(instanceId));
    toast.success(t("toast.copied"));
  }

  function handleInit() {
    startInit(async () => {
      const result = await initializeIndex(instanceId);
      if (result.ok) {
        toast.success(t("toast.indexReady"), {
          description: t("toast.indexUid", { uid: result.indexUid }),
        });
      } else {
        toast.error(t("toast.indexFailed"), { description: result.error });
      }
    });
  }

  function handleReindex() {
    if (!confirm(t("indexing.confirmReindex"))) return;
    startReindex(async () => {
      const result = await runFullBackfill(instanceId);
      if (result.ok) {
        toast.success(t("toast.reindexDone"), {
          description: t("toast.reindexCounts", {
            indexed: result.indexed,
            failed: result.failed,
          }),
        });
        const next = await getIndexingStatus(instanceId);
        setStatus(next);
      } else {
        toast.error(t("toast.reindexFailed"), { description: result.error });
      }
    });
  }

  function handleRefreshStatus() {
    startRefreshStatus(async () => {
      const next = await getIndexingStatus(instanceId);
      setStatus(next);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Connection status ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="s-card-label !mb-0">{t("connection.title")}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting}
          >
            <Icon icon={RefreshCw} />
            {isTesting ? t("connection.testing") : t("connection.retest")}
          </Button>
        </div>
        <div
          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
            health.ok
              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700"
              : "border-red-500/40 bg-red-500/5 text-red-700"
          }`}
        >
          <Icon icon={health.ok ? CheckCircle2 : XCircle} />
          <span className="font-medium">
            {health.ok ? t("connection.ok") : t("connection.down")}
          </span>
          {health.ok ? (
            <span className="text-muted-foreground">
              {t("connection.latency", { ms: health.latencyMs })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {health.message ?? t("connection.unreachable")}
            </span>
          )}
        </div>
      </section>

      {/* ── Instance ID ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <Label>{t("instanceId.label")}</Label>
        <div className="flex items-center gap-2">
          <Input value={String(instanceId)} readOnly className="font-mono w-32" />
          <Button type="button" variant="outline" size="sm" onClick={handleCopyInstanceId}>
            <Icon icon={Copy} />
            {t("instanceId.copy")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("instanceId.help")}</p>
      </section>

      {/* ── Storefront domains ───────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <Label>{t("domains.label")}</Label>
          <p className="text-xs text-muted-foreground">{t("domains.help")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t("domains.empty")}</p>
          ) : (
            domains.map((d) => (
              <div
                key={d}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-mono">{d}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveDomain(d)}
                  disabled={isSaving}
                  aria-label={t("domains.remove", { host: d })}
                >
                  <Icon icon={X} />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder={t("domains.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddDomain();
              }
            }}
            disabled={isSaving}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleAddDomain}
            disabled={isSaving || !newDomain.trim()}
          >
            <Icon icon={Plus} />
            {t("domains.add")}
          </Button>
        </div>
      </section>

      {/* ── Index initialization ─────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <Label>{t("index.label")}</Label>
          <p className="text-xs text-muted-foreground">{t("index.help")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={indexUid} readOnly className="font-mono w-48" />
          <Button type="button" variant="outline" onClick={handleInit} disabled={isInit}>
            <Icon icon={Database} />
            {isInit ? t("index.creating") : t("index.create")}
          </Button>
        </div>
      </section>

      {/* ── Indexing status (Stage 1) ────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("indexing.label")}</Label>
            <p className="text-xs text-muted-foreground">{t("indexing.help")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshStatus}
            disabled={isRefreshingStatus}
          >
            <Icon icon={RefreshCw} />
            {isRefreshingStatus ? t("indexing.refreshing") : t("indexing.refresh")}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusTile
            label={t("indexing.rreCount")}
            value={status ? String(status.rreProductCount) : "—"}
          />
          <StatusTile
            label={t("indexing.meiliCount")}
            value={status ? String(status.meiliDocCount) : "—"}
            tone={status && !status.inSync ? "warn" : "ok"}
          />
          <StatusTile
            label={t("indexing.failed")}
            value={status ? String(status.failedCount) : "—"}
            tone={status && status.failedCount > 0 ? "warn" : "ok"}
          />
          <StatusTile
            label={t("indexing.lastSync")}
            value={status?.lastSearchSyncAt ? formatTimestamp(status.lastSearchSyncAt) : t("indexing.never")}
          />
        </div>

        <div>
          <Button type="button" onClick={handleReindex} disabled={isReindexing}>
            <Icon icon={FileSearch} />
            {isReindexing ? t("indexing.reindexing") : t("indexing.reindex")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-700"
      : "border-border bg-background text-foreground";
  return (
    <div className={`flex flex-col gap-1 rounded-md border px-3 py-2 ${toneClass}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium font-mono">{value}</span>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
