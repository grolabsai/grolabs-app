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
  Layers,
  Compass,
  Navigation,
  Package,
  Undo2,
} from "lucide-react";
import type { DiagnosticCheckRow, DiagnosticStageRow, ProbeType } from "./_types";

const PROBE_ICON: Record<ProbeType, typeof Search> = {
  search: Search,
  pdp: ShoppingBag,
  site_wide: Globe,
  homepage: Home,
  category: LayoutList,
};

// Icon per funnel stage, keyed by the stable stage_code. Falls back to a
// generic glyph for any instance-defined stage not in this map.
const STAGE_ICON: Record<string, typeof Search> = {
  discovery: Compass,
  on_site_nav: Navigation,
  pdp: Package,
  returns: Undo2,
};

// Identity hue per probe type — backed by --s-probe-* style-guide tokens.
const PROBE_COLOR: Record<ProbeType, string> = {
  pdp: "var(--s-probe-pdp)",
  category: "var(--s-probe-category)",
  homepage: "var(--s-probe-homepage)",
  site_wide: "var(--s-probe-site-wide)",
  search: "var(--s-probe-search)",
};

// Display order for probe-type groups inside a stage.
const PROBE_ORDER: ProbeType[] = [
  "pdp",
  "category",
  "homepage",
  "site_wide",
  "search",
];

const INDENT_BASE = 12;
const INDENT_STEP = 18;

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

  const byStage = useMemo(() => {
    const map = new Map<number, DiagnosticCheckRow[]>();
    for (const s of stages) map.set(s.diagnostic_stage_id, []);
    for (const c of checks) map.get(c.diagnostic_stage_id)?.push(c);
    return map;
  }, [checks, stages]);

  // ── Expand/collapse state — children render inline under their parent,
  //    and any number of branches can stay open at once. ──────────────────
  const [openStages, setOpenStages] = useState<Set<number>>(() => {
    const s = new Set<number>();
    if (selectedId != null) {
      const c = checks.find((x) => x.diagnostic_check_id === selectedId);
      if (c) s.add(c.diagnostic_stage_id);
    }
    return s;
  });
  const [openProbes, setOpenProbes] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (selectedId != null) {
      const c = checks.find((x) => x.diagnostic_check_id === selectedId);
      if (c) s.add(`${c.diagnostic_stage_id}:${c.probe_type}`);
    }
    return s;
  });

  function toggleStage(id: number) {
    setOpenStages((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleProbe(key: string) {
    setOpenProbes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

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
      checks: items.filter((i) => i.probe_type === p),
    }));
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
              background: "var(--rre-accent-50)",
              borderLeft: "3px solid var(--rre-accent)",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--s-text)",
            }}
          >
            {t("form.createTitle")}
          </div>
        )}

        {searchResults ? (
          // ── Search flattens the tree: matching checks, direct ───────────
          searchResults.length === 0 ? (
            <EmptyNote>{t("empty.noSearchResults")}</EmptyNote>
          ) : (
            <div style={{ marginTop: 8 }}>
              {searchResults.map((check) => (
                <CheckRow
                  key={check.diagnostic_check_id}
                  check={check}
                  depth={0}
                  selected={selectedId === check.diagnostic_check_id}
                  isTemplate={check.instance_id === 0 && currentInstanceId !== 0}
                  templateLabel={t("templateBadge")}
                  templateShort={t("templateBadgeShort")}
                  onClick={() => selectCheck(check.diagnostic_check_id)}
                />
              ))}
            </div>
          )
        ) : (
          // ── Expandable tree: stage → probe type → checks, inline ────────
          stages.map((stage) => {
            const stageOpen = openStages.has(stage.diagnostic_stage_id);
            const groups = probeGroups(stage.diagnostic_stage_id);
            const total = (byStage.get(stage.diagnostic_stage_id) ?? []).length;
            return (
              <div key={stage.diagnostic_stage_id}>
                <BranchRow
                  depth={0}
                  open={stageOpen}
                  icon={STAGE_ICON[stage.stage_code] ?? Layers}
                  label={stage.stage_name}
                  count={t("nav.checksCount", { n: total })}
                  onClick={() => toggleStage(stage.diagnostic_stage_id)}
                />
                {stageOpen &&
                  (groups.length === 0 ? (
                    <EmptyNote depth={1}>{t("empty.stageNoChecks")}</EmptyNote>
                  ) : (
                    groups.map(({ probe, checks: probeChecks }) => {
                      const pkey = `${stage.diagnostic_stage_id}:${probe}`;
                      const probeOpen = openProbes.has(pkey);
                      return (
                        <div key={probe}>
                          <BranchRow
                            depth={1}
                            open={probeOpen}
                            icon={PROBE_ICON[probe] ?? Search}
                            iconColor={PROBE_COLOR[probe]}
                            accentColor={PROBE_COLOR[probe]}
                            label={t(`probeType.${probe}`)}
                            count={t("nav.checksCount", { n: probeChecks.length })}
                            onClick={() => toggleProbe(pkey)}
                          />
                          {probeOpen &&
                            probeChecks.map((check) => (
                              <CheckRow
                                key={check.diagnostic_check_id}
                                check={check}
                                depth={2}
                                accentColor={PROBE_COLOR[probe]}
                                selected={
                                  selectedId === check.diagnostic_check_id
                                }
                                isTemplate={
                                  check.instance_id === 0 &&
                                  currentInstanceId !== 0
                                }
                                templateLabel={t("templateBadge")}
                                templateShort={t("templateBadgeShort")}
                                onClick={() =>
                                  selectCheck(check.diagnostic_check_id)
                                }
                              />
                            ))}
                        </div>
                      );
                    })
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function BranchRow({
  depth,
  open,
  icon,
  iconColor,
  accentColor,
  label,
  count,
  onClick,
}: {
  depth: number;
  open: boolean;
  icon: typeof Search;
  iconColor?: string;
  accentColor?: string;
  label: string;
  count: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 12px",
        paddingLeft: INDENT_BASE + depth * INDENT_STEP,
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
      {accentColor && <AccentBar color={accentColor} />}
      <span
        style={{
          display: "flex",
          color: "var(--s-text-tertiary)",
          transition: "transform 0.12s ease",
          transform: open ? "rotate(90deg)" : "none",
        }}
      >
        <Icon icon={ChevronRight} size={13} />
      </span>
      <span style={{ display: "flex", color: iconColor ?? "var(--s-text)" }}>
        <Icon icon={icon} size={15} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: depth === 0 ? 600 : 500,
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
    </button>
  );
}

function CheckRow({
  check,
  depth,
  accentColor,
  selected,
  isTemplate,
  templateLabel,
  templateShort,
  onClick,
}: {
  check: DiagnosticCheckRow;
  depth: number;
  accentColor?: string;
  selected: boolean;
  isTemplate: boolean;
  templateLabel: string;
  templateShort: string;
  onClick: () => void;
}) {
  const ProbeIcon = PROBE_ICON[check.probe_type] ?? Search;
  const accent = accentColor ?? PROBE_COLOR[check.probe_type] ?? "var(--s-text)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 12px",
        // align the check icon under the parent group's icon
        paddingLeft: INDENT_BASE + depth * INDENT_STEP + 21,
        borderRadius: "var(--s-radius-md)",
        border: "none",
        background: selected ? "var(--s-surface-hover)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--s-font)",
        opacity: check.is_active ? 1 : 0.5,
      }}
    >
      <AccentBar color={accent} />
      <span style={{ color: accent, display: "flex", marginTop: 1 }}>
        <Icon icon={ProbeIcon} size={14} />
      </span>
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

function AccentBar({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: 4,
        top: 0,
        bottom: 0,
        width: 3,
        background: color,
      }}
    />
  );
}

function EmptyNote({
  depth = 0,
  children,
}: {
  depth?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        paddingLeft: INDENT_BASE + depth * INDENT_STEP + 8,
        fontSize: 11.5,
        color: "var(--s-text-tertiary)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}
