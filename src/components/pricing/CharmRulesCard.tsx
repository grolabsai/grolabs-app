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
import {
  applyCharm,
  applyCharmRule,
  findCharmRule,
  type CharmRule,
  type CharmStrategy,
} from "@/lib/pricing/charm";

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
  /** Per-row "what would Q… become with this rule" calculator input. */
  example_input: string;
};

function defaultExampleInput(minPrice: number | string): string {
  const n = typeof minPrice === "number" ? minPrice : Number.parseFloat(minPrice);
  return Number.isFinite(n) ? (n + 0.13).toFixed(2) : "10.00";
}

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
    example_input: defaultExampleInput(r.min_price),
  };
}

const NEW_ROW_DEFAULTS: Omit<Draft, "sort_order" | "example_input"> = {
  charm_rule_id: null,
  min_price: "0",
  max_price: "",
  strategy: "ends_in",
  strategy_value: "0.99",
  is_active: true,
  notes: null,
  dirty: true,
};

/**
 * Build a CharmRule from a Draft. Returns null if the draft has invalid
 * numeric fields — used by the test-price calculator and overlap check
 * so they never crash on partial input.
 */
function draftToRule(d: Draft, fallbackId = 0): CharmRule | null {
  const min = Number.parseFloat(d.min_price);
  const max = d.max_price.trim() === "" ? null : Number.parseFloat(d.max_price);
  const value = Number.parseFloat(d.strategy_value);
  if (!Number.isFinite(min) || min < 0) return null;
  if (max !== null && (!Number.isFinite(max) || max < min)) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return {
    charm_rule_id: d.charm_rule_id ?? fallbackId,
    min_price: min,
    max_price: max,
    strategy: d.strategy,
    strategy_value: value,
    is_active: d.is_active,
    sort_order: d.sort_order,
  };
}

/**
 * Two bands [a1, a2] and [b1, b2] (a2/b2 nullable = +∞) overlap when
 * max(a1, b1) ≤ min(a2, b2). Inclusive on both ends — that matches the
 * resolver's `price < min` / `price > max` exclusions.
 */
function bandsOverlap(
  a: { min: number; max: number | null },
  b: { min: number; max: number | null },
): boolean {
  const lo = Math.max(a.min, b.min);
  const hi = Math.min(a.max ?? Infinity, b.max ?? Infinity);
  return lo <= hi;
}

function formatBand(min: number, max: number | null, noLimit: string): string {
  return `Q${min.toFixed(2)} – ${max === null ? noLimit : `Q${max.toFixed(2)}`}`;
}

export function CharmRulesCard({ initial }: { initial: CharmRuleRow[] }) {
  const t = useTranslations("pricing.charmRules");
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(rowToDraft));
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testPrice, setTestPrice] = useState<string>("100");
  const [, startTransition] = useTransition();

  // Resolve the test price through the full active ruleset — same order
  // (sort_order asc, id asc) the worksheet uses, so this preview matches
  // what saveCharmRule + recomputeBatch will actually do.
  const sortedActiveRules: CharmRule[] = drafts
    .slice()
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return (a.charm_rule_id ?? Infinity) - (b.charm_rule_id ?? Infinity);
    })
    .map((d) => draftToRule(d))
    .filter((r): r is CharmRule => r !== null && r.is_active);
  const testPriceNum = Number.parseFloat(testPrice);
  const testMatch = Number.isFinite(testPriceNum)
    ? findCharmRule(testPriceNum, sortedActiveRules)
    : null;
  const testOutput = Number.isFinite(testPriceNum)
    ? applyCharm(testPriceNum, sortedActiveRules)
    : NaN;

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
        example_input: defaultExampleInput(NEW_ROW_DEFAULTS.min_price),
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
    if (row.strategy === "ends_in_whole") {
      if (!Number.isInteger(valueNum) || valueNum < 1) {
        toast.error(t("toast.invalidWholeValue"));
        return;
      }
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

      // Overlap check — flag conflicts with other active rules so the
      // user knows the resolver may shadow this rule (or vice-versa).
      const savedBand = { min: minNum, max: maxNum };
      const conflicts = drafts
        .map((other, i) => ({ other, i }))
        .filter(({ i }) => i !== idx)
        .filter(({ other }) => other.is_active && row.is_active)
        .map(({ other }) => ({ other, rule: draftToRule(other) }))
        .filter(
          (c): c is { other: Draft; rule: CharmRule } =>
            c.rule !== null &&
            bandsOverlap(savedBand, {
              min: c.rule.min_price,
              max: c.rule.max_price,
            }),
        );
      if (conflicts.length > 0) {
        const first = conflicts[0];
        const winner =
          first.other.sort_order < row.sort_order ||
          (first.other.sort_order === row.sort_order &&
            (first.other.charm_rule_id ?? Infinity) <
              (row.charm_rule_id ?? Infinity))
            ? "other"
            : "this";
        toast.warning(t("toast.conflictTitle"), {
          description: t("toast.conflictBody", {
            band: formatBand(
              first.rule.min_price,
              first.rule.max_price,
              t("placeholders.max"),
            ),
            winner:
              winner === "other"
                ? t("toast.conflictWinnerOther")
                : t("toast.conflictWinnerThis"),
            count: conflicts.length,
          }),
        });
      }

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
            color: "var(--gl-text)",
            marginBottom: 4,
          }}
        >
          {t("title")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--gl-text-tertiary)" }}>
          {t("subtitle")}
        </p>
      </header>

      {/* Test calculator — runs the price through the full active ruleset */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          marginBottom: 16,
          background: "var(--gl-surface-alt)",
          border: "1px solid var(--gl-border)",
          borderRadius: "var(--gl-radius-md)",
          fontSize: 12,
          color: "var(--gl-text-secondary)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--gl-font-mono)",
          }}
        >
          <span>{t("testCalculator.label")}</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={testPrice}
            onChange={(e) => setTestPrice(e.target.value)}
            placeholder="100.00"
            style={{
              width: 96,
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid var(--gl-border-strong)",
              borderRadius: "var(--gl-radius-md)",
              background: "var(--gl-surface)",
              color: "var(--gl-text)",
              fontFamily: "var(--gl-font-mono)",
            }}
          />
        </label>
        <span style={{ color: "var(--gl-text-tertiary)" }}>→</span>
        <span
          style={{
            fontFamily: "var(--gl-font-mono)",
            color: Number.isFinite(testOutput)
              ? "var(--gl-text)"
              : "var(--gl-text-tertiary)",
          }}
        >
          {Number.isFinite(testOutput) ? `Q${testOutput.toFixed(2)}` : "—"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--gl-text-tertiary)" }}>
          {testMatch
            ? t("testCalculator.matched", {
                strategy: t(`strategies.${testMatch.strategy}.label`),
                value: testMatch.strategy_value.toString(),
              })
            : Number.isFinite(testPriceNum)
              ? t("testCalculator.noMatch")
              : t("testCalculator.enterPrice")}
        </span>
      </div>

      {drafts.length === 0 ? (
        <div
          style={{
            padding: "32px 0",
            textAlign: "center",
            fontSize: 13,
            color: "var(--gl-text-tertiary)",
          }}
        >
          {t("empty")}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--gl-border)",
            borderRadius: "var(--gl-radius-md)",
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
                  background: "var(--gl-surface-alt)",
                  borderBottom: "1px solid var(--gl-border)",
                }}
              >
                <Th>{t("columns.from")}</Th>
                <Th>{t("columns.to")}</Th>
                <Th>{t("columns.strategy")}</Th>
                <Th>{t("columns.value")}</Th>
                <Th>{t("columns.test")}</Th>
                <Th align="center">{t("columns.active")}</Th>
                <Th>{" "}</Th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((row, idx) => {
                const ruleForRow = draftToRule(row);
                const exampleInputNum = Number.parseFloat(row.example_input);
                const exampleOutput =
                  ruleForRow !== null && Number.isFinite(exampleInputNum)
                    ? applyCharmRule(exampleInputNum, ruleForRow)
                    : NaN;
                const saveTargetId = row.charm_rule_id ?? "new";
                const saving = savingId === saveTargetId;
                const deleting = deletingId === row.charm_rule_id;
                return (
                  <tr
                    key={row.charm_rule_id ?? `new-${idx}`}
                    style={{
                      borderBottom: "1px solid var(--gl-border)",
                      background: row.is_active
                        ? "var(--gl-surface)"
                        : "var(--gl-surface-alt)",
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
                          <SelectItem value="ends_in_whole">
                            {t("strategies.ends_in_whole.label")}
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
                          color: "var(--gl-text-tertiary)",
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontFamily: "var(--gl-font-mono)",
                          fontSize: 12,
                        }}
                      >
                        <PriceInput
                          value={row.example_input}
                          onChange={(v) =>
                            setDrafts((d) =>
                              d.map((r, i) =>
                                i === idx ? { ...r, example_input: v } : r,
                              ),
                            )
                          }
                        />
                        <span style={{ color: "var(--gl-text-tertiary)" }}>→</span>
                        <span
                          style={{
                            color: Number.isFinite(exampleOutput)
                              ? "var(--gl-text-secondary)"
                              : "var(--gl-text-tertiary)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {Number.isFinite(exampleOutput)
                            ? `Q${exampleOutput.toFixed(2)}`
                            : "—"}
                        </span>
                      </div>
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
                            color: "var(--gl-text-tertiary)",
                            borderRadius: "var(--gl-radius-md)",
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
        color: "var(--gl-text-tertiary)",
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
        border: "1px solid var(--gl-border-strong)",
        borderRadius: "var(--gl-radius-md)",
        background: "var(--gl-surface)",
        color: "var(--gl-text)",
      }}
    />
  );
}
