"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import {
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

/**
 * Controlled photo gallery shared between the create-product flow and
 * the product edit page. The caller owns state and applies mutations
 * via the callbacks; the component is presentational.
 *
 * `mediaId` is present for photos already in `product_media`; the
 * create flow leaves it undefined for newly entered URLs.
 *
 * `variantId` is informational — passed through so the surrounding
 * card can label scope ("Fotos de la variante"). Editing semantics
 * are identical for product- and variant-scoped galleries; the
 * caller wires the right server action (updateProductPhotos vs
 * updateVariantPhotos).
 */

export type PhotoState = {
  mediaId?: number;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
};

type Props = {
  photos: PhotoState[];
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  onSetPrimary: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onAltTextChange: (index: number, altText: string) => void;
  disabled?: boolean;
  /** When set, this gallery edits a variant's photos. Currently used
   * only for context (callers render the right header/copy); the
   * component itself doesn't change behaviour. */
  variantId?: number;
};

export function PhotoManager({
  photos,
  onAdd,
  onRemove,
  onSetPrimary,
  onReorder,
  onAltTextChange,
  disabled = false,
}: Props) {
  const t = useTranslations("product.create");
  const [input, setInput] = useState("");
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  function commit() {
    if (!input.trim() || disabled) return;
    onAdd(input);
    setInput("");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={t("photos.urlPlaceholder")}
          disabled={disabled}
          style={{
            flex: 1,
            height: 36,
            padding: "0 10px",
            fontSize: 13,
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            background: "white",
            color: "var(--s-text)",
            outline: "none",
          }}
        />
        <button
          type="button"
          className="s-btn s-btn-secondary"
          onClick={commit}
          disabled={disabled || !input.trim()}
        >
          <Icon icon={Plus} size={12} />
          {t("photos.addBtn")}
        </button>
      </div>

      {photos.length === 0 ? (
        <div
          style={{
            marginTop: 14,
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--s-text-tertiary)",
            border: "1.5px dashed var(--s-border)",
            borderRadius: "var(--s-radius-md)",
          }}
        >
          <Icon icon={ImageIcon} size={48} />
          <div style={{ fontSize: 13, fontWeight: 500, marginTop: 8 }}>
            {t("photos.emptyTitle")}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{t("photos.emptySub")}</div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          {photos.map((p, idx) => (
            <PhotoTile
              key={p.mediaId !== undefined ? `m-${p.mediaId}` : `i-${idx}-${p.url}`}
              photo={p}
              index={idx}
              total={photos.length}
              dragging={draggedIdx === idx}
              onDragStart={() => setDraggedIdx(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedIdx === null || draggedIdx === idx) return;
                onReorder(draggedIdx, idx);
                setDraggedIdx(idx);
              }}
              onDragEnd={() => setDraggedIdx(null)}
              onRemove={() => onRemove(idx)}
              onSetPrimary={() => onSetPrimary(idx)}
              onMoveUp={() => onReorder(idx, idx - 1)}
              onMoveDown={() => onReorder(idx, idx + 1)}
              onAltTextChange={(alt) => onAltTextChange(idx, alt)}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          padding: 10,
          background: "var(--s-surface-alt)",
          borderRadius: "var(--s-radius-md)",
          fontSize: 11,
          color: "var(--s-text-secondary)",
        }}
      >
        <strong>{t("photos.techDebtLabel")}</strong> {t("photos.techDebtBody")}
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  index,
  total,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
  onSetPrimary,
  onMoveUp,
  onMoveDown,
  onAltTextChange,
  disabled,
}: {
  photo: PhotoState;
  index: number;
  total: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove: () => void;
  onSetPrimary: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAltTextChange: (altText: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("product.create");
  const [errored, setErrored] = useState(false);
  const [hover, setHover] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Keep alt-text edits local until blur so we don't flood the parent
  // (which persists on every change) with one-keystroke saves.
  // The `lastSeenAlt` snapshot is the React-docs pattern for "reset
  // local state when a prop changes": setState during render fires
  // before commit, so the input always paints with the right value
  // and we never use a stale prop. We skip the reset while focused so
  // we don't fight the user mid-type.
  const [altDraft, setAltDraft] = useState<string>(photo.altText ?? "");
  const [lastSeenAlt, setLastSeenAlt] = useState<string>(photo.altText ?? "");
  const [altFocused, setAltFocused] = useState(false);
  const incomingAlt = photo.altText ?? "";
  if (incomingAlt !== lastSeenAlt && !altFocused) {
    setLastSeenAlt(incomingAlt);
    setAltDraft(incomingAlt);
  }

  const ringColor = photo.isPrimary ? "var(--rre-accent)" : "var(--s-border)";
  const ringWidth = photo.isPrimary ? 2 : 0.5;
  const boxShadow = photo.isPrimary ? "0 0 0 3px var(--rre-accent-50)" : "none";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        draggable={!disabled}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          border: `${ringWidth}px solid ${ringColor}`,
          borderRadius: "var(--s-radius-md)",
          overflow: "hidden",
          background: "var(--s-surface-alt)",
          cursor: disabled ? "default" : "move",
          opacity: dragging ? 0.5 : 1,
          boxShadow,
          transition: "border-color 0.12s, box-shadow 0.12s",
        }}
      >
        {errored ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              color: "var(--s-text-tertiary)",
              fontSize: 11,
              gap: 6,
              padding: 8,
              textAlign: "center",
            }}
          >
            <Icon icon={ImageIcon} size={32} />
            <span>{t("photos.errorLoading")}</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={photo.altText || photo.url}
            onError={() => setErrored(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/* Reorder controls (top-left) — always visible on hover */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            opacity: hover ? 1 : 0,
            transition: "opacity 0.12s",
            pointerEvents: hover ? "auto" : "none",
          }}
        >
          <PhotoActionButton
            onClick={onMoveUp}
            ariaLabel={t("photos.moveUpAria")}
            disabled={disabled || index === 0}
          >
            <Icon icon={ChevronUp} size={14} />
          </PhotoActionButton>
          <PhotoActionButton
            onClick={onMoveDown}
            ariaLabel={t("photos.moveDownAria")}
            disabled={disabled || index === total - 1}
          >
            <Icon icon={ChevronDown} size={14} />
          </PhotoActionButton>
        </div>

        {/* Action buttons (top-right) */}
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            gap: 4,
            opacity: hover ? 1 : 0,
            transition: "opacity 0.12s",
            pointerEvents: hover ? "auto" : "none",
          }}
        >
          <PhotoActionButton
            onClick={onSetPrimary}
            ariaLabel={t("photos.primaryAria")}
            disabled={disabled}
          >
            <Icon icon={Star} size={14} />
          </PhotoActionButton>
          <PhotoActionButton
            onClick={() => setConfirmingDelete(true)}
            ariaLabel={t("photos.removeAria")}
            danger
            disabled={disabled}
          >
            <Icon icon={Trash2} size={14} />
          </PhotoActionButton>
        </div>

        {/* Inline delete confirmation overlay */}
        {confirmingDelete ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.96)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 12,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--s-text)" }}>
              {t("photos.deleteConfirm")}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  onRemove();
                }}
                disabled={disabled}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: "var(--s-radius-sm)",
                  border: "none",
                  background: "var(--s-danger)",
                  color: "white",
                  cursor: disabled ? "default" : "pointer",
                  fontWeight: 500,
                }}
              >
                {t("photos.deleteConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: "var(--s-radius-sm)",
                  border: "0.5px solid var(--s-border)",
                  background: "white",
                  color: "var(--s-text)",
                  cursor: "pointer",
                }}
              >
                {t("photos.deleteConfirmNo")}
              </button>
            </div>
          </div>
        ) : null}

        {photo.isPrimary ? (
          <span
            style={{
              position: "absolute",
              bottom: 6,
              left: 6,
              background: "var(--rre-accent)",
              color: "white",
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "3px 8px",
              borderRadius: 999,
            }}
          >
            {t("photos.primaryBadge")}
          </span>
        ) : null}
      </div>

      <input
        type="text"
        value={altDraft}
        onChange={(e) => setAltDraft(e.target.value)}
        onFocus={() => setAltFocused(true)}
        onBlur={() => {
          setAltFocused(false);
          const next = altDraft.trim();
          if (next !== (photo.altText ?? "")) onAltTextChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={t("photos.altPlaceholder")}
        disabled={disabled}
        aria-label={t("photos.altAria")}
        style={{
          width: "100%",
          height: 28,
          padding: "0 8px",
          fontSize: 11,
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-sm)",
          background: "white",
          color: "var(--s-text)",
          outline: "none",
        }}
      />
    </div>
  );
}

function PhotoActionButton({
  children,
  onClick,
  ariaLabel,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const bg = hover && !disabled
    ? danger
      ? "var(--s-danger)"
      : "white"
    : "rgba(255,255,255,0.95)";
  const color = hover && !disabled && danger ? "white" : "var(--s-text)";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={ariaLabel}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        border: "none",
        borderRadius: "var(--s-radius-sm)",
        background: bg,
        color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.12s, opacity 0.12s",
      }}
    >
      {children}
    </button>
  );
}
