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
  listTemplateSources,
  type ConfigSource,
  type TemplateSource,
} from "@/lib/actions/instance";
import { useActivityStream } from "@/lib/activity-stream";
import { deriveSlug } from "@/lib/instanceSlug";

const NEW_INSTANCE_BANNER_KEY = "grolabs:new-instance-banner";

const NONE_VALUE = "__none__";

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
  const [configSources, setConfigSources] = useState<ConfigSource[]>([]);
  const [templateSources, setTemplateSources] = useState<TemplateSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { reportError, reportInfo, clear: clearActivity } = useActivityStream();

  const trimmed = name.trim();
  const slugPreview = deriveSlug(trimmed);
  const nameValid = trimmed.length > 0 && slugPreview.length > 0;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([listConfigSources(), listTemplateSources()]).then(
      ([cfgRes, tmplRes]) => {
        if (cancelled) return;
        const cfgs = cfgRes.ok ? cfgRes.sources : [];
        const tmpls = tmplRes.ok ? tmplRes.sources : [];
        setConfigSources(cfgs);
        setTemplateSources(tmpls);
        const cfgDef =
          cfgs.find((s) => s.instanceId === currentInstanceId) ??
          cfgs[0] ??
          null;
        setSelectedConfigId(cfgDef ? cfgDef.instanceId : null);
        // Template default: first available (typically GroLabs/instance 0).
        setSelectedTemplateId(tmpls[0]?.instanceId ?? null);
        setSourcesLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, currentInstanceId]);

  function reset() {
    setStep(1);
    setName("");
    setError(null);
    setConfigSources([]);
    setTemplateSources([]);
    setSourcesLoaded(false);
    setSelectedConfigId(null);
    setSelectedTemplateId(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const hasCopyStep =
    sourcesLoaded && (configSources.length > 0 || templateSources.length > 0);
  const selectedConfig =
    configSources.find((s) => s.instanceId === selectedConfigId) ?? null;
  const selectedTemplate =
    templateSources.find((s) => s.instanceId === selectedTemplateId) ?? null;

  function finish() {
    setError(null);
    startTransition(async () => {
      const result = await createInstance(trimmed, {
        copyFromInstanceId: selectedConfigId ?? undefined,
        copyTemplateFromInstanceId: selectedTemplateId ?? undefined,
      });
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

      // Drop any activity-stream messages from the previous instance — the
      // panel scope follows the active instance. The "created" info bubble
      // below becomes the first entry for the new instance.
      clearActivity();
      reportInfo({
        source: "Instance creation",
        title: t("agentLog.createdTitle"),
        message: t("agentLog.createdBody", { name: trimmed }),
        context: { instanceId: result.instanceId, slug: result.slug },
      });

      // Compose a single toast that mentions whichever copies happened.
      const parts: string[] = [];
      if (result.copiedFrom) parts.push(t("toast.partConfig", { source: result.copiedFrom }));
      if (result.templateCopiedFrom)
        parts.push(
          t("toast.partTemplate", {
            source: result.templateCopiedFrom,
            count: result.templateCopyTotal ?? 0,
          }),
        );
      if (parts.length === 0) {
        toast.success(t("toast.created", { name: trimmed }));
      } else {
        toast.success(
          t("toast.createdWith", { name: trimmed, parts: parts.join(", ") }),
        );
      }

      if (result.copyWarning) {
        reportError({
          source: "Instance creation",
          title: t("errors.copyFailed"),
          message: result.copyWarning,
          context: { newInstanceId: result.instanceId },
        });
      }
      if (result.templateCopyWarning) {
        reportError({
          source: "Instance creation",
          title: t("errors.templateCopyFailed"),
          message: result.templateCopyWarning,
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

            <div className="grid gap-5">
              {configSources.length > 0 ? (
                <div className="grid gap-2">
                  <label
                    className="text-xs font-medium"
                    style={{ color: "var(--s-text)" }}
                    htmlFor="config-source-select"
                  >
                    {t("copy.configSourceLabel")}
                  </label>
                  <Select
                    value={
                      selectedConfigId != null
                        ? String(selectedConfigId)
                        : NONE_VALUE
                    }
                    onValueChange={(v) =>
                      setSelectedConfigId(v === NONE_VALUE ? null : Number(v))
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger id="config-source-select">
                      <SelectValue placeholder={t("copy.configSourceLabel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>{t("copy.none")}</SelectItem>
                      {configSources.map((s) => (
                        <SelectItem
                          key={s.instanceId}
                          value={String(s.instanceId)}
                        >
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedConfig ? (
                    <p
                      className="text-xs"
                      style={{ color: "var(--s-text-secondary)" }}
                    >
                      <span style={{ color: "var(--s-text)" }}>
                        {t("copy.willCopy")}
                      </span>{" "}
                      {[
                        ...selectedConfig.integrationKeys.map(integrationLabel),
                        ...(selectedConfig.storefrontDomainCount > 0
                          ? [t("copy.storefrontDomains")]
                          : []),
                        selectedConfig.primaryLocale
                          ? t("copy.locale", {
                              value: selectedConfig.primaryLocale,
                            })
                          : null,
                        selectedConfig.defaultCurrency
                          ? t("copy.currency", {
                              value: selectedConfig.defaultCurrency,
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {templateSources.length > 0 ? (
                <div className="grid gap-2">
                  <label
                    className="text-xs font-medium"
                    style={{ color: "var(--s-text)" }}
                    htmlFor="template-source-select"
                  >
                    {t("copy.templateSourceLabel")}
                  </label>
                  <Select
                    value={
                      selectedTemplateId != null
                        ? String(selectedTemplateId)
                        : NONE_VALUE
                    }
                    onValueChange={(v) =>
                      setSelectedTemplateId(v === NONE_VALUE ? null : Number(v))
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger id="template-source-select">
                      <SelectValue placeholder={t("copy.templateSourceLabel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>{t("copy.none")}</SelectItem>
                      {templateSources.map((s) => (
                        <SelectItem
                          key={s.instanceId}
                          value={String(s.instanceId)}
                        >
                          {s.tenantName
                            ? `${s.name} · ${s.tenantName}`
                            : s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate ? (
                    <p
                      className="text-xs"
                      style={{ color: "var(--s-text-secondary)" }}
                    >
                      <span style={{ color: "var(--s-text)" }}>
                        {t("copy.willCopy")}
                      </span>{" "}
                      {[
                        selectedTemplate.categoryCount > 0
                          ? t("copy.templateCategories", {
                              count: selectedTemplate.categoryCount,
                            })
                          : null,
                        selectedTemplate.attributeCount > 0
                          ? t("copy.templateAttributes", {
                              count: selectedTemplate.attributeCount,
                            })
                          : null,
                        selectedTemplate.attributeOptionCount > 0
                          ? t("copy.templateOptions", {
                              count: selectedTemplate.attributeOptionCount,
                            })
                          : null,
                        selectedTemplate.speciesCount > 0
                          ? t("copy.templateSpecies", {
                              count: selectedTemplate.speciesCount,
                            })
                          : null,
                        selectedTemplate.petProfileAttributeCount > 0
                          ? t("copy.templatePetProfile", {
                              count: selectedTemplate.petProfileAttributeCount,
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <p
                className="text-xs"
                style={{ color: "var(--s-text-secondary)" }}
              >
                <span style={{ color: "var(--s-text)" }}>
                  {t("copy.willNotCopy")}
                </span>{" "}
                {t("copy.excluded")}
              </p>

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
                onClick={() => setStep(1)}
                disabled={isPending}
              >
                {t("back")}
              </Button>
              <Button type="button" onClick={() => finish()} disabled={isPending}>
                {isPending ? t("submitting") : t("submit")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
