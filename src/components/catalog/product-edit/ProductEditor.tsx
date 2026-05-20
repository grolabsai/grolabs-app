"use client";

import {
  useCallback,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import {
  InlineSelect,
  InlineSwitch,
  InlineText,
  InlineTextarea,
} from "./InlineFields";
import { VariantsTable } from "./VariantsTable";
import { PhotoManager, type PhotoState } from "./PhotoManager";
import {
  deleteProduct,
  updateProductField,
  updateProductPhotos,
  updateVariantPhotos,
} from "@/lib/actions/product";
import { formatRelative, formatCurrency } from "@/lib/format";
import { sanitizeDescriptionHtml } from "@/lib/sanitizeHtml";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VariantForDisplay = {
  variant_id: number;
  variant_name: string | null;
  variant_label: string | null;
  sku: string | null;
  barcode: string | null;
  weight_grams: string | null;
  is_active: boolean;
  woocommerce_id: number | null;
  product_pricing: Array<{
    list_price: string | null;
    cost_price: string | null;
    channel: string;
  }>;
};

export type AttributeValueForDisplay = {
  attribute_id: number;
  product_attribute: { attribute_name: string; attribute_code: string } | null;
  value_id: number | null;
  value_text: string | null;
  product_attribute_option: { value: string } | null;
};

export type ProductDetail = {
  product_id: number;
  instance_id: number;
  product_name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  sale_price: number | null;
  cost: number | null;
  stock_quantity: number | null;
  image_url: string | null;
  is_active: boolean;
  is_consignment: boolean;
  track_inventory: boolean;
  created_at: string;
  updated_at: string;
  wazudb1_id: string | null;
  woocommerce_id: number | null;
  product_type_id: number;
  brand_id: number | null;
  product_type: {
    product_type_id: number;
    type_name: string;
    type_code: string;
    kind: string;
  } | null;
  brand: { brand_id: number; brand_name: string } | null;
  product_variant: VariantForDisplay[];
  product_attribute_value: AttributeValueForDisplay[];
  product_category_link: Array<{
    is_primary: boolean;
    category: { category_name: string; slug: string } | null;
  }>;
  product_media: Array<{
    media_id: number;
    variant_id: number | null;
    image_url: string;
    alt_text: string | null;
    is_primary: boolean;
    sort_order: number;
  }>;
};

export type ProductTypeOption = {
  product_type_id: number;
  type_name: string;
};

export type BrandOption = {
  brand_id: number;
  brand_name: string;
};

type Props = {
  product: ProductDetail;
  productTypes: ProductTypeOption[];
  brands: BrandOption[];
  currency: string;
};

// ─── Editor ─────────────────────────────────────────────────────────────────

export function ProductEditor({
  product,
  productTypes,
  brands,
  currency,
}: Props) {
  const t = useTranslations("product.detail");
  const tFields = useTranslations("product.fields");
  const router = useRouter();

  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Tick a "now" every second so the "hace Xs" indicator stays current.
  // useSyncExternalStore is the canonical React 19 pattern for this —
  // keeps the render pure (no Date.now() in body) and avoids the
  // setState-in-effect trap.
  const now = useSyncExternalStore(
    subscribeOneSecond,
    getNowSnapshot,
    getServerNowSnapshot,
  );

  const onSaved = useCallback(() => setLastSavedAt(Date.now()), []);

  const saver = useCallback(
    (field: string) => async (value: unknown) =>
      updateProductField({
        productId: product.product_id,
        field,
        value,
      }),
    [product.product_id],
  );

  const variants = product.product_variant ?? [];
  const primaryCategory = product.product_category_link?.find((l) => l.is_primary)?.category;

  // Photo gallery state — seeded from product_media (product scope =
  // variant_id IS NULL). Per-variant galleries live in VariantsTable
  // and use updateVariantPhotos. Both reconcile INSERT/UPDATE/DELETE
  // against the desired set and trigger a search index refresh.
  const productLevelMedia = (product.product_media ?? []).filter(
    (m) => m.variant_id === null,
  );
  const initialPhotos: PhotoState[] = productLevelMedia
    .slice()
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((m, idx) => ({
      mediaId: m.media_id,
      url: m.image_url,
      altText: m.alt_text,
      isPrimary: m.is_primary,
      sortOrder: m.sort_order ?? idx,
    }));
  const [photos, setPhotos] = useState<PhotoState[]>(initialPhotos);
  const [photosSaving, setPhotosSaving] = useState(false);

  const persistPhotos = useCallback(
    async (next: PhotoState[]) => {
      setPhotosSaving(true);
      const r = await updateProductPhotos({
        productId: product.product_id,
        photos: next.map((p, idx) => ({
          mediaId: p.mediaId,
          url: p.url,
          altText: p.altText,
          isPrimary: p.isPrimary,
          sortOrder: idx,
        })),
      });
      setPhotosSaving(false);
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
        return;
      }
      onSaved();
      router.refresh();
    },
    [product.product_id, onSaved, router, t],
  );

  const onPhotoAdd = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPhotos((ps) => {
      const next: PhotoState[] = [
        ...ps,
        {
          url: trimmed,
          altText: null,
          isPrimary: ps.length === 0,
          sortOrder: ps.length,
        },
      ];
      void persistPhotos(next);
      return next;
    });
  };

  const onPhotoRemove = (idx: number) => {
    setPhotos((ps) => {
      const next = ps.filter((_, i) => i !== idx).map((p, i) => ({ ...p, sortOrder: i }));
      if (next.length > 0 && !next.some((p) => p.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      void persistPhotos(next);
      return next;
    });
  };

  const onPhotoSetPrimary = (idx: number) => {
    setPhotos((ps) => {
      const next = ps.map((p, i) => ({ ...p, isPrimary: i === idx }));
      void persistPhotos(next);
      return next;
    });
  };

  const onPhotoReorder = (from: number, to: number) => {
    setPhotos((ps) => {
      if (from === to || from < 0 || to < 0 || from >= ps.length || to >= ps.length) return ps;
      const next = ps.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const renumbered = next.map((p, i) => ({ ...p, sortOrder: i }));
      void persistPhotos(renumbered);
      return renumbered;
    });
  };

  const onPhotoAltTextChange = (idx: number, altText: string) => {
    setPhotos((ps) => {
      const next = ps.map((p, i) =>
        i === idx ? { ...p, altText: altText || null } : p,
      );
      void persistPhotos(next);
      return next;
    });
  };

  // Group variant-scoped media by variant_id for the per-variant
  // galleries inside VariantsTable. Each entry is keyed on variant_id
  // so the table can pluck the right initial set.
  const variantPhotosById = new Map<number, PhotoState[]>();
  for (const m of product.product_media ?? []) {
    if (m.variant_id === null) continue;
    const list = variantPhotosById.get(m.variant_id) ?? [];
    list.push({
      mediaId: m.media_id,
      url: m.image_url,
      altText: m.alt_text,
      isPrimary: m.is_primary,
      sortOrder: m.sort_order ?? list.length,
    });
    variantPhotosById.set(m.variant_id, list);
  }
  for (const list of variantPhotosById.values()) {
    list.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }

  const persistVariantPhotos = useCallback(
    async (variantId: number, next: PhotoState[]) => {
      const r = await updateVariantPhotos({
        productId: product.product_id,
        variantId,
        photos: next.map((p, idx) => ({
          mediaId: p.mediaId,
          url: p.url,
          altText: p.altText,
          isPrimary: p.isPrimary,
          sortOrder: idx,
        })),
      });
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
        return;
      }
      onSaved();
      router.refresh();
    },
    [product.product_id, onSaved, router, t],
  );

  return (
    <>
      {/* Title row */}
      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">
            {product.product_name}
            {product.is_active ? (
              <span className="s-tag s-tag-success">{t("tags.active")}</span>
            ) : (
              <span className="s-tag s-tag-neutral">{t("tags.inactive")}</span>
            )}
            {product.is_consignment ? (
              <span className="s-tag s-tag-neutral">{t("tags.consignment")}</span>
            ) : null}
          </h1>
          <p className="s-meta">
            {t("meta", {
              id: product.product_id,
              created: formatRelative(product.created_at),
              updated: formatRelative(product.updated_at),
            })}
          </p>
          <p className="s-meta" style={{ marginTop: 2 }}>
            <WoocommerceIdBadge id={product.woocommerce_id} />
          </p>
        </div>
        <div className="s-title-actions" style={{ alignItems: "center" }}>
          <SaveIndicator lastSavedAt={lastSavedAt} now={now} />
          <Link href={"/catalog/products"} className="s-btn s-btn-secondary">
            {t("back")}
          </Link>
          <DeleteProductButton
            productId={product.product_id}
            onDeleted={() => router.push("/catalog/products")}
          />
        </div>
      </div>

      <div className="s-grid">
        <div className="s-col-stack">
          {/* ── Información básica (editable) ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.basicInfo")}</p>
            <div className="s-field">
              <label className="s-field-label">{tFields("name")}</label>
              <InlineText
                initial={product.product_name}
                onSave={saver("product_name")}
                onSaved={onSaved}
                ariaLabel={tFields("name")}
              />
            </div>
            <div className="s-field">
              <label className="s-field-label">{tFields("shortDescription")}</label>
              <InlineTextarea
                initial={product.short_description}
                onSave={saver("short_description")}
                onSaved={onSaved}
                rows={2}
                ariaLabel={tFields("shortDescription")}
              />
              <HtmlPreview html={product.short_description} />
            </div>
            <div className="s-field">
              <label className="s-field-label">{tFields("longDescription")}</label>
              <InlineTextarea
                initial={product.long_description}
                onSave={saver("long_description")}
                onSaved={onSaved}
                rows={4}
                ariaLabel={tFields("longDescription")}
              />
              <HtmlPreview html={product.long_description} />
            </div>
            <div className="s-row-pair">
              <div className="s-field">
                <label className="s-field-label">{tFields("slug")}</label>
                <InlineText
                  initial={product.slug}
                  onSave={saver("slug")}
                  onSaved={onSaved}
                  monospace
                  ariaLabel={tFields("slug")}
                />
              </div>
              <div className="s-field">
                <label className="s-field-label">{tFields("type")}</label>
                <InlineSelect
                  initial={product.product_type_id}
                  options={productTypes.map((p) => ({
                    id: p.product_type_id,
                    label: p.type_name,
                  }))}
                  onSave={saver("product_type_id")}
                  onSaved={onSaved}
                  ariaLabel={tFields("type")}
                />
              </div>
            </div>
          </div>

          {/* ── Precios e inventario (read-only, import snapshot) ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.pricing")}</p>
            <div className="s-row-pair">
              <ReadOnlyField
                label={tFields("price")}
                value={formatCurrency(product.price, currency)}
              />
              <ReadOnlyField
                label={tFields("salePrice")}
                value={formatCurrency(product.sale_price, currency)}
              />
            </div>
            <div className="s-row-pair">
              <ReadOnlyField
                label={tFields("cost")}
                value={formatCurrency(product.cost, currency)}
              />
              <ReadOnlyField
                label={tFields("stockQuantity")}
                value={
                  product.stock_quantity == null
                    ? "—"
                    : String(product.stock_quantity)
                }
              />
            </div>
            <div className="s-row-pair">
              <ReadOnlyField label={tFields("sku")} value={product.sku ?? ""} mono />
              <ReadOnlyField
                label={tFields("barcode")}
                value={product.barcode ?? ""}
                mono
              />
            </div>
            {variants.length > 0 ? (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--s-text-tertiary)",
                  marginTop: 8,
                }}
              >
                {t("pricing.variantNote")}
              </p>
            ) : null}
          </div>

          {/* ── Configuración y proveedor (editable) ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.config")}</p>
            <div className="s-row-pair">
              <div>
                <ToggleRow
                  title={tFields("active")}
                  sub={tFields("activeSub")}
                  initial={product.is_active}
                  onSave={saver("is_active") as (v: boolean) => Promise<{ ok: true } | { error: string }>}
                  onSaved={onSaved}
                />
                <ToggleRow
                  title={tFields("trackInventory")}
                  sub={tFields("trackInventorySub")}
                  initial={product.track_inventory}
                  onSave={saver("track_inventory") as (v: boolean) => Promise<{ ok: true } | { error: string }>}
                  onSaved={onSaved}
                />
                <ToggleRow
                  title={tFields("consignment")}
                  sub={tFields("consignmentSub")}
                  initial={product.is_consignment}
                  onSave={saver("is_consignment") as (v: boolean) => Promise<{ ok: true } | { error: string }>}
                  onSaved={onSaved}
                />
              </div>
              <div>
                <div className="s-field">
                  <label className="s-field-label">{tFields("brand")}</label>
                  <InlineSelect
                    initial={product.brand_id}
                    options={brands.map((b) => ({
                      id: b.brand_id,
                      label: b.brand_name,
                    }))}
                    allowNull
                    onSave={saver("brand_id")}
                    onSaved={onSaved}
                    ariaLabel={tFields("brand")}
                  />
                </div>
                <div className="s-field">
                  <label className="s-field-label">{tFields("category")}</label>
                  <input
                    className="s-input"
                    value={primaryCategory?.category_name ?? ""}
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Atributos del producto (read-only) ── */}
          <div className="s-card">
            <p className="s-card-label">{t("sections.attributes")}</p>
            {product.product_attribute_value.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
                {t("attributesEmpty")}
              </p>
            ) : (
              <div>
                {product.product_attribute_value.map((av, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 0",
                      borderBottom:
                        idx < product.product_attribute_value.length - 1
                          ? "0.5px solid var(--s-border)"
                          : "none",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {av.product_attribute?.attribute_name ?? ""}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--s-text-tertiary)",
                          fontFamily: "var(--s-font-mono)",
                          marginTop: 1,
                        }}
                      >
                        {av.product_attribute?.attribute_code ?? ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--s-text-secondary)" }}>
                      {av.product_attribute_option?.value ??
                        av.value_text ??
                        "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: gallery + summary ── */}
        <div className="s-col-stack">
          <div className="s-card">
            <p className="s-card-label">{t("sections.gallery")}</p>
            <PhotoManager
              photos={photos}
              onAdd={onPhotoAdd}
              onRemove={onPhotoRemove}
              onSetPrimary={onPhotoSetPrimary}
              onReorder={onPhotoReorder}
              onAltTextChange={onPhotoAltTextChange}
              disabled={photosSaving}
            />
          </div>

          <div
            style={{
              background: "var(--scout-accent-50)",
              borderRadius: "var(--s-radius-lg)",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                color: "var(--scout-accent-800)",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {t("sections.summary")}
            </div>
            <SummaryRow label={t("summary.variants")} value={`${variants.length}`} />
            <SummaryRow
              label={t("summary.active")}
              value={`${variants.filter((v) => v.is_active).length}`}
            />
            <SummaryRow
              label={t("summary.withSku")}
              value={`${variants.filter((v) => v.sku).length}`}
            />
            <SummaryRow
              label={t("summary.withBarcode")}
              value={`${variants.filter((v) => v.barcode).length}`}
            />
            {product.wazudb1_id ? (
              <SummaryRow
                label={t("summary.sourceId")}
                value={product.wazudb1_id.slice(0, 8) + "…"}
                mono
              />
            ) : null}
          </div>
        </div>
      </div>

      <VariantsTable
        productId={product.product_id}
        variants={variants}
        variantPhotosById={variantPhotosById}
        onVariantPhotosChange={persistVariantPhotos}
        onSaved={onSaved}
      />
    </>
  );
}

// ─── WooCommerce ID badge ──────────────────────────────────────────────────

/**
 * Compact display for product/variant.woocommerce_id. Shows the numeric WC
 * post id when present; renders a "Pendiente" pill when null. The GroLabs→WC
 * push captures the id and writes it back; until that happens, the row is
 * not yet round-tripped and the search index skips it.
 */
export function WoocommerceIdBadge({ id }: { id: number | null }) {
  const t = useTranslations("product.detail");
  if (id == null) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "1px 8px",
          background: "var(--s-surface-alt)",
          color: "var(--s-text-secondary)",
          border: "0.5px solid var(--s-border)",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        {t("wcId.pending")}
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
      {t("wcId.label")}{" "}
      <span style={{ fontFamily: "var(--s-font-mono)", color: "var(--s-text)" }}>{id}</span>
    </span>
  );
}

// ─── Save indicator ─────────────────────────────────────────────────────────

function SaveIndicator({
  lastSavedAt,
  now,
}: {
  lastSavedAt: number | null;
  now: number;
}) {
  const t = useTranslations("product.detail");
  if (lastSavedAt === null || now === 0) return null;
  const elapsed = Math.max(0, Math.floor((now - lastSavedAt) / 1000));
  const label =
    elapsed < 3
      ? t("savedJustNow")
      : t("savedAgo", { time: formatElapsed(elapsed) });
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--s-text-tertiary)",
        fontVariantNumeric: "tabular-nums",
      }}
      role="status"
    >
      {label}
    </span>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// External-store helpers for the second-by-second tick driving the save
// indicator. Defined at module scope so the subscriber/snapshot
// functions retain a stable identity across renders.
function subscribeOneSecond(cb: () => void): () => void {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}
function getNowSnapshot(): number {
  return Date.now();
}
function getServerNowSnapshot(): number {
  return 0;
}

// ─── Toggle row ─────────────────────────────────────────────────────────────

function ToggleRow({
  title,
  sub,
  initial,
  onSave,
  onSaved,
}: {
  title: string;
  sub: string;
  initial: boolean;
  onSave: (v: boolean) => Promise<{ ok: true } | { error: string }>;
  onSaved: () => void;
}) {
  return (
    <div className="s-toggle-row">
      <div className="s-toggle-info">
        <p className="s-toggle-title">{title}</p>
        <p className="s-toggle-sub">{sub}</p>
      </div>
      <InlineSwitch
        initial={initial}
        onSave={onSave}
        onSaved={onSaved}
        ariaLabel={title}
      />
    </div>
  );
}

// ─── Delete-product inline-confirm ─────────────────────────────────────────

function DeleteProductButton({
  productId,
  onDeleted,
}: {
  productId: number;
  onDeleted: () => void;
}) {
  const t = useTranslations("product.detail");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
          {t("deleteConfirm")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const r = await deleteProduct({ productId });
              if ("error" in r) {
                toast.error(t("saveError"), { description: r.error });
                setConfirming(false);
                return;
              }
              toast.success(t("deleteSuccess"));
              onDeleted();
            });
          }}
        >
          {t("deleteConfirmYes")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          {t("deleteConfirmNo")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setConfirming(true)}
    >
      {t("delete")}
    </Button>
  );
}

// ─── Sanitized HTML description preview ─────────────────────────────────────

/**
 * WC descriptions are HTML. The textarea above shows the raw source so it
 * stays editable; this box renders the sanitized result so the merchant
 * sees what the description actually looks like. Hidden when empty.
 */
function HtmlPreview({ html }: { html: string | null }) {
  const t = useTranslations("product.detail");
  const clean = sanitizeDescriptionHtml(html);
  if (!clean.trim()) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--s-text-tertiary)",
          marginBottom: 4,
        }}
      >
        {t("htmlPreview")}
      </div>
      <div
        className="s-html-preview"
        style={{
          fontSize: 13,
          color: "var(--s-text-secondary)",
          background: "var(--s-surface-alt)",
          border: "0.5px solid var(--s-border)",
          borderRadius: 6,
          padding: "10px 12px",
          maxHeight: 280,
          overflow: "auto",
        }}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </div>
  );
}

// ─── Read-only field ────────────────────────────────────────────────────────

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="s-field">
      <label className="s-field-label">{label}</label>
      <input
        className={`s-input ${mono ? "s-input-mono" : ""}`}
        value={value}
        readOnly
        disabled
      />
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
  mono = false,
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
        padding: "5px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--scout-accent-800)", opacity: 0.85 }}>
        {label}
      </span>
      <span
        style={{
          color: "var(--scout-accent-800)",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          fontFamily: mono ? "var(--s-font-mono)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

