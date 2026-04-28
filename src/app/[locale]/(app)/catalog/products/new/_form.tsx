"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createProduct } from "../_actions";
import { Combobox } from "@/components/ui/combobox";
import type { ProductTypeOption, BrandOption, CategoryOption } from "../_types";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Props = {
  productTypes: ProductTypeOption[];
  brands: BrandOption[];
  categories: CategoryOption[];
};

export function ProductCreateForm({ productTypes, brands, categories }: Props) {
  const t = useTranslations("catalog.products");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slugManual, setSlugManual] = useState(false);

  const [form, setFormState] = useState({
    product_name: "",
    slug: "",
    product_type_id: null as number | null,
    brand_id: null as number | null,
    primary_category_id: null as number | null,
    short_description: "",
    image_url: "",
    is_active: true,
    is_consignment: false,
    track_inventory: true,
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setFormState((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "product_name" && !slugManual) {
        next.slug = slugify(value as string);
      }
      return next;
    });
    setError(null);
  }

  function handleSave() {
    if (!form.product_name.trim()) { setError(t("form.validation.nameRequired")); return; }
    if (!form.slug.trim()) { setError(t("form.validation.slugRequired")); return; }
    if (!form.product_type_id) { setError(t("form.validation.typeRequired")); return; }
    if (!form.primary_category_id) { setError(t("form.validation.categoryRequired")); return; }

    startTransition(async () => {
      const result = await createProduct({
        product_name: form.product_name.trim(),
        slug: form.slug.trim(),
        product_type_id: form.product_type_id!,
        brand_id: form.brand_id,
        primary_category_id: form.primary_category_id,
        short_description: form.short_description || null,
        image_url: form.image_url || null,
        is_active: form.is_active,
        is_consignment: form.is_consignment,
        track_inventory: form.track_inventory,
      });
      if ("error" in result) {
        setError(result.error ?? null);
      } else {
        router.push(`/catalog/products/${result.data!.product_id}`);
      }
    });
  }

  const typeOptions = productTypes.map((pt) => ({ value: pt.product_type_id, label: pt.type_name }));
  const brandOptions = brands.map((b) => ({ value: b.brand_id, label: b.brand_name }));
  const catOptions = categories.map((c) => ({
    value: c.category_id,
    label: c.category_name,
    hint: c.level > 1 ? `niv. ${c.level}` : undefined,
  }));

  return (
    <div style={{ maxWidth: 600 }}>
      <SectionHeader>{t("form.sections.basic")}</SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.name")}</label>
        <input
          type="text"
          className="s-input"
          value={form.product_name}
          placeholder={t("form.fields.namePlaceholder")}
          onChange={(e) => setField("product_name", e.target.value)}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.slug")}</label>
        <input
          type="text"
          className="s-input s-input-mono"
          value={form.slug}
          onChange={(e) => { setSlugManual(true); setField("slug", e.target.value); }}
        />
        <div style={{ fontSize: 10, color: "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
          {slugManual ? t("form.fields.slugManualHint") : t("form.fields.slugAutoHint")}
        </div>
      </div>

      <div className="s-row-pair">
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.type")}</label>
          <Combobox
            options={typeOptions}
            value={form.product_type_id}
            onValueChange={(v) => setField("product_type_id", v as number | null)}
            placeholder={t("form.fields.typePlaceholder")}
            searchPlaceholder={t("form.fields.typeSearch")}
          />
        </div>
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.brand")}</label>
          <Combobox
            options={brandOptions}
            value={form.brand_id}
            onValueChange={(v) => setField("brand_id", v as number | null)}
            placeholder={t("form.fields.brandPlaceholder")}
            searchPlaceholder={t("form.fields.brandSearch")}
          />
        </div>
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.primaryCategory")}</label>
        <Combobox
          options={catOptions}
          value={form.primary_category_id}
          onValueChange={(v) => setField("primary_category_id", v as number | null)}
          placeholder={t("form.fields.categoryPlaceholder")}
          searchPlaceholder={t("form.fields.categorySearch")}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.shortDescription")}</label>
        <textarea
          className="s-textarea"
          rows={2}
          value={form.short_description}
          onChange={(e) => setField("short_description", e.target.value)}
        />
      </div>

      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.image")}</SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.imageUrl")}</label>
        <input
          type="url"
          className="s-input"
          value={form.image_url}
          placeholder={t("form.fields.imageUrlPlaceholder")}
          onChange={(e) => setField("image_url", e.target.value)}
        />
      </div>

      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.config")}</SectionHeader>

      <ToggleRow
        title={t("form.fields.isActive")}
        desc={t("form.fields.isActiveDesc")}
        value={form.is_active}
        onChange={(v) => setField("is_active", v)}
      />
      <ToggleRow
        title={t("form.fields.trackInventory")}
        desc={t("form.fields.trackInventoryDesc")}
        value={form.track_inventory}
        onChange={(v) => setField("track_inventory", v)}
      />
      <ToggleRow
        title={t("form.fields.isConsignment")}
        desc={t("form.fields.isConsignmentDesc")}
        value={form.is_consignment}
        onChange={(v) => setField("is_consignment", v)}
      />

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
          disabled={isPending}
        >
          {isPending ? t("actions.creating") : t("actions.create")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={() => router.push("/catalog/products")}
          disabled={isPending}
        >
          {t("actions.back")}
        </button>
        {error && <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>}
      </div>
    </div>
  );
}

function SectionHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
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

function ToggleRow({
  title,
  desc,
  value,
  onChange,
}: {
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="s-toggle-row">
      <div className="s-toggle-info">
        <div className="s-toggle-title">{title}</div>
        <div className="s-toggle-sub">{desc}</div>
      </div>
      <button
        type="button"
        className={`s-toggle${value ? " on" : ""}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      />
    </div>
  );
}
