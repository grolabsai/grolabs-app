"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createBrand, updateBrand, deleteBrand } from "./actions";
import type { BrandRow } from "./_types";

type FormState = {
  brand_name: string;
  manufacturer: string;
};

const DEFAULT_FORM: FormState = {
  brand_name: "",
  manufacturer: "",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BrandEditor({
  brand,
  productCount,
  mode,
}: {
  brand: BrandRow | null;
  productCount: number;
  mode: "empty" | "create" | "edit";
}) {
  const t = useTranslations("catalog.brands");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setFormState] = useState<FormState>(
    brand
      ? {
          brand_name: brand.brand_name,
          manufacturer: brand.manufacturer ?? "",
        }
      : DEFAULT_FORM,
  );

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  }

  function handleSave() {
    startTransition(async () => {
      setError(null);
      const input = {
        brand_name: form.brand_name,
        manufacturer: form.manufacturer || null,
      };

      if (mode === "create") {
        const result = await createBrand(input);
        if ("error" in result) {
          setError(
            result.error === "EMPTY_NAME" ? t("errors.emptyName") : result.error ?? null,
          );
        } else {
          router.push(`?id=${result.data!.brand_id}`);
        }
      } else if (brand) {
        const result = await updateBrand(brand.brand_id, input);
        if ("error" in result) {
          setError(
            result.error === "EMPTY_NAME" ? t("errors.emptyName") : result.error ?? null,
          );
        } else {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }
      }
    });
  }

  function handleDelete() {
    if (!brand) return;
    if (!window.confirm(t("actions.confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteBrand(brand.brand_id);
      if ("error" in result) {
        const err = result.error ?? "";
        if (err.startsWith("LINKED:")) {
          const n = err.split(":")[1];
          setError(t("actions.deleteLinked", { n }));
        } else {
          setError(err || null);
        }
      } else {
        router.push("/catalog/brands");
      }
    });
  }

  if (mode === "empty") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: 40,
        }}
      >
        <p style={{ color: "var(--s-text-tertiary)", fontSize: 13 }}>
          {t("empty.selectPrompt")}
        </p>
      </div>
    );
  }

  const isEdit = mode === "edit";
  const canSave = form.brand_name.trim().length > 0;

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 20px", color: "var(--s-text)" }}>
        {isEdit ? t("form.editTitle") : t("form.createTitle")}
      </h2>

      <SectionHeader>{t("form.sections.basic")}</SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.name")}</label>
        <input
          type="text"
          className="s-input"
          value={form.brand_name}
          placeholder={t("form.fields.namePlaceholder")}
          onChange={(e) => setField("brand_name", e.target.value)}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.manufacturer")}</label>
        <input
          type="text"
          className="s-input"
          value={form.manufacturer}
          placeholder={t("form.fields.manufacturerPlaceholder")}
          onChange={(e) => setField("manufacturer", e.target.value)}
        />
        <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
          {t("form.fields.manufacturerDesc")}
        </div>
      </div>

      {isEdit && brand && (
        <>
          <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.meta")}</SectionHeader>
          <MetaRow label={t("form.meta.id")} value={String(brand.brand_id)} mono />
          <MetaRow
            label={t("form.meta.products")}
            value={String(productCount)}
          />
          <MetaRow label={t("form.meta.created")} value={formatDate(brand.created_at)} />
          <MetaRow label={t("form.meta.updated")} value={formatDate(brand.updated_at)} />
        </>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
          paddingTop: 16,
          borderTop: "0.5px solid var(--s-border)",
        }}
      >
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={handleSave}
          disabled={isPending || !canSave}
        >
          {isPending ? t("actions.saving") : t("actions.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "var(--s-success)" }}>{t("actions.saved")}</span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>
        )}
        {isEdit && brand && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--s-danger)",
              background: "none",
              border: "0.5px solid var(--s-danger)",
              borderRadius: "var(--s-radius-md)",
              padding: "5px 10px",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
            }}
          >
            {t("actions.delete")}
          </button>
        )}
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

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        fontSize: 12,
        borderBottom: "0.5px dashed var(--s-border)",
      }}
    >
      <span style={{ color: "var(--s-text-tertiary)" }}>{label}</span>
      <span
        style={{
          color: "var(--s-text)",
          fontFamily: mono ? "var(--s-font-mono, ui-monospace, monospace)" : undefined,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
