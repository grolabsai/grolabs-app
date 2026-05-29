"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createFix, updateFix, deleteFix } from "./actions";
import type { EffortLevel, FixRecommendationRow, ImpactLevel } from "./_types";

const LEVELS: EffortLevel[] = ["low", "medium", "high"];

const DEFAULT_TRIGGER = '{"result_status": "fail"}';

export function FixesEditor({
  checkId,
  fixes,
  currentInstanceId,
  readOnly,
}: {
  checkId: number;
  fixes: FixRecommendationRow[];
  currentInstanceId: number;
  readOnly: boolean;
}) {
  const t = useTranslations("prospects.rubric");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div style={{ marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
          paddingBottom: 6,
          borderBottom: "0.5px solid var(--s-border)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("fixes.sectionTitle")}
          <span style={{ marginLeft: 6, fontWeight: 400 }}>({fixes.length})</span>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="s-btn s-btn-primary"
            style={{ fontSize: 11, padding: "4px 10px", height: 26 }}
            onClick={() => setCreating(true)}
            disabled={creating}
          >
            {t("fixes.addButton")}
          </button>
        )}
      </div>

      {fixes.length === 0 && !creating && (
        <p style={{ fontSize: 12, color: "var(--s-text-tertiary)", fontStyle: "italic" }}>
          {t("fixes.empty")}
        </p>
      )}

      {creating && (
        <FixRow
          key="new"
          checkId={checkId}
          fix={null}
          readOnly={false}
          onCancel={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}

      {fixes.map((fix) => {
        const isFixTemplate =
          fix.instance_id === 0 && currentInstanceId !== 0;
        return (
          <FixRow
            key={fix.fix_recommendation_id}
            checkId={checkId}
            fix={fix}
            readOnly={readOnly || isFixTemplate}
          />
        );
      })}

      {error && (
        <p style={{ fontSize: 12, color: "var(--s-danger)", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function FixRow({
  checkId,
  fix,
  readOnly,
  onCancel,
  onSaved,
}: {
  checkId: number;
  fix: FixRecommendationRow | null;
  readOnly: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
}) {
  const t = useTranslations("prospects.rubric");
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(!fix);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fix_code: fix?.fix_code ?? "",
    fix_title: fix?.fix_title ?? "",
    fix_body_md: fix?.fix_body_md ?? "",
    trigger_condition: fix
      ? JSON.stringify(fix.trigger_condition, null, 2)
      : DEFAULT_TRIGGER,
    effort: fix?.effort ?? ("medium" as EffortLevel),
    impact: fix?.impact ?? ("high" as ImpactLevel),
    sort_order: fix?.sort_order ?? 10,
    is_active: fix?.is_active ?? true,
  });

  function handleSave() {
    setError(null);
    let trigger: Record<string, unknown> = {};
    try {
      trigger = JSON.parse(form.trigger_condition || "{}");
    } catch {
      setError(t("fixes.invalidJson"));
      return;
    }
    startTransition(async () => {
      const payload = {
        diagnostic_check_id: checkId,
        fix_code: form.fix_code,
        fix_title: form.fix_title,
        fix_body_md: form.fix_body_md,
        trigger_condition: trigger,
        effort: form.effort,
        impact: form.impact,
        sort_order: form.sort_order,
        is_active: form.is_active,
      };
      const result = fix
        ? await updateFix(fix.fix_recommendation_id, payload)
        : await createFix(payload);
      if ("error" in result) {
        setError(
          result.error === "EMPTY_REQUIRED"
            ? t("errors.emptyRequired")
            : result.error ?? null,
        );
      } else {
        if (!fix && onSaved) onSaved();
        if (fix) setExpanded(false);
      }
    });
  }

  function handleDelete() {
    if (!fix) return;
    if (!window.confirm(t("fixes.confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteFix(fix.fix_recommendation_id);
      if ("error" in result) setError(result.error ?? null);
    });
  }

  // Collapsed display for existing fixes
  if (fix && !expanded) {
    return (
      <div
        style={{
          padding: "10px 12px",
          marginBottom: 8,
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          background: fix.is_active ? "var(--s-surface)" : "var(--s-surface-alt)",
          opacity: fix.is_active ? 1 : 0.7,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--s-text)",
            }}
          >
            {fix.fix_title}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              display: "flex",
              gap: 10,
              marginTop: 2,
            }}
          >
            <span
              style={{ fontFamily: "var(--s-font-mono, ui-monospace, monospace)" }}
            >
              {fix.fix_code}
            </span>
            <span>
              {t("fixes.effortShort")}: {t(`fixes.level.${fix.effort}`)}
            </span>
            <span>
              {t("fixes.impactShort")}: {t(`fixes.level.${fix.impact}`)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            fontSize: 11,
            color: "var(--scout-accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--s-font)",
          }}
        >
          {readOnly ? t("fixes.view") : t("fixes.edit")}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        marginBottom: 8,
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
        background: "var(--s-surface)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="s-field">
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("fixes.fields.code")}
          </label>
          <input
            type="text"
            className="s-input"
            value={form.fix_code}
            onChange={(e) => setForm({ ...form, fix_code: e.target.value })}
            disabled={readOnly}
            style={{
              fontFamily: "var(--s-font-mono, ui-monospace, monospace)",
              fontSize: 12,
            }}
          />
        </div>
        <div className="s-field">
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("fixes.fields.title")}
          </label>
          <input
            type="text"
            className="s-input"
            value={form.fix_title}
            onChange={(e) => setForm({ ...form, fix_title: e.target.value })}
            disabled={readOnly}
            style={{ fontSize: 12 }}
          />
        </div>
      </div>

      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fixes.fields.body")} (markdown)
        </label>
        <textarea
          className="s-input"
          rows={6}
          value={form.fix_body_md}
          onChange={(e) => setForm({ ...form, fix_body_md: e.target.value })}
          disabled={readOnly}
          style={{ fontSize: 12, fontFamily: "var(--s-font-mono, ui-monospace, monospace)", resize: "vertical", minHeight: 100 }}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label" style={{ fontSize: 11 }}>
          {t("fixes.fields.trigger")} (JSON)
        </label>
        <textarea
          className="s-input"
          rows={3}
          value={form.trigger_condition}
          onChange={(e) => setForm({ ...form, trigger_condition: e.target.value })}
          disabled={readOnly}
          style={{
            fontSize: 11,
            fontFamily: "var(--s-font-mono, ui-monospace, monospace)",
            resize: "vertical",
          }}
        />
        <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 4 }}>
          {t("fixes.fields.triggerHint")}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        <div className="s-field">
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("fixes.fields.effort")}
          </label>
          <select
            className="s-input"
            value={form.effort}
            onChange={(e) => setForm({ ...form, effort: e.target.value as EffortLevel })}
            disabled={readOnly}
            style={{ fontSize: 12 }}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`fixes.level.${l}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="s-field">
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("fixes.fields.impact")}
          </label>
          <select
            className="s-input"
            value={form.impact}
            onChange={(e) => setForm({ ...form, impact: e.target.value as ImpactLevel })}
            disabled={readOnly}
            style={{ fontSize: 12 }}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`fixes.level.${l}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="s-field">
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("fixes.fields.order")}
          </label>
          <input
            type="number"
            className="s-input"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
            disabled={readOnly}
            style={{ fontSize: 12 }}
          />
        </div>
        <div className="s-field" style={{ display: "flex", alignItems: "flex-end" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              cursor: readOnly ? "not-allowed" : "pointer",
              paddingBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              disabled={readOnly}
            />
            {t("fixes.fields.active")}
          </label>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        {!readOnly && (
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={handleSave}
            disabled={isPending}
            style={{ fontSize: 12, padding: "5px 12px", height: 28 }}
          >
            {isPending ? t("actions.saving") : t("actions.save")}
          </button>
        )}
        {fix && !readOnly && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
            }}
          >
            {t("actions.collapse")}
          </button>
        )}
        {!fix && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
            }}
          >
            {t("actions.cancel")}
          </button>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>
        )}
        {fix && !readOnly && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--s-danger)",
              background: "none",
              border: "0.5px solid var(--s-danger)",
              borderRadius: "var(--s-radius-md)",
              padding: "4px 8px",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
            }}
          >
            {t("actions.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
