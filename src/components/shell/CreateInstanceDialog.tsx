"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import {
  createInstance,
  listConfigSources,
  type ConfigSource,
} from "@/lib/actions/instance";
import { useActivityStream } from "@/lib/activity-stream";
import { deriveSlug } from "@/lib/instanceSlug";

const NEW_INSTANCE_BANNER_KEY = "grolabs:new-instance-banner";

/** Proper-noun display names for integrations_config keys (data, not chrome). */
const INTEGRATION_LABELS: Record<string, string> = {
  woocommerce: "WooCommerce",
  algolia: "Algolia",
  ga4: "GA4",
  meilisearch: "MeiliSearch",
};

function integrationLabel(key: string): string {
  return (
    INTEGRATION_LABELS[key] ??
    key.charAt(0).toUpperCase() + key.slice(1)
  );
}

export function CreateInstanceDialog({
  open,
  onOpenChange,
  currentInstanceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentInstanceId: number | null;
}) {
  const t = useTranslations("shell.instanceSwitcher.modal");
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [sources, setSources] = useState<ConfigSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { reportError } = useActivityStream();

  const trimmed = name.trim();
  const slugPreview = deriveSlug(trimmed);
  const nameValid = trimmed.length > 0 && slugPreview.length > 0;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listConfigSources().then((res) => {
      if (cancelled) return;
      const list = res.ok ? res.sources : [];
      setSources(list);
      const def =
        list.find((s) => s.instanceId === currentInstanceId) ?? list[0] ?? null;
      setSelectedSourceId(def ? def.instanceId : null);
      setSourcesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentInstanceId]);

  function reset() {
    setStep(1);
    setName("");
    setError(null);
    setSources([]);
    setSourcesLoaded(false);
    setSelectedSourceId(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const hasCopyStep = sourcesLoaded && sources.length > 0;
  const selectedSource =
    sources.find((s) => s.instanceId === selectedSourceId) ?? null;

  function finish(copyFromInstanceId?: number) {
    setError(null);
    startTransition(async () => {
      const result = await createInstance(
        trimmed,
        copyFromInstanceId != null ? { copyFromInstanceId } : undefined,
      );
      if (!result.ok) {
        if (result.error === "invalid_name") {
          setError(t("errors.invalidName"));
        } else {
          setError(t("errors.saveFailed"));
          reportError({
            source: "Instance creation",
            title: t("errors.saveFailed"),
            message: result.message ?? result.error,
            context: {
              name: trimmed,
              slug: slugPreview,
              errorCode: result.error,
              serverMessage: result.message ?? null,
            },
          });
        }
        return;
      }

      if (result.copiedFrom) {
        toast.success(t("toast.createdWithCopy", { name: trimmed, source: result.copiedFrom }));
      } else {
        toast.success(t("toast.created", { name: trimmed }));
      }
      if (result.copyWarning) {
        reportError({
          source: "Instance creation",
          title: t("errors.copyFailed"),
          message: result.copyWarning,
          context: { newInstanceId: result.instanceId },
        });
      }

      try {
        sessionStorage.setItem(
          NEW_INSTANCE_BANNER_KEY,
          String(result.instanceId),
        );
      } catch {
        // sessionStorage unavailable — banner is best-effort.
      }

      reset();
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameValid || isPending) return;
    if (hasCopyStep) {
      setStep(2);
    } else {
      finish();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {step === 1 ? (
          <form onSubmit={handleStep1Submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <FloatingLabelInput
                id="instance-name"
                label={t("nameLabel")}
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                autoComplete="off"
                disabled={isPending}
              />
              <FloatingLabelInput
                id="instance-slug-preview"
                label={t("slugLabel")}
                placeholder={t("slugPlaceholder")}
                value={slugPreview}
                readOnly
                disabled
                className="font-mono text-xs"
              />
              {error ? (
                <p
                  className="text-xs"
                  style={{ color: "var(--s-text-error, #b91c1c)" }}
                >
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!nameValid || isPending}>
                {isPending
                  ? t("submitting")
                  : hasCopyStep
                    ? t("continue")
                    : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("copy.title")}</DialogTitle>
              <DialogDescription>{t("copy.description")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <Select
                value={
                  selectedSourceId != null ? String(selectedSourceId) : undefined
                }
                onValueChange={(v) => setSelectedSourceId(Number(v))}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("copy.sourceLabel")} />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.instanceId} value={String(s.instanceId)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedSource ? (
                <div
                  className="grid gap-1.5 rounded-[var(--s-radius-md)] p-3 text-xs"
                  style={{
                    background: "var(--s-surface-alt)",
                    color: "var(--s-text-secondary)",
                  }}
                >
                  <p>
                    <span style={{ color: "var(--s-text)" }}>
                      {t("copy.willCopy")}
                    </span>{" "}
                    {[
                      ...selectedSource.integrationKeys.map(integrationLabel),
                      ...(selectedSource.storefrontDomainCount > 0
                        ? [t("copy.storefrontDomains")]
                        : []),
                      selectedSource.primaryLocale
                        ? t("copy.locale", {
                            value: selectedSource.primaryLocale,
                          })
                        : null,
                      selectedSource.defaultCurrency
                        ? t("copy.currency", {
                            value: selectedSource.defaultCurrency,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  <p>
                    <span style={{ color: "var(--s-text)" }}>
                      {t("copy.willNotCopy")}
                    </span>{" "}
                    {t("copy.excluded")}
                  </p>
                </div>
              ) : null}

              {error ? (
                <p
                  className="text-xs"
                  style={{ color: "var(--s-text-error, #b91c1c)" }}
                >
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => finish()}
                disabled={isPending}
              >
                {isPending ? t("submitting") : t("copy.startBlank")}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  finish(selectedSourceId != null ? selectedSourceId : undefined)
                }
                disabled={isPending || selectedSourceId == null}
              >
                {isPending ? t("submitting") : t("copy.copyAndCreate")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
