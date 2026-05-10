"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus } from "lucide-react";
import {
  createVariant,
  deleteVariant,
  updateVariantField,
  upsertVariantPricing,
} from "@/lib/actions/variant";
import { formatGTQ } from "@/lib/format";
import { WoocommerceIdBadge, type VariantForDisplay } from "./ProductEditor";

type Props = {
  productId: number;
  variants: VariantForDisplay[];
  onSaved: () => void;
};

/**
 * Variant table — Pass 4a shape.
 *
 * Inline cell editing on the existing seven columns (variant_name, sku,
 * barcode, weight_grams, list_price retail, cost_price retail, is_active),
 * per-row delete with inline confirm, and a draft-row "+ Agregar variante"
 * flow that creates the variant on first commit.
 *
 * Pass 4b (deferred) adds the dynamic axis columns: one column per
 * variant axis defined on the product's category, with categorical
 * dropdowns for text axes and number+unit composite cells for
 * data_type='quantity' axes. The action surface to support that
 * (updateVariantAxisValue) is already in place.
 */
export function VariantsTable({ productId, variants, onSaved }: Props) {
  const t = useTranslations("product.variants");

  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [pending, startTransition] = useTransition();
  const draftFirstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft) draftFirstInputRef.current?.focus();
  }, [draft]);

  function startDraft() {
    setDraft({
      variant_name: "",
      sku: "",
      barcode: "",
      weight_grams: "",
      list_price: "",
      cost_price: "",
      is_active: true,
    });
  }

  function cancelDraft() {
    setDraft(null);
  }

  const commitDraft = useCallback(() => {
    if (!draft) return;
    if (!draftHasContent(draft)) return; // empty draft stays open

    const weight = parseOrNull(draft.weight_grams);
    const listPrice = parseOrNull(draft.list_price);
    const costPrice = parseOrNull(draft.cost_price);

    startTransition(async () => {
      const r = await createVariant({
        productId,
        variant_name: draft.variant_name || null,
        sku: draft.sku || null,
        barcode: draft.barcode || null,
        weight_grams: weight,
        is_active: draft.is_active,
      });
      if ("error" in r) {
        toast.error(t("delete"), { description: r.error });
        return;
      }
      // Pricing is a separate row in product_pricing — upsert if the
      // user typed any price into the draft. Cost price alone (without
      // list_price) can't be saved because list_price is NOT NULL on
      // product_pricing; we only call the pricing upsert when there's a
      // list price.
      if (listPrice !== null) {
        const pr = await upsertVariantPricing({
          variantId: r.variantId,
          listPrice,
          costPrice,
        });
        if ("error" in pr) {
          toast.error(t("delete"), { description: pr.error });
        }
      }
      onSaved();
      setDraft(null);
    });
  }, [draft, productId, onSaved, startTransition, t]);

  return (
    <div className="s-card" style={{ marginBottom: 16 }}>
      <div className="s-card-header">
        <div>
          <h3 className="s-card-h">Variantes</h3>
          <p className="s-card-sub">
            Presentaciones, SKUs y precios por variante.
          </p>
        </div>
      </div>
      <div className="s-table-wrap">
        <table className="s-table">
          <thead>
            <tr>
              <th>Variante</th>
              <th>SKU</th>
              <th>Código de barras</th>
              <th>Peso (g)</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Costo</th>
              <th>WC ID</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 && !draft ? (
              <tr>
                <td colSpan={9}>
                  <div className="s-empty" style={{ padding: "32px 20px" }}>
                    <div className="s-empty-sub">
                      Este producto aún no tiene variantes.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {variants.map((v) => (
                  <VariantRow
                    key={v.variant_id}
                    variant={v}
                    onSaved={onSaved}
                  />
                ))}
                {draft ? (
                  <DraftVariantRow
                    draft={draft}
                    setDraft={setDraft}
                    firstInputRef={draftFirstInputRef}
                    onCommit={commitDraft}
                    onCancel={cancelDraft}
                    pending={pending}
                  />
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 16px", borderTop: "0.5px solid var(--s-border)" }}>
        <button
          type="button"
          className="s-btn s-btn-ghost"
          onClick={startDraft}
          disabled={!!draft || pending}
        >
          <Icon icon={Plus} size={14} />
          {t("add")}
        </button>
      </div>
    </div>
  );
}

// ─── Saved variant row ─────────────────────────────────────────────────────

function VariantRow({
  variant,
  onSaved,
}: {
  variant: VariantForDisplay;
  onSaved: () => void;
}) {
  const t = useTranslations("product.variants");
  const tDetail = useTranslations("product.detail");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, startTransition] = useTransition();

  const retail = variant.product_pricing?.find((p) => p.channel === "retail");
  const listPrice = retail?.list_price ? Number(retail.list_price) : null;
  const costPrice = retail?.cost_price ? Number(retail.cost_price) : null;

  const fieldSaver =
    (field: string) =>
    async (value: unknown): Promise<{ ok: true } | { error: string }> =>
      updateVariantField({
        variantId: variant.variant_id,
        field,
        value,
      });

  const priceSaver = async (
    next: number | null,
    which: "list_price" | "cost_price",
  ): Promise<{ ok: true } | { error: string }> => {
    // We only allow updating cost when a list_price exists — list_price
    // is NOT NULL in product_pricing.
    const newList = which === "list_price" ? next : listPrice;
    const newCost = which === "cost_price" ? next : costPrice;
    if (newList === null) {
      return { error: "Set a list price first" };
    }
    return upsertVariantPricing({
      variantId: variant.variant_id,
      listPrice: newList,
      costPrice: newCost,
    });
  };

  function handleDelete() {
    startTransition(async () => {
      const r = await deleteVariant({ variantId: variant.variant_id });
      if ("error" in r) {
        toast.error(tDetail("saveError"), { description: r.error });
        setConfirmingDelete(false);
        return;
      }
      toast.success(t("deleteSuccess"));
      onSaved();
    });
  }

  return (
    <tr>
      <td>
        <CellText
          initial={variant.variant_name}
          onSave={fieldSaver("variant_name")}
          onSaved={onSaved}
        />
      </td>
      <td>
        <CellText
          initial={variant.sku}
          onSave={fieldSaver("sku")}
          onSaved={onSaved}
          monospace
        />
      </td>
      <td>
        <CellText
          initial={variant.barcode}
          onSave={fieldSaver("barcode")}
          onSaved={onSaved}
          monospace
        />
      </td>
      <td>
        <CellNumber
          initial={variant.weight_grams ? Number(variant.weight_grams) : null}
          onSave={(v) => fieldSaver("weight_grams")(v)}
          onSaved={onSaved}
        />
      </td>
      <td className="text-right">
        <CellPrice
          initial={listPrice}
          onSave={(v) => priceSaver(v, "list_price")}
          onSaved={onSaved}
        />
      </td>
      <td className="text-right">
        <CellPrice
          initial={costPrice}
          onSave={(v) => priceSaver(v, "cost_price")}
          onSaved={onSaved}
        />
      </td>
      <td>
        <WoocommerceIdBadge id={variant.woocommerce_id} />
      </td>
      <td>
        <Switch
          checked={variant.is_active}
          onCheckedChange={(checked) => {
            startTransition(async () => {
              const r = await fieldSaver("is_active")(checked);
              if ("error" in r) {
                toast.error(tDetail("saveError"), { description: r.error });
              } else {
                onSaved();
              }
            });
          }}
        />
      </td>
      <td>
        {confirmingDelete ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              className="s-btn s-btn-ghost"
              style={{ color: "var(--s-danger)", fontSize: 11, padding: "4px 8px" }}
              onClick={handleDelete}
            >
              {t("confirm")}
            </button>
            <button
              type="button"
              className="s-btn s-btn-ghost"
              style={{ fontSize: 11, padding: "4px 8px" }}
              onClick={() => setConfirmingDelete(false)}
            >
              {t("cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label={t("delete")}
            className="s-row-delete-btn"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--s-text-muted)",
              padding: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={Trash2} size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Draft variant row ─────────────────────────────────────────────────────

type DraftRow = {
  variant_name: string;
  sku: string;
  barcode: string;
  weight_grams: string;
  list_price: string;
  cost_price: string;
  is_active: boolean;
};

function draftHasContent(d: DraftRow): boolean {
  return (
    d.variant_name.trim() !== "" ||
    d.sku.trim() !== "" ||
    d.barcode.trim() !== "" ||
    d.weight_grams.trim() !== "" ||
    d.list_price.trim() !== "" ||
    d.cost_price.trim() !== ""
  );
}

function DraftVariantRow({
  draft,
  setDraft,
  firstInputRef,
  onCommit,
  onCancel,
  pending,
}: {
  draft: DraftRow;
  setDraft: (r: DraftRow) => void;
  firstInputRef: React.RefObject<HTMLInputElement | null>;
  onCommit: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const t = useTranslations("product.variants");

  function set<K extends keyof DraftRow>(k: K, v: DraftRow[K]) {
    setDraft({ ...draft, [k]: v });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <tr style={{ background: "var(--s-surface-alt, #fafbfc)" }}>
      <td>
        <input
          ref={firstInputRef}
          className="s-input"
          value={draft.variant_name}
          onChange={(e) => set("variant_name", e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKey}
          disabled={pending}
          placeholder="Nombre"
        />
      </td>
      <td>
        <input
          className="s-input s-input-mono"
          value={draft.sku}
          onChange={(e) => set("sku", e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKey}
          disabled={pending}
          placeholder="SKU"
        />
      </td>
      <td>
        <input
          className="s-input s-input-mono"
          value={draft.barcode}
          onChange={(e) => set("barcode", e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKey}
          disabled={pending}
          placeholder="Código"
        />
      </td>
      <td>
        <input
          className="s-input"
          type="number"
          inputMode="decimal"
          value={draft.weight_grams}
          onChange={(e) => set("weight_grams", e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKey}
          disabled={pending}
          placeholder="g"
        />
      </td>
      <td className="text-right">
        <input
          className="s-input"
          type="number"
          inputMode="decimal"
          value={draft.list_price}
          onChange={(e) => set("list_price", e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKey}
          disabled={pending}
          placeholder="0"
        />
      </td>
      <td className="text-right">
        <input
          className="s-input"
          type="number"
          inputMode="decimal"
          value={draft.cost_price}
          onChange={(e) => set("cost_price", e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKey}
          disabled={pending}
          placeholder="0"
        />
      </td>
      <td>
        <WoocommerceIdBadge id={null} />
      </td>
      <td>
        <Switch
          checked={draft.is_active}
          onCheckedChange={(c) => set("is_active", c)}
          disabled={pending}
        />
      </td>
      <td>
        <button
          type="button"
          className="s-btn s-btn-ghost"
          style={{ fontSize: 11, padding: "4px 8px" }}
          onClick={onCancel}
          disabled={pending}
        >
          {t("cancel")}
        </button>
      </td>
    </tr>
  );
}

// ─── Cell editors ──────────────────────────────────────────────────────────

function CellText({
  initial,
  onSave,
  onSaved,
  monospace = false,
}: {
  initial: string | null;
  onSave: (value: string) => Promise<{ ok: true } | { error: string }>;
  onSaved: () => void;
  monospace?: boolean;
}) {
  return (
    <CellInput
      initial={initial ?? ""}
      onSave={(s) => onSave(s)}
      onSaved={onSaved}
      monospace={monospace}
    />
  );
}

function CellNumber({
  initial,
  onSave,
  onSaved,
}: {
  initial: number | null;
  onSave: (value: number | null) => Promise<{ ok: true } | { error: string }>;
  onSaved: () => void;
}) {
  return (
    <CellInput
      initial={initial === null ? "" : String(initial)}
      onSave={async (s) => {
        const n = parseOrNull(s);
        return onSave(n);
      }}
      onSaved={onSaved}
      type="number"
    />
  );
}

function CellPrice({
  initial,
  onSave,
  onSaved,
}: {
  initial: number | null;
  onSave: (value: number | null) => Promise<{ ok: true } | { error: string }>;
  onSaved: () => void;
}) {
  return (
    <CellInput
      initial={initial === null ? "" : String(initial)}
      onSave={async (s) => {
        const n = parseOrNull(s);
        return onSave(n);
      }}
      onSaved={onSaved}
      type="number"
      formatDisplay={(s) => formatGTQ(s ? Number(s) : null)}
    />
  );
}

/**
 * Generic single-cell text-or-number inline edit. Click to edit, blur
 * or Enter commits, Escape cancels. Optimistic UI is left to the
 * server-action revalidation + parent re-fetch.
 */
function CellInput({
  initial,
  onSave,
  onSaved,
  monospace = false,
  type = "text",
  formatDisplay,
}: {
  initial: string;
  onSave: (s: string) => Promise<{ ok: true } | { error: string }>;
  onSaved: () => void;
  monospace?: boolean;
  type?: "text" | "number";
  formatDisplay?: (s: string) => string;
}) {
  const tDetail = useTranslations("product.detail");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEdit() {
    setDraft(initial);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft === initial) return;
    startTransition(async () => {
      const r = await onSave(draft);
      if ("error" in r) {
        toast.error(tDetail("saveError"), { description: r.error });
      } else {
        onSaved();
      }
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(initial);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`s-input ${monospace ? "s-input-mono" : ""}`}
        value={draft}
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
      />
    );
  }

  const display = formatDisplay ? formatDisplay(initial) : initial;
  return (
    <div
      onClick={startEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      }}
      style={{
        cursor: "text",
        padding: "6px 10px",
        minHeight: 30,
        borderRadius: 4,
        border: "1px solid transparent",
        fontFamily: monospace ? "var(--s-font-mono)" : "inherit",
        fontSize: 12,
        color: display ? "var(--s-text)" : "var(--s-text-muted)",
        fontStyle: display ? "normal" : "italic",
      }}
    >
      {display || "—"}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
