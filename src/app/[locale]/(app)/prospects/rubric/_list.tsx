"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { Search, ShoppingBag, Package, Globe, Home, LayoutList } from "lucide-react";
import type { DiagnosticCheckRow, DiagnosticStageRow, ProbeType } from "./_types";

const PROBE_ICON: Record<ProbeType, typeof Search> = {
  search: Search,
  pdp: ShoppingBag,
  site_wide: Globe,
  homepage: Home,
  category: LayoutList,
};

export function CheckList({
  stages,
  checks,
  currentInstanceId,
}: {
  stages: DiagnosticStageRow[];
  checks: DiagnosticCheckRow[];
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.rubric");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id")
    ? parseInt(searchParams.get("id")!, 10)
    : null;
  const isCreate = searchParams.get("mode") === "create";

  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? checks.filter(
          (c) =>
            c.check_code.toLowerCase().includes(q) ||
            c.check_name.toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q),
        )
      : checks;
    const map = new Map<number, DiagnosticCheckRow[]>();
    for (const stage of stages) map.set(stage.diagnostic_stage_id, []);
    for (const check of filtered) {
      const arr = map.get(check.diagnostic_stage_id);
      if (arr) arr.push(check);
    }
    return map;
  }, [checks, stages, query]);

  return (
    <div
      style={{
        borderRight: "0.5px solid var(--s-border)",
        background: "var(--s-surface-alt)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 12px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--s-text)" }}>
            {t("listTitle")}
          </span>
          <button
            type="button"
            className="s-btn s-btn-primary"
            style={{ fontSize: 11, padding: "4px 10px", height: 28 }}
            onClick={() => router.push("?mode=create")}
          >
            {t("createButton")}
          </button>
        </div>

        <input
          type="search"
          className="s-input"
          style={{ height: 32, fontSize: 12 }}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 16px" }}>
        {isCreate && (
          <div
            style={{
              padding: "8px 10px",
              margin: "4px 8px",
              borderRadius: "var(--s-radius-md)",
              background: "var(--scout-accent-50)",
              borderLeft: "3px solid var(--scout-accent)",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--s-text)",
            }}
          >
            {t("form.createTitle")}
          </div>
        )}

        {stages.map((stage) => {
          const items = grouped.get(stage.diagnostic_stage_id) ?? [];
          if (items.length === 0 && query) return null;

          return (
            <div key={stage.diagnostic_stage_id} style={{ marginTop: 12 }}>
              <div
                style={{
                  padding: "6px 12px",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--s-text-tertiary)",
                }}
              >
                {stage.stage_name}
                <span style={{ marginLeft: 6, fontWeight: 400 }}>({items.length})</span>
              </div>

              {items.length === 0 && (
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: 11,
                    color: "var(--s-text-tertiary)",
                    fontStyle: "italic",
                  }}
                >
                  {t("empty.stageNoChecks")}
                </div>
              )}

              {items.map((check) => {
                const ProbeIcon = PROBE_ICON[check.probe_type] ?? Search;
                const isTemplate = check.instance_id === 0 && currentInstanceId !== 0;
                return (
                  <button
                    key={check.diagnostic_check_id}
                    type="button"
                    onClick={() =>
                      router.push(`?id=${check.diagnostic_check_id}`)
                    }
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 12px",
                      borderRadius: "var(--s-radius-md)",
                      border: "none",
                      background:
                        selectedId === check.diagnostic_check_id
                          ? "var(--s-surface-hover)"
                          : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--s-font)",
                      opacity: check.is_active ? 1 : 0.5,
                    }}
                  >
                    <Icon icon={ProbeIcon} size={14} />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12.5,
                          color: "var(--s-text)",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {check.check_name}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          color: "var(--s-text-tertiary)",
                          fontFamily: "var(--s-font-mono, ui-monospace, monospace)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {check.check_code}
                      </span>
                    </div>
                    {isTemplate && (
                      <span
                        title={t("templateBadge")}
                        style={{
                          fontSize: 9,
                          color: "var(--s-text-tertiary)",
                          background: "var(--s-surface)",
                          border: "0.5px solid var(--s-border)",
                          padding: "1px 5px",
                          borderRadius: 3,
                          flexShrink: 0,
                        }}
                      >
                        {t("templateBadgeShort")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
