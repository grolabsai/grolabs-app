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
import {
  deleteProduct,
  updateProductField,
} from "@/lib/actions/product";
import { formatGTQ, formatRelative } from "@/lib/format";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VariantForDisplay = {
  variant_id: number;
  variant_name: string | null;
  variant_label: string | null;
  sku: string | null;
  barcode: string | null;
  weight_grams: string | null;
  is_active: boolean;
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
  product_name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  is_active: boolean;
  is_consignment: boolean;
  track_inventory: boolean;
  created_at: string;
  updated_at: string;
  wazudb1_id: string | null;
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
};

// ─── Editor ─────────────────────────────────────────────────────────────────

export function ProductEditor({ product, productTypes, brands }: Props) {
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

  return (
    <>
      {/* Title row */}
      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">
            {product.product_name}
            {product.is_active ? (
              <span className="s-tag s-tag-success">Activo</span>
            ) : (
              <span className="s-tag s-tag-neutral">Inactivo</span>
            )}
            {product.is_consignment ? (
              <span className="s-tag s-tag-neutral">Consignación</span>
            ) : null}
          </h1>
          <p className="s-meta">
            ID {product.product_id} · creado {formatRelative(product.created_at)}{" "}
            · actualizado {formatRelative(product.updated_at)}
          </p>
        </div>
        <div className="s-title-actions" style={{ alignItems: "center" }}>
          <SaveIndicator lastSavedAt={lastSavedAt} now={now} />
          <Link href={"/catalog/products"} className="s-btn s-btn-secondary">
            Volver
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
            <p className="s-card-label">{tFields("name")}</p>
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

          {/* ── Configuración y proveedor (editable) ── */}
          <div className="s-card">
            <p className="s-card-label">Configuración y proveedor</p>
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
                    emptyLabel={tFields("noBrand")}
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
                    placeholder="—"
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Atributos del producto (read-only) ── */}
          <div className="s-card">
            <p className="s-card-label">Atributos del producto</p>
            {product.product_attribute_value.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
                Sin atributos asignados.
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
                        {av.product_attribute?.attribute_name ?? "—"}
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

        {/* ── Right column: gallery + summary (read-only) ── */}
        <div className="s-col-stack">
          <div className="s-card">
            <div className="s-card-header">
              <p className="s-card-label" style={{ margin: 0 }}>
                Galería
              </p>
              <button className="s-card-link" type="button" disabled>
                Subir nueva
              </button>
            </div>
            <div className="s-gallery-main">
              <div className="s-gallery-main-label">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  width="24"
                  height="24"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="9" cy="11" r="2" />
                  <path d="M21 16l-5-5-8 8" />
                </svg>
                <span>Sin imagen principal</span>
              </div>
            </div>
            <div className="s-gallery-thumbs">
              <div className="s-thumb" />
              <div className="s-thumb" />
              <div className="s-thumb" />
              <div className="s-thumb" />
            </div>
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
              Resumen
            </div>
            <SummaryRow label="Variantes" value={`${variants.length}`} />
            <SummaryRow
              label="Activas"
              value={`${variants.filter((v) => v.is_active).length}`}
            />
            <SummaryRow
              label="Con SKU"
              value={`${variants.filter((v) => v.sku).length}`}
            />
            <SummaryRow
              label="Con barcode"
              value={`${variants.filter((v) => v.barcode).length}`}
            />
            {product.wazudb1_id ? (
              <SummaryRow
                label="ID origen"
                value={product.wazudb1_id.slice(0, 8) + "…"}
                mono
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Variants table (read-only in Pass 3; Pass 4 makes editable) ── */}
      <div className="s-card" style={{ marginBottom: 16 }}>
        <div className="s-card-header">
          <div>
            <h3 className="s-card-h">Variantes</h3>
            <p className="s-card-sub">
              Presentaciones, SKUs y precios por variante.
            </p>
          </div>
          <button className="s-btn s-btn-ghost" type="button" disabled>
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M7 2v10M2 7h10" />
            </svg>
            Nueva variante
          </button>
        </div>
        <div className="s-table-wrap">
          <table className="s-table">
            <thead>
              <tr>
                <th>Variante</th>
                <th>SKU</th>
                <th>Código de barras</th>
                <th>Peso</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Costo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="s-empty" style={{ padding: "32px 20px" }}>
                      <div className="s-empty-sub">
                        Este producto aún no tiene variantes.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                variants.map((v) => {
                  const retail = v.product_pricing?.find(
                    (p) => p.channel === "retail",
                  );
                  return (
                    <tr key={v.variant_id}>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {v.variant_name ?? "—"}
                        </div>
                        {v.variant_label && v.variant_label !== v.variant_name ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--s-text-tertiary)",
                            }}
                          >
                            {v.variant_label}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {v.sku ? <span className="s-sku">{v.sku}</span> : "—"}
                      </td>
                      <td>
                        {v.barcode ? (
                          <span className="s-barcode">{v.barcode}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {v.weight_grams ? (
                          <span className="s-size-pill">
                            {formatWeight(v.weight_grams)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-right tabular">
                        {formatGTQ(retail?.list_price)}
                      </td>
                      <td
                        className="text-right tabular"
                        style={{ color: "var(--s-text-secondary)" }}
                      >
                        {formatGTQ(retail?.cost_price)}
                      </td>
                      <td>
                        <div className="s-dot-row">
                          <div
                            className={`s-dot ${v.is_active ? "success" : "neutral"}`}
                          />
                          <span style={{ fontSize: 12 }}>
                            {v.is_active ? "Activa" : "Inactiva"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
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

function formatWeight(grams: string | number): string {
  const n = typeof grams === "number" ? grams : Number(grams);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) {
    const kg = n / 1000;
    return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
  }
  return `${n} g`;
}
