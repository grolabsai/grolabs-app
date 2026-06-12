"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import { Lock, Unlock } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { updateBatchItem, type BatchDetailItem } from "@/lib/actions/pricing";
import { formatGTQ } from "@/lib/format";

/**
 * One worksheet row. Inline edit pattern is the same for both editable
 * cells (charm and final): click to enter edit mode, blur or Enter to
 * save, Escape to cancel.
 *
 * Manual override is signalled with a lock icon next to the final-price
 * cell. Clicking it resets the override and re-derives charm + final
 * from the current rules.
 */
export function WorksheetRow({
  item,
  selected,
  onToggleSelect,
  editable,
}: {
  item: BatchDetailItem;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  editable: boolean;
}) {
  const t = useTranslations("pricing.batchDetail");
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [charmEditing, setCharmEditing] = useState(false);
  const [finalEditing, setFinalEditing] = useState(false);
  const [charmDraft, setCharmDraft] = useState<string>(
    item.charm_price !== null ? String(item.charm_price) : "",
  );
  const [finalDraft, setFinalDraft] = useState<string>(
    item.final_price !== null ? String(item.final_price) : "",
  );

  function commitCharm() {
    setCharmEditing(false);
    const n = Number.parseFloat(charmDraft);
    if (!Number.isFinite(n) || n < 0) {
      setCharmDraft(item.charm_price !== null ? String(item.charm_price) : "");
      toast.error(t("toast.invalidCharm"));
      return;
    }
    if (item.charm_price !== null && Math.abs(n - item.charm_price) < 0.005) {
      return; // unchanged
    }
    startTransition(async () => {
      const res = await updateBatchItem(item.price_batch_item_id, {
        kind: "charm",
        charm_price: n,
      });
      if (!res.ok) {
        toast.error(t("toast.editError"), { description: res.error });
      }
      router.refresh();
    });
  }

  function commitFinal() {
    setFinalEditing(false);
    const n = Number.parseFloat(finalDraft);
    if (!Number.isFinite(n) || n < 0) {
      setFinalDraft(item.final_price !== null ? String(item.final_price) : "");
      toast.error(t("toast.invalidFinal"));
      return;
    }
    if (item.final_price !== null && Math.abs(n - item.final_price) < 0.005) {
      return;
    }
    startTransition(async () => {
      const res = await updateBatchItem(item.price_batch_item_id, {
        kind: "final",
        final_price: n,
      });
      if (!res.ok) {
        toast.error(t("toast.editError"), { description: res.error });
      }
      router.refresh();
    });
  }

  function resetOverride() {
    startTransition(async () => {
      const res = await updateBatchItem(item.price_batch_item_id, {
        kind: "reset",
      });
      if (!res.ok) {
        toast.error(t("toast.editError"), { description: res.error });
        return;
      }
      toast.success(t("toast.overrideCleared"));
      router.refresh();
    });
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--gl-border)" }}>
      <Td>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          aria-label={t("selectRow")}
        />
      </Td>
      <Td>
        <div
          style={{ fontSize: 13, fontWeight: 500, color: "var(--gl-text)" }}
        >
          {item.variant_label}
        </div>
        {item.brand_name ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--gl-text-tertiary)",
            }}
          >
            {item.brand_name}
          </div>
        ) : null}
      </Td>
      <Td align="right">
        <Mono>{formatGTQ(item.new_cost)}</Mono>
      </Td>
      <Td align="right">
        <Mono color="muted">{formatGTQ(item.current_price)}</Mono>
      </Td>
      <Td align="right">
        {charmEditing && editable ? (
          <CellInput
            value={charmDraft}
            onChange={setCharmDraft}
            onCommit={commitCharm}
            onCancel={() => {
              setCharmEditing(false);
              setCharmDraft(
                item.charm_price !== null ? String(item.charm_price) : "",
              );
            }}
          />
        ) : (
          <div
            onClick={() => editable && setCharmEditing(true)}
            style={{
              cursor: editable ? "text" : "default",
              fontFamily: "var(--gl-font-mono)",
              fontSize: 12,
              padding: "4px 6px",
              margin: "-4px -6px",
              borderRadius: "var(--gl-radius-sm)",
              color: "var(--gl-text)",
            }}
          >
            {formatGTQ(item.charm_price)}
          </div>
        )}
      </Td>
      <Td align="right">
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            justifyContent: "flex-end",
          }}
        >
          {finalEditing && editable ? (
            <CellInput
              value={finalDraft}
              onChange={setFinalDraft}
              onCommit={commitFinal}
              onCancel={() => {
                setFinalEditing(false);
                setFinalDraft(
                  item.final_price !== null ? String(item.final_price) : "",
                );
              }}
            />
          ) : (
            <div
              onClick={() => editable && setFinalEditing(true)}
              style={{
                cursor: editable ? "text" : "default",
                fontWeight: 600,
                fontFamily: "var(--gl-font-mono)",
                fontSize: 13,
                padding: "4px 6px",
                margin: "-4px -6px",
                borderRadius: "var(--gl-radius-sm)",
                color: "var(--gl-text)",
              }}
            >
              {formatGTQ(item.final_price)}
            </div>
          )}
          {editable ? (
            <button
              type="button"
              onClick={item.manual_override ? resetOverride : undefined}
              disabled={!item.manual_override}
              aria-label={
                item.manual_override
                  ? t("buttons.resetOverride")
                  : t("buttons.notOverridden")
              }
              title={
                item.manual_override
                  ? t("buttons.resetOverride")
                  : undefined
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                border: "none",
                background: "transparent",
                color: item.manual_override
                  ? "var(--gl-accent)"
                  : "var(--gl-border-strong)",
                borderRadius: "var(--gl-radius-sm)",
                cursor: item.manual_override ? "pointer" : "default",
              }}
            >
              <Icon
                icon={item.manual_override ? Lock : Unlock}
                size={12}
                strokeWidth={1.75}
              />
            </button>
          ) : null}
        </div>
      </Td>
      <Td align="right">
        <Mono>
          {item.margin_percent === null
            ? "—"
            : `${item.margin_percent.toFixed(1)}%`}
        </Mono>
      </Td>
      <Td>
        <StatusBadge status={item.status} reasons={item.status_reasons} />
      </Td>
    </tr>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

function CellInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      type="number"
      step="0.01"
      min={0}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      autoFocus
      style={{
        width: 100,
        padding: "4px 6px",
        fontFamily: "var(--gl-font-mono)",
        fontSize: 12,
        border: "1px solid var(--gl-accent)",
        borderRadius: "var(--gl-radius-sm)",
        background: "var(--gl-surface)",
        color: "var(--gl-text)",
        textAlign: "right",
        outline: "none",
      }}
    />
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px 12px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function Mono({
  children,
  color = "default",
}: {
  children: React.ReactNode;
  color?: "default" | "muted";
}) {
  return (
    <span
      style={{
        fontFamily: "var(--gl-font-mono)",
        fontSize: 12,
        color: color === "muted" ? "var(--gl-text-tertiary)" : "var(--gl-text)",
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({
  status,
  reasons,
}: {
  status: "neutral" | "warning" | "critical";
  reasons: string[];
}) {
  const palette = {
    neutral: { bg: "var(--gl-success-bg)", fg: "var(--gl-success-text)" },
    warning: { bg: "#FFF7ED", fg: "#B45309" },
    critical: { bg: "var(--gl-danger-bg)", fg: "var(--gl-danger-text)" },
  }[status];
  return (
    <span
      title={reasons.length > 0 ? reasons.join(", ") : undefined}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {status}
    </span>
  );
}
