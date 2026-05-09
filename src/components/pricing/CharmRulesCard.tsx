"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Trash2, Plus, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  saveCharmRule,
  deleteCharmRule,
  type CharmRuleRow,
} from "@/lib/actions/pricing";
import { applyCharmRule, type CharmStrategy } from "@/lib/pricing/charm";

/**
 * Editable table of charm-pricing rules. Each row is a price band with a
 * strategy that snaps a calculated price into a more attractive selling
 * price (e.g. ".99" endings for sub-Q200 items).
 *
 * Rows are saved individually — the per-row Save button calls
 * saveCharmRule, and Delete fires deleteCharmRule. Newly-added rows
 * appear in local state with a null id until Save assigns one.
 */
type Draft = {
  // null on the client side means "new, never persisted"
  charm_rule_id: number | null;
  min_price: string;
  max_price: string;
  strategy: CharmStrategy;
  strategy_value: string;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
  dirty: boolean;
};

function rowToDraft(r: CharmRuleRow): Draft {
  return {
    charm_rule_id: r.charm_rule_id,
    min_price: r.min_price.toString(),
    max_price: r.max_price === null ? "" : r.max_price.toString(),
    strategy: r.strategy,
    strategy_value: r.strategy_value.toString(),
    is_active: r.is_active,
    sort_order: r.sort_order,
    notes: r.notes,
    dirty: false,
  };
}

const NEW_ROW_DEFAULTS: Omit<Draft, "sort_order"> = {
  charm_rule_id: null,
  min_price: "0",
  max_price: "",
  strategy: "ends_in",
  strategy_value: "0.99",
  is_active: true,
  notes: null,
  dirty: true,
};

export function CharmRulesCard({ initial }: { initial: CharmRuleRow[] }) {
  const t = useTranslations("pricing.charmRules");
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(rowToDraft));
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function patch(idx: number, partial: Partial<Draft>) {
    setDrafts((d) =>
      d.map((row, i) => (i === idx ? { ...row, ...partial, dirty: true } : row)),
    );
  }

  function addRow() {
    setDrafts((d) => [
      ...d,
      {
        ...NEW_ROW_DEFAULTS,
        sort_order: 100 + d.length * 10,
      },
    ]);
  }

  function onSaveRow(idx: number) {
    const row = drafts[idx];
    const minNum = Number.parseFloat(row.min_price);
    const maxNum = row.max_price.trim() === "" ? null : Number.parseFloat(row.max_price);
    const valueNum = Number.parseFloat(row.strategy_value);

    if (!Number.isFinite(minNum) || minNum < 0) {
      toast.error(t("toast.invalidMin"));
      return;
    }
    if (maxNum !== null && (!Number.isFinite(maxNum) || maxNum < minNum)) {
      toast.error(t("toast.invalidMax"));
      return;
    }
    if (!Number.isFinite(valueNum) || valueNum < 0) {
      toast.error(t("toast.invalidValue"));
      return;
    }

    const targetId: number | "new" = row.charm_rule_id ?? "new";
    setSavingId(targetId);
    startTransition(async () => {
      const res = await saveCharmRule({
        charm_rule_id: row.charm_rule_id,
        min_price: minNum,
        max_price: maxNum,
        strategy: row.strategy,
        strategy_value: valueNum,
        is_active: row.is_active,
        sort_order: row.sort_order,
        notes: row.notes,
      });
      setSavingId(null);
      if (!res.ok) {
        toast.error(t("toast.saveError"), { description: res.error });
        return;
      }
      setDrafts((d) =>
        d.map((r, i) =>
          i === idx
            ? { ...r, charm_rule_id: res.charmRuleId, dirty: false }
            : r,
        ),
      );
      toast.success(t("toast.saved"));
      router.refresh();
    });
  }

  function onDeleteRow(idx: number) {
    const row = drafts[idx];
    if (row.charm_rule_id === null) {
      // Never persisted — drop locally.
      setDrafts((d) => d.filter((_, i) => i !== idx));
      return;
    }
    if (!window.confirm(t("confirmDelete"))) return;
    const id = row.charm_rule_id;
    setDeletingId(id);
    startTransition(async () => {
      const res = await deleteCharmRule(id);
      setDeletingId(null);
      if (!res.ok) {
        toast.error(t("toast.deleteError"), { description: res.error });
        return;
      }
      setDrafts((d) => d.filter((_, i) => i !== idx));
      toast.success(t("toast.deleted"));
      router.refresh();
    });
  }

  return (
    <section className="pricing-section" style={{ marginBottom: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--s-text)",
            marginBottom: 4,
          }}
        >
          {t("title")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
          {t("subtitle")}
        </p>
      </header>

      {drafts.length === 0 ? (
        <div
          style={{
            padding: "32px 0",
            textAlign: "center",
            fontSize: 13,
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("empty")}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--s-surface-alt)",
                  borderBottom: "1px solid var(--s-border)",
                }}
              >
                <Th>{t("columns.from")}</Th>
                <Th>{t("columns.to")}</Th>
                <Th>{t("columns.strategy")}</Th>
                <Th>{t("columns.value")}</Th>
                <Th>{t("columns.example")}</Th>
                <Th align="center">{t("columns.active")}</Th>
                <Th>{" "}</Th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((row, idx) => {
                const exampleInput =
                  Number.parseFloat(row.min_price || "0") + 0.13;
                const exampleOutput =
                  Number.isFinite(Number.parseFloat(row.strategy_value))
                    ? applyCharmRule(exampleInput, {
                        charm_rule_id: 0,
                        min_price: Number.parseFloat(row.min_price || "0"),
                        max_price:
                          row.max_price === ""
                            ? null
                            : Number.parseFloat(row.max_price),
                        strategy: row.strategy,
                        strategy_value: Number.parseFloat(row.strategy_value),
                        is_active: true,
                        sort_order: 0,
                      })
                    : NaN;
                const saveTargetId = row.charm_rule_id ?? "new";
                const saving = savingId === saveTargetId;
                const deleting = deletingId === row.charm_rule_id;
                return (
                  <tr
                    key={row.charm_rule_id ?? `new-${idx}`}
                    style={{
                      borderBottom: "1px solid var(--s-border)",
                      background: row.is_active
                        ? "var(--s-surface)"
                        : "var(--s-surface-alt)",
                    }}
                  >
                    <Td>
                      <PriceInput
                        value={row.min_price}
                        onChange={(v) => patch(idx, { min_price: v })}
                      />
                    </Td>
                    <Td>
                      <PriceInput
                        value={row.max_price}
                        onChange={(v) => patch(idx, { max_price: v })}
                        placeholder={t("placeholders.max")}
                      />
                    </Td>
                    <Td>
                      <Select
                        value={row.strategy}
                        onValueChange={(v) =>
                          patch(idx, { strategy: v as CharmStrategy })
                        }
                      >
                        <SelectTrigger style={{ height: 32 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ends_in">
                            {t("strategies.ends_in.label")}
                          </SelectItem>
                          <SelectItem value="round_to">
                            {t("strategies.round_to.label")}
                          </SelectItem>
                          <SelectItem value="fixed_offset">
                            {t("strategies.fixed_offset.label")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p
                        style={{
                          fontSize: 11,
                          color: "var(--s-text-tertiary)",
                          marginTop: 2,
                          lineHeight: 1.3,
                        }}
                      >
                        {t(`strategies.${row.strategy}.hint`)}
                      </p>
                    </Td>
                    <Td>
                      <PriceInput
                        value={row.strategy_value}
                        onChange={(v) => patch(idx, { strategy_value: v })}
                        placeholder={t(
                          `strategies.${row.strategy}.placeholder`,
                        )}
                      />
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontFamily: "var(--s-font-mono)",
                          fontSize: 12,
                          color: "var(--s-text-secondary)",
                        }}
                      >
                        {Number.isFinite(exampleInput) &&
                        Number.isFinite(exampleOutput)
                          ? `Q${exampleInput.toFixed(2)} → Q${exampleOutput.toFixed(2)}`
                          : "—"}
                      </span>
                    </Td>
                    <Td align="center">
                      <Switch
                        checked={row.is_active}
                        onCheckedChange={(v) =>
                          patch(idx, { is_active: v })
                        }
                      />
                    </Td>
                    <Td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        {row.dirty ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => onSaveRow(idx)}
                            disabled={saving}
                            style={{ height: 28 }}
                          >
                            <Icon icon={Check} size={14} strokeWidth={2} />
                            <span style={{ marginLeft: 4 }}>
                              {saving ? t("buttons.saving") : t("buttons.save")}
                            </span>
                          </Button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onDeleteRow(idx)}
                          disabled={deleting}
                          aria-label={t("buttons.delete")}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            border: "none",
                            background: "transparent",
                            color: "var(--s-text-tertiary)",
                            borderRadius: "var(--s-radius-md)",
                            cursor: "pointer",
                          }}
                        >
                          <Icon icon={Trash2} size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Button type="button" variant="outline" onClick={addRow}>
          <Icon icon={Plus} size={14} strokeWidth={2} />
          <span style={{ marginLeft: 6 }}>{t("buttons.add")}</span>
        </Button>
      </div>
    </section>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 12px",
        fontWeight: 500,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--s-text-tertiary)",
      }}
    >
      {children}
    </th>
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
        padding: "8px 12px",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function PriceInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      step="0.01"
      min={0}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: "6px 8px",
        fontSize: 13,
        border: "1px solid var(--s-border-strong)",
        borderRadius: "var(--s-radius-md)",
        background: "var(--s-surface)",
        color: "var(--s-text)",
      }}
    />
  );
}
