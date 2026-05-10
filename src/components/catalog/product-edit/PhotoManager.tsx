"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { ImageIcon, Plus, Star, Trash2 } from "lucide-react";

/**
 * Controlled photo gallery shared between the create-product flow and
 * the product edit page. The caller owns state and applies mutations
 * via the four callbacks; the component is purely presentational
 * (URL input + tile grid + drag-reorder + primary toggle + remove).
 *
 * `mediaId` is present for photos already in `product_media`; the
 * create flow leaves it undefined for newly entered URLs.
 */

export type PhotoState = {
  mediaId?: number;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
};

type Props = {
  photos: PhotoState[];
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  onSetPrimary: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  disabled?: boolean;
};

export function PhotoManager({
  photos,
  onAdd,
  onRemove,
  onSetPrimary,
  onReorder,
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
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          {photos.map((p, idx) => (
            <PhotoTile
              key={p.mediaId !== undefined ? `m-${p.mediaId}` : `i-${idx}-${p.url}`}
              photo={p}
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
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
  onSetPrimary,
}: {
  photo: PhotoState;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove: () => void;
  onSetPrimary: () => void;
}) {
  const t = useTranslations("product.create");
  const [errored, setErrored] = useState(false);
  const [hover, setHover] = useState(false);

  const ringColor = photo.isPrimary ? "var(--scout-accent)" : "var(--s-border)";
  const ringWidth = photo.isPrimary ? 2 : 0.5;
  const boxShadow = photo.isPrimary ? "0 0 0 3px var(--scout-accent-50)" : "none";

  return (
    <div
      draggable
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
        cursor: "move",
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
          alt={photo.url}
          onError={() => setErrored(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 50%)",
          opacity: hover ? 1 : 0,
          transition: "opacity 0.12s",
          display: "flex",
          padding: 6,
          gap: 4,
          pointerEvents: hover ? "auto" : "none",
        }}
      >
        <PhotoActionButton onClick={onSetPrimary} ariaLabel={t("photos.primaryAria")}>
          <Icon icon={Star} size={14} />
        </PhotoActionButton>
        <PhotoActionButton onClick={onRemove} ariaLabel={t("photos.removeAria")} danger>
          <Icon icon={Trash2} size={14} />
        </PhotoActionButton>
      </div>

      {photo.isPrimary ? (
        <span
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            background: "var(--scout-accent)",
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
  );
}

function PhotoActionButton({
  children,
  onClick,
  ariaLabel,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const bg = hover
    ? danger
      ? "var(--s-danger)"
      : "white"
    : "rgba(255,255,255,0.95)";
  const color = hover && danger ? "white" : "var(--s-text)";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={ariaLabel}
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
        cursor: "pointer",
        transition: "background 0.12s",
      }}
    >
      {children}
    </button>
  );
}
