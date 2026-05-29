"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import {
  Search,
  ShoppingBag,
  Globe,
  Home,
  LayoutList,
  ChevronRight,
  ChevronLeft,
  Layers,
} from "lucide-react";
import type { DiagnosticCheckRow, DiagnosticStageRow, ProbeType } from "./_types";

const PROBE_ICON: Record<ProbeType, typeof Search> = {
  search: Search,
  pdp: ShoppingBag,
  site_wide: Globe,
  homepage: Home,
  category: LayoutList,
};

// Display order for probe-type groups inside a stage.
const PROBE_ORDER: ProbeType[] = [
  "pdp",
  "category",
  "homepage",
  "site_wide",
  "search",
];

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

  // ── Drill-down position: stage → probe type → checks ──────────────────
  const [view, setView] = useState<{
    stageId: number | null;
    probe: ProbeType | null;
  }>(() => {
    // Open the panel at the currently-selected check's location on deep link.
    if (selectedId != null) {
      const c = checks.find((x) => x.diagnostic_check_id === selectedId);
      if (c) return { stageId: c.diagnostic_stage_id, probe: c.probe_type };
    }
    return { stageId: null, probe: null };
  });

  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.diagnostic_stage_id, s])),
    [stages],
  );

  const byStage = useMemo(() => {
    const map = new Map<number, DiagnosticCheckRow[]>();
    for (const s of stages) map.set(s.diagnostic_stage_id, []);
    for (const c of checks) map.get(c.diagnostic_stage_id)?.push(c);
    return map;
  }, [checks, stages]);

  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return null;
    return checks.filter(
      (c) =>
        c.check_code.toLowerCase().includes(q) ||
        c.check_name.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q),
    );
  }, [checks, q]);

  function probeGroups(stageId: number) {
    const items = byStage.get(stageId) ?? [];
    const present = new Set(items.map((i) => i.probe_type));
    return PROBE_ORDER.filter((p) => present.has(p)).map((p) => ({
      probe: p,
      count: items.filter((i) => i.probe_type === p).length,
    }));
  }

  function probeChecks(stageId: number, probe: ProbeType) {
    return (byStage.get(stageId) ?? []).filter((c) => c.probe_type === probe);
  }

  function selectCheck(id: number) {
    router.push(`?id=${id}`);
  }

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

        {searchResults ? (
          // ── Search flattens the hierarchy: matching checks, direct ──────
          searchResults.length === 0 ? (
            <EmptyNote>{t("empty.noSearchResults")}</EmptyNote>
          ) : (
            <div style={{ marginTop: 8 }}>
              {searchResults.map((check) => (
                <CheckRow
                  key={check.diagnostic_check_id}
                  check={check}
                  selected={selectedId === check.diagnostic_check_id}
                  isTemplate={check.instance_id === 0 && currentInstanceId !== 0}
                  templateLabel={t("templateBadge")}
                  templateShort={t("templateBadgeShort")}
                  onClick={() => selectCheck(check.diagnostic_check_id)}
                />
              ))}
            </div>
          )
        ) : view.stageId != null && view.probe != null ? (
          // ── Level 3: checks within stage + probe type ──────────────────
          <>
            <BackRow
              label={t(`probeType.${view.probe}`)}
              ariaLabel={t("nav.back")}
              onClick={() => setView((v) => ({ ...v, probe: null }))}
            />
            {probeChecks(view.stageId, view.probe).map((check) => (
              <CheckRow
                key={check.diagnostic_check_id}
                check={check}
                selected={selectedId === check.diagnostic_check_id}
                isTemplate={check.instance_id === 0 && currentInstanceId !== 0}
                templateLabel={t("templateBadge")}
                templateShort={t("templateBadgeShort")}
                onClick={() => selectCheck(check.diagnostic_check_id)}
              />
            ))}
          </>
        ) : view.stageId != null ? (
          // ── Level 2: probe-type groups within a stage ──────────────────
          <>
            <BackRow
              label={stageById.get(view.stageId)?.stage_name ?? ""}
              ariaLabel={t("nav.back")}
              onClick={() => setView({ stageId: null, probe: null })}
            />
            {probeGroups(view.stageId).length === 0 ? (
              <EmptyNote>{t("empty.stageNoChecks")}</EmptyNote>
            ) : (
              probeGroups(view.stageId).map(({ probe, count }) => (
                <GroupRow
                  key={probe}
                  icon={PROBE_ICON[probe] ?? Search}
                  label={t(`probeType.${probe}`)}
                  count={t("nav.checksCount", { n: count })}
                  onClick={() =>
                    setView((v) => ({ ...v, probe }))
                  }
                />
              ))
            )}
          </>
        ) : (
          // ── Level 1: funnel stages (top-most grouping) ─────────────────
          stages.map((stage) => {
            const count = (byStage.get(stage.diagnostic_stage_id) ?? []).length;
            return (
              <GroupRow
                key={stage.diagnostic_stage_id}
                icon={Layers}
                label={stage.stage_name}
                count={t("nav.checksCount", { n: count })}
                onClick={() =>
                  setView({ stageId: stage.diagnostic_stage_id, probe: null })
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function BackRow({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        marginBottom: 4,
        border: "none",
        borderBottom: "0.5px solid var(--s-border)",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--s-font)",
        color: "var(--s-text)",
        fontWeight: 600,
        fontSize: 12.5,
      }}
    >
      <Icon icon={ChevronLeft} size={14} />
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
    </button>
  );
}

function GroupRow({
  icon,
  label,
  count,
  onClick,
}: {
  icon: typeof Search;
  label: string;
  count: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--s-radius-md)",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--s-font)",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--s-surface-hover)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon icon={icon} size={15} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--s-text)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
        {count}
      </span>
      <Icon icon={ChevronRight} size={14} />
    </button>
  );
}

function CheckRow({
  check,
  selected,
  isTemplate,
  templateLabel,
  templateShort,
  onClick,
}: {
  check: DiagnosticCheckRow;
  selected: boolean;
  isTemplate: boolean;
  templateLabel: string;
  templateShort: string;
  onClick: () => void;
}) {
  const ProbeIcon = PROBE_ICON[check.probe_type] ?? Search;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px",
        borderRadius: "var(--s-radius-md)",
        border: "none",
        background: selected ? "var(--s-surface-hover)" : "transparent",
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
          title={templateLabel}
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
          {templateShort}
        </span>
      )}
    </button>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        fontSize: 11.5,
        color: "var(--s-text-tertiary)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}
