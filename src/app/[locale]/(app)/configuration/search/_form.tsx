"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Copy, Plus, X, RefreshCw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import {
  testMeilisearchConnection,
  saveStorefrontDomains,
  initializeIndex,
  type ConnectionTestResult,
} from "./actions";

type Props = {
  instanceId: number;
  indexUid: string;
  initialDomains: string[];
  initialHealth: ConnectionTestResult;
};

export function SearchSettingsForm({
  instanceId,
  indexUid,
  initialDomains,
  initialHealth,
}: Props) {
  const t = useTranslations("configuration.search");

  const [health, setHealth] = useState<ConnectionTestResult>(initialHealth);
  const [domains, setDomains] = useState<string[]>(initialDomains);
  const [newDomain, setNewDomain] = useState("");
  const [isTesting, startTest] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isInit, startInit] = useTransition();

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

  return (
    <div className="flex flex-col gap-8">
      {/* ── Connection status ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("connection.title")}</h3>
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
    </div>
  );
}
