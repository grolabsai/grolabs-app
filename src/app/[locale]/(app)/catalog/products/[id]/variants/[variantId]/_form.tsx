"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateVariant, deactivateVariant } from "../../../_actions";

type InitialValues = {
  variant_name: string;
  variant_label: string;
  sku: string;
  barcode: string;
  image_url: string;
  is_active: boolean;
};

type Props = {
  variantId: number;
  productId: number;
  initial: InitialValues;
};

export function VariantEditForm({ variantId, productId, initial }: Props) {
  const t = useTranslations("catalog.variants");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [form, setFormState] = useState({
    variant_name: initial.variant_name,
    variant_label: initial.variant_label,
    sku: initial.sku,
    barcode: initial.barcode,
    image_url: initial.image_url,
    is_active: initial.is_active,
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSaved(false);
  }

  function handleSave() {
    if (!form.sku.trim()) {
      setError(t("form.validation.skuRequired"));
      return;
    }

    startTransition(async () => {
      const result = await updateVariant(variantId, productId, {
        variant_name: form.variant_name.trim() || undefined,
        variant_label: form.variant_label.trim() || undefined,
        sku: form.sku.trim(),
        barcode: form.barcode.trim() || null,
        image_url: form.image_url.trim() || null,
        is_active: form.is_active,
      });
      if ("error" in result) {
        setError(result.error ?? null);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  function handleDeactivate() {
    if (!window.confirm(t("actions.confirmDeactivate"))) return;
    startTransition(async () => {
      const result = await deactivateVariant(variantId, productId);
      if ("error" in result) {
        setError(result.error ?? null);
      } else {
        router.push(`/catalog/products/${productId}`);
      }
    });
  }

  return (
    <div>
      <SectionHeader>{t("form.sections.identity")}</SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.variantLabel")}</label>
        <input
          type="text"
          className="s-input"
          value={form.variant_label}
          onChange={(e) => setField("variant_label", e.target.value)}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.variantName")}</label>
        <input
          type="text"
          className="s-input"
          value={form.variant_name}
          onChange={(e) => setField("variant_name", e.target.value)}
        />
      </div>

      <div className="s-row-pair">
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.sku")}</label>
          <input
            type="text"
            className="s-input s-input-mono"
            value={form.sku}
            onChange={(e) => setField("sku", e.target.value)}
          />
        </div>
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.barcode")}</label>
          <input
            type="text"
            className="s-input s-input-mono"
            value={form.barcode}
            onChange={(e) => setField("barcode", e.target.value)}
          />
        </div>
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.imageUrl")}</label>
        <input
          type="url"
          className="s-input"
          value={form.image_url}
          onChange={(e) => setField("image_url", e.target.value)}
        />
      </div>

      <div className="s-toggle-row" style={{ marginTop: 4 }}>
        <div className="s-toggle-info">
          <div className="s-toggle-title">{t("form.fields.isActive")}</div>
          <div className="s-toggle-sub">{t("form.fields.isActiveDesc")}</div>
        </div>
        <button
          type="button"
          className={`s-toggle${form.is_active ? " on" : ""}`}
          onClick={() => setField("is_active", !form.is_active)}
          role="switch"
          aria-checked={form.is_active}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
          paddingTop: 16,
          borderTop: "0.5px solid var(--s-border)",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? t("actions.saving") : saved ? t("actions.saved") : t("actions.save")}
        </button>
        {initial.is_active ? (
          <button
            type="button"
            className="s-btn s-btn-secondary"
            onClick={handleDeactivate}
            disabled={isPending}
          >
            {t("actions.deactivate")}
          </button>
        ) : null}
        <button
          type="button"
          className="s-btn s-btn-ghost"
          onClick={() => router.push(`/catalog/products/${productId}`)}
          disabled={isPending}
        >
          {t("actions.back")}
        </button>
        {error && <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>}
      </div>
    </div>
  );
}

function SectionHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: "0.5px solid var(--s-border)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
