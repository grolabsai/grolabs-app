"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import {
  saveCategoryMargin,
  type CategoryMarginRow,
} from "@/lib/actions/pricing";
import type { CalculationMode } from "@/lib/pricing/calculate";

/**
 * Per-category margin / markup overrides. Renders the category tree as a
 * flat indented table; each row can either inherit (both fields null on
 * the category row) or override (both have their own values).
 *
 * The single "Hereda del padre" toggle controls both target and min
 * together for v1 — a per-field toggle was considered but folded down to
 * keep the table readable.
 *
 * Column labels and the formula echo flip based on the instance's
 * calculation_mode so the user is always reminded what the percentage
 * means without having to scroll up to the mode card.
 */

type Draft = {
  category_id: number;
  category_name: string;
  depth: number;
  own_target: string;
  own_min: string;
  resolved_target_pct: number;
  resolved_min_pct: number;
  target_source: "own" | "inherited" | "default";
  min_source: "own" | "inherited" | "default";
  inherits: boolean;
  dirty: boolean;
};

function rowToDraft(r: CategoryMarginRow): Draft {
  const inherits = r.own_target_margin === null && r.own_min_margin === null;
  return {
    category_id: r.category_id,
    category_name: r.category_name,
    depth: r.depth,
    own_target:
      r.own_target_margin !== null
        ? r.own_target_margin.toString()
        : r.resolved_target_pct.toString(),
    own_min:
      r.own_min_margin !== null
        ? r.own_min_margin.toString()
        : r.resolved_min_pct.toString(),
    resolved_target_pct: r.resolved_target_pct,
    resolved_min_pct: r.resolved_min_pct,
    target_source: r.target_source,
    min_source: r.min_source,
    inherits,
    dirty: false,
  };
}

export function CategoryMarginsCard({
  initial,
  mode,
}: {
  initial: CategoryMarginRow[];
  mode: CalculationMode;
}) {
  const t = useTranslations("pricing.categoryMargins");
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(rowToDraft));
  const [savingId, setSavingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const inheritedCount = useMemo(
    () => drafts.filter((d) => d.inherits).length,
    [drafts],
  );
  const usingDefaultsCount = useMemo(
    () =>
      drafts.filter(
        (d) => d.target_source === "default" && d.min_source === "default",
      ).length,
    [drafts],
  );

  function patch(idx: number, partial: Partial<Draft>) {
    setDrafts((d) =>
      d.map((row, i) => (i === idx ? { ...row, ...partial, dirty: true } : row)),
    );
  }

  function toggleInherit(idx: number, willInherit: boolean) {
    patch(idx, { inherits: willInherit });
  }

  function onSave(idx: number) {
    const row = drafts[idx];
    let target: number | null;
    let min: number | null;

    if (row.inherits) {
      target = null;
      min = null;
    } else {
      target = Number.parseFloat(row.own_target);
      min = Number.parseFloat(row.own_min);
      if (!Number.isFinite(target) || target < 0) {
        toast.error(t("toast.invalidTarget"));
        return;
      }
      if (!Number.isFinite(min) || min < 0) {
        toast.error(t("toast.invalidMin"));
        return;
      }
      if (min > target) {
        toast.error(t("toast.minAboveTarget"));
        return;
      }
    }

    setSavingId(row.category_id);
    startTransition(async () => {
      const res = await saveCategoryMargin(row.category_id, target, min);
      setSavingId(null);
      if (!res.ok) {
        toast.error(t("toast.saveError"), { description: res.error });
        return;
      }
      toast.success(t("toast.saved"));
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
          {t(`title.${mode}`)}
        </h2>
        <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
          {t(`subtitle.${mode}`)}
        </p>
      </header>

      {/* Mode-aware reminder strip — formula echo + summary counts */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          marginBottom: 16,
          background: "var(--s-surface-alt)",
          border: "1px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          fontSize: 12,
          color: "var(--s-text-secondary)",
        }}
      >
        <span>
          {t("modeBadge")} <strong>{t(`modeName.${mode}`)}</strong>
        </span>
        <span
          style={{
            fontFamily: "var(--s-font-mono)",
            color: "var(--s-text-tertiary)",
          }}
        >
          {t(`formula.${mode}`)}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--s-text-tertiary)" }}>
          {t("inheritedCount", { count: inheritedCount })}
          {usingDefaultsCount > 0 ? (
            <>
              {" · "}
              {t("usingDefaultsCount", { count: usingDefaultsCount })}
            </>
          ) : null}
        </span>
      </div>

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
                <Th>{t("columns.category")}</Th>
                <Th>{t(`columns.target.${mode}`)}</Th>
                <Th>{t(`columns.min.${mode}`)}</Th>
                <Th align="center">{t("columns.inherits")}</Th>
                <Th>{" "}</Th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((row, idx) => {
                const saving = savingId === row.category_id;
                return (
                  <tr
                    key={row.category_id}
                    style={{
                      borderBottom: "1px solid var(--s-border)",
                    }}
                  >
                    <Td>
                      <CategoryName name={row.category_name} depth={row.depth} />
                    </Td>
                    <Td>
                      <PctCell
                        inherits={row.inherits}
                        value={row.own_target}
                        resolved={row.resolved_target_pct}
                        source={row.target_source}
                        onChange={(v) => patch(idx, { own_target: v })}
                      />
                    </Td>
                    <Td>
                      <PctCell
                        inherits={row.inherits}
                        value={row.own_min}
                        resolved={row.resolved_min_pct}
                        source={row.min_source}
                        onChange={(v) => patch(idx, { own_min: v })}
                      />
                    </Td>
                    <Td align="center">
                      <Switch
                        checked={row.inherits}
                        onCheckedChange={(v) => toggleInherit(idx, v)}
                        aria-label={t("columns.inherits")}
                      />
                    </Td>
                    <Td align="right">
                      {row.dirty ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onSave(idx)}
                          disabled={saving}
                          style={{ height: 28 }}
                        >
                          <Icon icon={Check} size={14} strokeWidth={2} />
                          <span style={{ marginLeft: 4 }}>
                            {saving ? t("buttons.saving") : t("buttons.save")}
                          </span>
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

function CategoryName({ name, depth }: { name: string; depth: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          // 16 px per level so deep trees still fit within the column.
          paddingLeft: depth * 16,
          color: "var(--s-text-tertiary)",
          fontSize: 13,
        }}
      >
        {depth > 0 ? "↳" : ""}
      </span>
      <span style={{ color: "var(--s-text)" }}>{name}</span>
    </div>
  );
}

function PctCell({
  inherits,
  value,
  resolved,
  source,
  onChange,
}: {
  inherits: boolean;
  value: string;
  resolved: number;
  source: "own" | "inherited" | "default";
  onChange: (v: string) => void;
}) {
  if (inherits) {
    return (
      <div
        style={{
          fontSize: 13,
          color: "var(--s-text-tertiary)",
          fontStyle: "italic",
          fontFamily: "var(--s-font-mono)",
        }}
      >
        {resolved.toFixed(1)}%
        <span
          style={{
            marginLeft: 6,
            fontSize: 11,
            opacity: 0.7,
          }}
        >
          ({source === "default" ? "default" : "padre"})
        </span>
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type="number"
        step="0.1"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // .s-input gives this input the canonical focus ring (yellow
        // border + soft glow) without inheriting the empty-state
        // borderless rule (that one only fires on :placeholder-shown,
        // and this input has no placeholder).
        className="s-input"
        style={{
          width: "100%",
          padding: "6px 28px 6px 8px",
          fontSize: 13,
          height: "auto",
          border: "1px solid var(--s-border-strong)",
          borderRadius: "var(--s-radius-md)",
          background: "var(--s-surface)",
          color: "var(--s-text)",
        }}
      />
      <span
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 12,
          color: "var(--s-text-tertiary)",
          pointerEvents: "none",
        }}
      >
        %
      </span>
    </div>
  );
}

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
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}
