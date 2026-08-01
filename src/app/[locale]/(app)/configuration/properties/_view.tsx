"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Lock, Pencil, Check, X } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { toast } from "@/components/ui/agent-toast";
import type {
  InstanceProperties,
  TenantProperties,
} from "@/lib/properties/fetch";
import { updateInstanceProperties } from "./actions";

type Props = {
  tenant: TenantProperties | null;
  instances: InstanceProperties[];
  currentInstanceId: number | null;
  canEditInstances: boolean;
};

/** A read-only label/value pair. `lockReason` explains WHY it can't be edited
 *  — a padlock with no explanation just reads as a broken form. */
function Field({
  label,
  value,
  lockReason,
  mono,
}: {
  label: string;
  value: string;
  lockReason?: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--gl-text-tertiary)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {label}
        {lockReason ? (
          <span title={lockReason} style={{ display: "inline-flex" }}>
            <Icon icon={Lock} size={10} />
          </span>
        ) : null}
      </span>
      <span
        style={{
          fontSize: 13,
          color: value ? "var(--gl-text-strong)" : "var(--gl-text-tertiary)",
          fontFamily: mono ? "var(--gl-font-mono, ui-monospace, monospace)" : undefined,
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: 14,
};

const PANEL: React.CSSProperties = {
  background: "var(--gl-surface)",
  border: "0.5px solid var(--gl-border)",
  borderRadius: "var(--gl-radius-lg)",
  padding: "16px 18px",
};

export function PropertiesView({
  tenant,
  instances,
  currentInstanceId,
  canEditInstances,
}: Props) {
  const t = useTranslations("configuration.properties");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Tenant — read-only, always ────────────────────────────────────
          There is no UPDATE policy on `tenant`, so nothing here could be
          written even if the form offered it. Saying so beats a form that
          silently fails. */}
      {tenant ? (
        <section style={PANEL}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              {t("tenant.heading")}
            </h2>
            <span
              style={{
                fontSize: 11,
                color: "var(--gl-text-tertiary)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon icon={Lock} size={11} />
              {t("tenant.readOnly")}
            </span>
          </div>
          <div style={GRID}>
            <Field label={t("fields.tenantId")} value={String(tenant.tenant_id)} mono />
            <Field label={t("fields.name")} value={tenant.name} />
            <Field label={t("fields.slug")} value={tenant.slug} mono />
            <Field label={t("fields.kind")} value={tenant.kind} mono />
            <Field
              label={t("fields.domain")}
              value={tenant.domain ?? ""}
              lockReason={t("locks.tenantDomain")}
              mono
            />
            <Field
              label={t("fields.createdAt")}
              value={new Date(tenant.created_at).toLocaleString()}
            />
          </div>
        </section>
      ) : null}

      {/* ── Instances — the one-to-many ─────────────────────────────────── */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>
          {t("instances.heading", { count: instances.length })}
        </h2>
        <p style={{ fontSize: 12, color: "var(--gl-text-secondary)", margin: "0 0 12px" }}>
          {canEditInstances ? t("instances.editableHint") : t("instances.readOnlyHint")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {instances.map((inst) => (
            <InstanceCard
              key={inst.instance_id}
              instance={inst}
              isCurrent={inst.instance_id === currentInstanceId}
              canEdit={canEditInstances}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function InstanceCard({
  instance,
  isCurrent,
  canEdit,
}: {
  instance: InstanceProperties;
  isCurrent: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("configuration.properties");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(instance.name);
  const [locale, setLocale] = useState(instance.primary_locale);
  const [currency, setCurrency] = useState(instance.default_currency);
  const [timezone, setTimezone] = useState(instance.timezone);

  function reset() {
    setName(instance.name);
    setLocale(instance.primary_locale);
    setCurrency(instance.default_currency);
    setTimezone(instance.timezone);
    setEditing(false);
  }

  function onSave() {
    startTransition(async () => {
      const r = await updateInstanceProperties({
        instanceId: instance.instance_id,
        name,
        primaryLocale: locale,
        defaultCurrency: currency,
        timezone,
      });
      if (r.ok) {
        toast.success(t("toast.saved", { name }));
        setEditing(false);
      } else {
        toast.error(t("toast.saveFailed"), {
          description: t(`errors.${r.error}` as never),
        });
      }
    });
  }

  return (
    <section
      style={{
        ...PANEL,
        borderColor: isCurrent ? "var(--gl-accent)" : "var(--gl-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            #{instance.instance_id} · {instance.name}
          </h3>
          {isCurrent ? (
            <span
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: "var(--gl-radius-sm)",
                background: "var(--gl-accent)",
                color: "var(--gl-accent-contrast, #1c1d24)",
              }}
            >
              {t("instances.current")}
            </span>
          ) : null}
          {!instance.is_active ? (
            <span style={{ fontSize: 11, color: "var(--gl-warning-text)" }}>
              {t("instances.inactive")}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          editing ? (
            <div style={{ display: "flex", gap: 6 }}>
              <Button type="button" variant="outline" onClick={reset} disabled={pending}>
                <Icon icon={X} size={14} />
                <span style={{ marginLeft: 4 }}>{t("actions.cancel")}</span>
              </Button>
              <Button type="button" onClick={onSave} disabled={pending}>
                <Icon icon={Check} size={14} />
                <span style={{ marginLeft: 4 }}>{t("actions.save")}</span>
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              <Icon icon={Pencil} size={14} />
              <span style={{ marginLeft: 4 }}>{t("actions.edit")}</span>
            </Button>
          )
        ) : null}
      </div>

      {editing ? (
        <div style={{ ...GRID, gap: 16 }}>
          <FloatingLabelInput
            id={`name-${instance.instance_id}`}
            label={t("fields.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
          />
          <FloatingLabelInput
            id={`locale-${instance.instance_id}`}
            label={t("fields.primaryLocale")}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            disabled={pending}
          />
          <FloatingLabelInput
            id={`currency-${instance.instance_id}`}
            label={t("fields.defaultCurrency")}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            disabled={pending}
          />
          <FloatingLabelInput
            id={`tz-${instance.instance_id}`}
            label={t("fields.timezone")}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={pending}
          />
        </div>
      ) : (
        <div style={GRID}>
          <Field label={t("fields.instanceId")} value={String(instance.instance_id)} mono />
          <Field label={t("fields.name")} value={instance.name} />
          <Field
            label={t("fields.slug")}
            value={instance.slug}
            lockReason={t("locks.slug")}
            mono
          />
          <Field
            label={t("fields.domain")}
            value={instance.domain ?? ""}
            lockReason={t("locks.instanceDomain")}
            mono
          />
          <Field
            label={t("fields.kind")}
            value={instance.kind}
            lockReason={t("locks.kind")}
            mono
          />
          <Field
            label={t("fields.plan")}
            value={instance.plan}
            lockReason={t("locks.plan")}
            mono
          />
          <Field
            label={t("fields.isActive")}
            value={instance.is_active ? t("yes") : t("no")}
            lockReason={t("locks.isActive")}
          />
          <Field label={t("fields.primaryLocale")} value={instance.primary_locale} mono />
          <Field
            label={t("fields.supportedLocales")}
            value={instance.supported_locales.join(", ")}
            lockReason={t("locks.supportedLocales")}
            mono
          />
          <Field label={t("fields.defaultCurrency")} value={instance.default_currency} mono />
          <Field label={t("fields.timezone")} value={instance.timezone} mono />
          <Field
            label={t("fields.storefrontDomains")}
            value={instance.storefront_domains.join(", ")}
            lockReason={t("locks.storefrontDomains")}
            mono
          />
          <Field
            label={t("fields.integrations")}
            value={instance.configured_integrations.join(", ")}
            lockReason={t("locks.integrations")}
            mono
          />
          <Field
            label={t("fields.lastSearchSync")}
            value={
              instance.last_search_sync_at
                ? new Date(instance.last_search_sync_at).toLocaleString()
                : ""
            }
          />
          <Field
            label={t("fields.updatedAt")}
            value={new Date(instance.updated_at).toLocaleString()}
          />
        </div>
      )}
    </section>
  );
}
