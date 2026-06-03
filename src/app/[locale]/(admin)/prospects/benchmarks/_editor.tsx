"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  createBenchmark,
  deleteBenchmark,
  updateBenchmark,
  type BenchmarkInput,
} from "./actions";
import type {
  BenchmarkRow,
  CheckRow,
  StageRow,
  VerticalRow,
} from "./page";

type DraftState = {
  vertical_id: number;
  diagnostic_stage_id: number | null;
  diagnostic_check_id: number | null;
  baseline_cr: string;
  stage_share: string;
  delta_rate: string;
  default_aov_usd: string;
  source: string;
  effective_from: string;
  notes: string;
};

function makeDraft(verticals: VerticalRow[]): DraftState {
  return {
    vertical_id: verticals[0]?.vertical_id ?? 0,
    diagnostic_stage_id: null,
    diagnostic_check_id: null,
    baseline_cr: "",
    stage_share: "",
    delta_rate: "",
    default_aov_usd: "",
    source: "",
    effective_from: new Date().toISOString().slice(0, 10),
    notes: "",
  };
}

function toInput(d: DraftState): BenchmarkInput {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    vertical_id: d.vertical_id,
    diagnostic_stage_id: d.diagnostic_stage_id,
    diagnostic_check_id: d.diagnostic_check_id,
    baseline_cr: num(d.baseline_cr),
    stage_share: num(d.stage_share),
    delta_rate: num(d.delta_rate),
    default_aov_usd: num(d.default_aov_usd),
    source: d.source.trim() || null,
    effective_from: d.effective_from,
    notes: d.notes.trim() || null,
  };
}

export function BenchmarksEditor({
  verticals,
  stages,
  checks,
  benchmarks,
  currentInstanceId,
}: {
  verticals: VerticalRow[];
  stages: StageRow[];
  checks: CheckRow[];
  benchmarks: BenchmarkRow[];
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.benchmarks");
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftState>(makeDraft(verticals));
  const [error, setError] = useState<string | null>(null);

  const verticalMap = useMemo(
    () => new Map(verticals.map((v) => [v.vertical_id, v])),
    [verticals],
  );
  const stageMap = useMemo(
    () => new Map(stages.map((s) => [s.diagnostic_stage_id, s])),
    [stages],
  );
  const checkMap = useMemo(
    () => new Map(checks.map((c) => [c.diagnostic_check_id, c])),
    [checks],
  );

  const grouped = useMemo(() => {
    const map = new Map<number, BenchmarkRow[]>();
    for (const v of verticals) map.set(v.vertical_id, []);
    for (const b of benchmarks) {
      const arr = map.get(b.vertical_id);
      if (arr) arr.push(b);
    }
    return map;
  }, [verticals, benchmarks]);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createBenchmark(toInput(draft));
      if ("error" in result) {
        setError(result.error ?? null);
      } else {
        setCreating(false);
        setDraft(makeDraft(verticals));
      }
    });
  }

  return (
    <div>
      <div
        style={{
          background: "var(--gl-surface)",
          border: "0.5px solid var(--gl-border)",
          borderRadius: "var(--gl-radius-lg)",
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "0.5px solid var(--gl-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gl-text)" }}>
            {t("listTitle")}
            <span style={{ marginLeft: 8, color: "var(--gl-text-tertiary)", fontWeight: 400 }}>
              ({benchmarks.length})
            </span>
          </div>
          {!creating && (
            <button
              type="button"
              className="s-btn s-btn-primary"
              style={{ fontSize: 12, padding: "5px 12px", height: 28 }}
              onClick={() => setCreating(true)}
              disabled={verticals.length === 0}
            >
              {t("createButton")}
            </button>
          )}
        </div>

        {creating && (
          <div style={{ padding: 16, background: "var(--gl-surface-alt)", borderBottom: "0.5px solid var(--gl-border)" }}>
            <DraftForm
              draft={draft}
              setDraft={setDraft}
              verticals={verticals}
              stages={stages}
              checks={checks}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                className="s-btn s-btn-primary"
                onClick={handleCreate}
                disabled={isPending}
              >
                {isPending ? t("actions.saving") : t("actions.save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
                style={{
                  fontSize: 12,
                  color: "var(--gl-text-tertiary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--gl-font)",
                }}
              >
                {t("actions.cancel")}
              </button>
              {error && (
                <span style={{ fontSize: 12, color: "var(--gl-danger)" }}>{error}</span>
              )}
            </div>
          </div>
        )}

        {benchmarks.length === 0 && !creating && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--gl-text-tertiary)", fontSize: 13 }}>
            {t("empty")}
          </div>
        )}

        {Array.from(grouped.entries()).map(([verticalId, rows]) => {
          if (rows.length === 0) return null;
          const vertical = verticalMap.get(verticalId);
          if (!vertical) return null;
          return (
            <div key={verticalId}>
              <div
                style={{
                  padding: "8px 16px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--gl-text-tertiary)",
                  background: "var(--gl-surface-alt)",
                  borderBottom: "0.5px solid var(--gl-border)",
                }}
              >
                {vertical.vertical_name}
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ background: "var(--gl-surface-alt)" }}>
                    <Th>{t("table.scope")}</Th>
                    <Th>{t("table.baselineCr")}</Th>
                    <Th>{t("table.stageShare")}</Th>
                    <Th>{t("table.deltaRate")}</Th>
                    <Th>{t("table.aov")}</Th>
                    <Th>{t("table.source")}</Th>
                    <Th>{t("table.effectiveFrom")}</Th>
                    <Th>{t("table.actions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <BenchmarkRowView
                      key={b.vertical_benchmark_id}
                      row={b}
                      stages={stages}
                      checks={checks}
                      stageMap={stageMap}
                      checkMap={checkMap}
                      currentInstanceId={currentInstanceId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BenchmarkRowView({
  row,
  stages,
  checks,
  stageMap,
  checkMap,
  currentInstanceId,
}: {
  row: BenchmarkRow;
  stages: StageRow[];
  checks: CheckRow[];
  stageMap: Map<number, StageRow>;
  checkMap: Map<number, CheckRow>;
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.benchmarks");
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftState>({
    vertical_id: row.vertical_id,
    diagnostic_stage_id: row.diagnostic_stage_id,
    diagnostic_check_id: row.diagnostic_check_id,
    baseline_cr: row.baseline_cr != null ? String(row.baseline_cr) : "",
    stage_share: row.stage_share != null ? String(row.stage_share) : "",
    delta_rate: row.delta_rate != null ? String(row.delta_rate) : "",
    default_aov_usd: row.default_aov_usd != null ? String(row.default_aov_usd) : "",
    source: row.source ?? "",
    effective_from: row.effective_from,
    notes: row.notes ?? "",
  });

  const isTemplate = row.instance_id === 0 && currentInstanceId !== 0;
  const scope =
    row.diagnostic_check_id != null
      ? `${t("scope.check")}: ${checkMap.get(row.diagnostic_check_id)?.check_code ?? row.diagnostic_check_id}`
      : row.diagnostic_stage_id != null
        ? `${t("scope.stage")}: ${stageMap.get(row.diagnostic_stage_id)?.stage_name ?? row.diagnostic_stage_id}`
        : t("scope.vertical");

  function handleSave() {
    startTransition(async () => {
      await updateBenchmark(row.vertical_benchmark_id, {
        diagnostic_stage_id: draft.diagnostic_stage_id,
        diagnostic_check_id: draft.diagnostic_check_id,
        baseline_cr: draft.baseline_cr.trim() === "" ? null : Number(draft.baseline_cr),
        stage_share: draft.stage_share.trim() === "" ? null : Number(draft.stage_share),
        delta_rate: draft.delta_rate.trim() === "" ? null : Number(draft.delta_rate),
        default_aov_usd:
          draft.default_aov_usd.trim() === "" ? null : Number(draft.default_aov_usd),
        source: draft.source || null,
        effective_from: draft.effective_from,
        notes: draft.notes || null,
      });
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!window.confirm(t("actions.confirmDelete"))) return;
    startTransition(async () => {
      await deleteBenchmark(row.vertical_benchmark_id);
    });
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: 12, background: "var(--gl-surface-alt)" }}>
          <DraftForm
            draft={draft}
            setDraft={setDraft}
            verticals={[]}
            stages={stages}
            checks={checks}
            hideVertical
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              type="button"
              className="s-btn s-btn-primary"
              onClick={handleSave}
              disabled={isPending}
              style={{ fontSize: 12, padding: "5px 12px", height: 28 }}
            >
              {isPending ? t("actions.saving") : t("actions.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                fontSize: 12,
                color: "var(--gl-text-tertiary)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--gl-font)",
              }}
            >
              {t("actions.cancel")}
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: "0.5px solid var(--gl-border)" }}>
      <Td>{scope}</Td>
      <Td mono>{row.baseline_cr ?? ""}</Td>
      <Td mono>{row.stage_share ?? ""}</Td>
      <Td mono>{row.delta_rate ?? ""}</Td>
      <Td mono>{row.default_aov_usd ?? ""}</Td>
      <Td>{row.source ?? ""}</Td>
      <Td>{row.effective_from}</Td>
      <Td>
        {isTemplate ? (
          <span style={{ fontSize: 10, color: "var(--gl-text-tertiary)" }}>
            {t("template")}
          </span>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                fontSize: 11,
                color: "var(--gl-accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--gl-font)",
                padding: 0,
              }}
            >
              {t("actions.edit")}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              style={{
                fontSize: 11,
                color: "var(--gl-danger)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--gl-font)",
                padding: 0,
              }}
            >
              {t("actions.delete")}
            </button>
          </div>
        )}
      </Td>
    </tr>
  );
}

function DraftForm({
  draft,
  setDraft,
  verticals,
  stages,
  checks,
  hideVertical,
}: {
  draft: DraftState;
  setDraft: (d: DraftState) => void;
  verticals: VerticalRow[];
  stages: StageRow[];
  checks: CheckRow[];
  hideVertical?: boolean;
}) {
  const t = useTranslations("prospects.benchmarks");
  const filteredChecks =
    draft.diagnostic_stage_id != null
      ? checks.filter((c) => c.diagnostic_stage_id === draft.diagnostic_stage_id)
      : checks;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      {!hideVertical && (
        <div className="s-field">
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("fields.vertical")}
          </label>
          <select
            className="s-input"
            value={draft.vertical_id}
            onChange={(e) => setDraft({ ...draft, vertical_id: Number(e.target.value) })}
          >
            {verticals.map((v) => (
              <option key={v.vertical_id} value={v.vertical_id}>
                {v.vertical_name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.stage")}
        </label>
        <select
          className="s-input"
          value={draft.diagnostic_stage_id ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              diagnostic_stage_id: e.target.value ? Number(e.target.value) : null,
              diagnostic_check_id: null,
            })
          }
        >
          <option value="">{t("fields.allStages")}</option>
          {stages.map((s) => (
            <option key={s.diagnostic_stage_id} value={s.diagnostic_stage_id}>
              {s.stage_name}
            </option>
          ))}
        </select>
      </div>
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.check")}
        </label>
        <select
          className="s-input"
          value={draft.diagnostic_check_id ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              diagnostic_check_id: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">{t("fields.allChecks")}</option>
          {filteredChecks.map((c) => (
            <option key={c.diagnostic_check_id} value={c.diagnostic_check_id}>
              {c.check_code}
            </option>
          ))}
        </select>
      </div>
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.effectiveFrom")}
        </label>
        <input
          type="date"
          className="s-input"
          value={draft.effective_from}
          onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })}
        />
      </div>
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.baselineCr")}
        </label>
        <input
          type="number"
          step="0.0001"
          className="s-input"
          value={draft.baseline_cr}
          placeholder="0.018"
          onChange={(e) => setDraft({ ...draft, baseline_cr: e.target.value })}
        />
      </div>
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.stageShare")}
        </label>
        <input
          type="number"
          step="0.0001"
          className="s-input"
          value={draft.stage_share}
          placeholder="0.25"
          onChange={(e) => setDraft({ ...draft, stage_share: e.target.value })}
        />
      </div>
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.deltaRate")}
        </label>
        <input
          type="number"
          step="0.0001"
          className="s-input"
          value={draft.delta_rate}
          placeholder="0.08"
          onChange={(e) => setDraft({ ...draft, delta_rate: e.target.value })}
        />
      </div>
      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.aov")}
        </label>
        <input
          type="number"
          step="0.01"
          className="s-input"
          value={draft.default_aov_usd}
          placeholder="45.00"
          onChange={(e) => setDraft({ ...draft, default_aov_usd: e.target.value })}
        />
      </div>
      <div className="s-field" style={{ gridColumn: "span 2" }}>
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.source")}
        </label>
        <input
          type="text"
          className="s-input"
          value={draft.source}
          placeholder="Baymard 2024"
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
        />
      </div>
      <div className="s-field" style={{ gridColumn: "span 2" }}>
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fields.notes")}
        </label>
        <input
          type="text"
          className="s-input"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "8px 12px",
        textAlign: "left",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--gl-text-tertiary)",
        borderBottom: "0.5px solid var(--gl-border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: "8px 12px",
        fontSize: 12,
        color: "var(--gl-text)",
        fontFamily: mono
          ? "var(--gl-font-mono, ui-monospace, monospace)"
          : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}
