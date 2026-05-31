"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MapRuleDialog } from "@/components/pricing/MapRuleDialog";
import { formatGTQ } from "@/lib/format";
import {
  deleteMapRule,
  type MapRuleRow,
  type BrandRow,
  type ProviderRow,
} from "@/lib/actions/pricing";

/**
 * Top half of /pricing/violations: a table of every MAP / max-price rule
 * defined for the current instance. The "+ Nueva regla" button and each
 * row's edit pencil open the same MapRuleDialog. Delete prompts a confirm
 * and fires deleteMapRule.
 */
export function MapRulesCard({
  initial,
  brands,
  providers,
}: {
  initial: MapRuleRow[];
  brands: BrandRow[];
  providers: ProviderRow[];
}) {
  const t = useTranslations("pricing.mapRules");
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MapRuleRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(rule: MapRuleRow) {
    setEditing(rule);
    setDialogOpen(true);
  }

  function onDelete(rule: MapRuleRow) {
    if (!window.confirm(t("confirmDelete"))) return;
    setDeletingId(rule.map_rule_id);
    startTransition(async () => {
      const res = await deleteMapRule(rule.map_rule_id);
      setDeletingId(null);
      if (!res.ok) {
        toast.error(t("toast.deleteError"), { description: res.error });
        return;
      }
      toast.success(t("toast.deleted"));
      router.refresh();
    });
  }

  return (
    <section className="pricing-section" style={{ marginBottom: 24 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div>
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
        </div>
        <Button type="button" onClick={openCreate}>
          <Icon icon={Plus} size={14} strokeWidth={2} />
          <span style={{ marginLeft: 6 }}>{t("buttons.add")}</span>
        </Button>
      </header>

      {initial.length === 0 ? (
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
                <Th>{t("columns.source")}</Th>
                <Th>{t("columns.appliesTo")}</Th>
                <Th>{t("columns.ruleType")}</Th>
                <Th align="right">{t("columns.min")}</Th>
                <Th align="right">{t("columns.max")}</Th>
                <Th>{t("columns.validity")}</Th>
                <Th align="center">{t("columns.active")}</Th>
                <Th>{" "}</Th>
              </tr>
            </thead>
            <tbody>
              {initial.map((r) => {
                const deleting = deletingId === r.map_rule_id;
                return (
                  <tr
                    key={r.map_rule_id}
                    style={{
                      borderBottom: "1px solid var(--gl-border)",
                      opacity: r.is_active ? 1 : 0.5,
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 500, color: "var(--gl-text)" }}>
                        {r.source_name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--gl-text-tertiary)",
                        }}
                      >
                        {t(`sourceTypes.${r.source_type}`)}
                      </div>
                    </Td>
                    <Td>
                      {r.variant_id === null ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "var(--gl-surface-alt)",
                            color: "var(--gl-text-secondary)",
                            fontWeight: 500,
                          }}
                        >
                          {t("appliesTo.all")}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--gl-text)",
                          }}
                        >
                          {r.variant_label}
                        </span>
                      )}
                    </Td>
                    <Td>{t(`ruleTypes.${r.rule_type}`)}</Td>
                    <Td align="right">
                      <span
                        style={{
                          fontFamily: "var(--gl-font-mono)",
                          fontSize: 12,
                          color:
                            r.min_price === null
                              ? "var(--gl-text-tertiary)"
                              : "var(--gl-text)",
                        }}
                      >
                        {r.min_price === null ? "—" : formatGTQ(r.min_price)}
                      </span>
                    </Td>
                    <Td align="right">
                      <span
                        style={{
                          fontFamily: "var(--gl-font-mono)",
                          fontSize: 12,
                          color:
                            r.max_price === null
                              ? "var(--gl-text-tertiary)"
                              : "var(--gl-text)",
                        }}
                      >
                        {r.max_price === null ? "—" : formatGTQ(r.max_price)}
                      </span>
                    </Td>
                    <Td>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--gl-text-secondary)",
                        }}
                      >
                        {r.effective_date}
                        {r.expires_at ? ` → ${r.expires_at}` : ""}
                      </div>
                    </Td>
                    <Td align="center">
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: r.is_active
                            ? "var(--gl-success)"
                            : "var(--gl-border-strong)",
                        }}
                        aria-label={
                          r.is_active ? t("active") : t("inactive")
                        }
                      />
                    </Td>
                    <Td align="right">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          aria-label={t("buttons.edit")}
                          style={iconButtonStyle}
                        >
                          <Icon icon={Pencil} size={14} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(r)}
                          disabled={deleting}
                          aria-label={t("buttons.delete")}
                          style={iconButtonStyle}
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

      <MapRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        brands={brands}
        providers={providers}
      />
    </section>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const iconButtonStyle: React.CSSProperties = {
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
};

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
        padding: "10px 12px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}
