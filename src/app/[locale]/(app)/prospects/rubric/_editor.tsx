"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createCheck, updateCheck, deleteCheck } from "./actions";
import { FixesEditor } from "./_fixes";
import type {
  ConfidenceLevel,
  DiagnosticCheckRow,
  DiagnosticStageRow,
  FixRecommendationRow,
  ProbeType,
} from "./_types";

type FormState = {
  check_code: string;
  check_name: string;
  description: string;
  diagnostic_stage_id: number;
  probe_type: ProbeType;
  weight: number;
  revenue_lever: string;
  default_delta_rate: string; // string for input control
  default_confidence: ConfidenceLevel;
  is_active: boolean;
  notes: string;
};

const PROBE_TYPES: ProbeType[] = [
  "search",
  "pdp",
  "site_wide",
  "homepage",
  "category",
];

const CONFIDENCE: ConfidenceLevel[] = ["low", "medium", "high"];

function makeDefaultForm(stages: DiagnosticStageRow[]): FormState {
  return {
    check_code: "",
    check_name: "",
    description: "",
    diagnostic_stage_id: stages[0]?.diagnostic_stage_id ?? 0,
    probe_type: "pdp",
    weight: 1.0,
    revenue_lever: "",
    default_delta_rate: "",
    default_confidence: "medium",
    is_active: true,
    notes: "",
  };
}

export function CheckEditor({
  check,
  fixes,
  stages,
  currentInstanceId,
  mode,
}: {
  check: DiagnosticCheckRow | null;
  fixes: FixRecommendationRow[];
  stages: DiagnosticStageRow[];
  currentInstanceId: number;
  mode: "empty" | "create" | "edit";
}) {
  const t = useTranslations("prospects.rubric");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setFormState] = useState<FormState>(
    check
      ? {
          check_code: check.check_code,
          check_name: check.check_name,
          description: check.description ?? "",
          diagnostic_stage_id: check.diagnostic_stage_id,
          probe_type: check.probe_type,
          weight: check.weight,
          revenue_lever: check.revenue_lever ?? "",
          default_delta_rate:
            check.default_delta_rate != null ? String(check.default_delta_rate) : "",
          default_confidence: check.default_confidence,
          is_active: check.is_active,
          notes: check.notes ?? "",
        }
      : makeDefaultForm(stages),
  );

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  }

  const isReadOnly = mode === "edit" && check != null && check.instance_id === 0 && currentInstanceId !== 0;

  function handleSave() {
    startTransition(async () => {
      setError(null);
      const input = {
        check_code: form.check_code,
        check_name: form.check_name,
        description: form.description || null,
        diagnostic_stage_id: form.diagnostic_stage_id,
        probe_type: form.probe_type,
        weight: form.weight,
        revenue_lever: form.revenue_lever || null,
        default_delta_rate:
          form.default_delta_rate.trim() === ""
            ? null
            : Number(form.default_delta_rate),
        default_confidence: form.default_confidence,
        is_active: form.is_active,
        notes: form.notes || null,
      };
      if (mode === "create") {
        const result = await createCheck(input);
        if ("error" in result) {
          setError(translateError(result.error, t));
        } else {
          router.push(`?id=${result.data!.diagnostic_check_id}`);
        }
      } else if (check) {
        const result = await updateCheck(check.diagnostic_check_id, input);
        if ("error" in result) {
          setError(translateError(result.error, t));
        } else {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }
      }
    });
  }

  function handleDelete() {
    if (!check) return;
    if (!window.confirm(t("actions.confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteCheck(check.diagnostic_check_id);
      if ("error" in result) {
        const err = result.error ?? "";
        if (err.startsWith("LINKED:")) {
          setError(t("actions.deleteLinked", { n: err.split(":")[1] }));
        } else {
          setError(translateError(err, t));
        }
      } else {
        router.push("/prospects/rubric");
      }
    });
  }

  if (mode === "empty") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: 40,
        }}
      >
        <p style={{ color: "var(--s-text-tertiary)", fontSize: 13 }}>
          {t("empty.selectPrompt")}
        </p>
      </div>
    );
  }

  const isEdit = mode === "edit";
  const canSave =
    !isReadOnly &&
    form.check_code.trim().length > 0 &&
    form.check_name.trim().length > 0;

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--s-text)" }}>
          {isEdit ? t("form.editTitle") : t("form.createTitle")}
        </h2>
        {isReadOnly && (
          <span
            style={{
              fontSize: 11,
              color: "var(--s-text-tertiary)",
              fontStyle: "italic",
            }}
          >
            {t("readOnlyTemplate")}
          </span>
        )}
      </div>

      <SectionHeader>{t("form.sections.identity")}</SectionHeader>

      <Field label={t("form.fields.checkName")} required>
        <input
          type="text"
          className="s-input"
          value={form.check_name}
          onChange={(e) => setField("check_name", e.target.value)}
          disabled={isReadOnly}
        />
      </Field>

      <Field label={t("form.fields.checkCode")} required hint={t("form.fields.checkCodeHint")}>
        <input
          type="text"
          className="s-input"
          value={form.check_code}
          onChange={(e) => setField("check_code", e.target.value)}
          disabled={isReadOnly}
          style={{ fontFamily: "var(--s-font-mono, ui-monospace, monospace)" }}
        />
      </Field>

      <Field label={t("form.fields.description")}>
        <textarea
          className="s-input"
          rows={3}
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          disabled={isReadOnly}
          style={{ resize: "vertical", minHeight: 60 }}
        />
      </Field>

      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.taxonomy")}</SectionHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("form.fields.stage")}>
          <select
            className="s-input"
            value={form.diagnostic_stage_id}
            onChange={(e) => setField("diagnostic_stage_id", Number(e.target.value))}
            disabled={isReadOnly}
          >
            {stages.map((s) => (
              <option key={s.diagnostic_stage_id} value={s.diagnostic_stage_id}>
                {s.stage_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.fields.probeType")}>
          <select
            className="s-input"
            value={form.probe_type}
            onChange={(e) => setField("probe_type", e.target.value as ProbeType)}
            disabled={isReadOnly}
          >
            {PROBE_TYPES.map((p) => (
              <option key={p} value={p}>
                {t(`probeType.${p}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.scoring")}</SectionHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label={t("form.fields.weight")} hint={t("form.fields.weightHint")}>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            className="s-input"
            value={form.weight}
            onChange={(e) => setField("weight", Number(e.target.value))}
            disabled={isReadOnly}
          />
        </Field>

        <Field label={t("form.fields.deltaRate")} hint={t("form.fields.deltaRateHint")}>
          <input
            type="number"
            min="0"
            max="1"
            step="0.001"
            className="s-input"
            value={form.default_delta_rate}
            placeholder="0.08"
            onChange={(e) => setField("default_delta_rate", e.target.value)}
            disabled={isReadOnly}
          />
        </Field>

        <Field label={t("form.fields.confidence")}>
          <select
            className="s-input"
            value={form.default_confidence}
            onChange={(e) =>
              setField("default_confidence", e.target.value as ConfidenceLevel)
            }
            disabled={isReadOnly}
          >
            {CONFIDENCE.map((c) => (
              <option key={c} value={c}>
                {t(`confidence.${c}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={t("form.fields.revenueLever")} hint={t("form.fields.revenueLeverHint")}>
        <input
          type="text"
          className="s-input"
          value={form.revenue_lever}
          placeholder="search_users × Δ CR × AOV"
          onChange={(e) => setField("revenue_lever", e.target.value)}
          disabled={isReadOnly}
          style={{ fontFamily: "var(--s-font-mono, ui-monospace, monospace)" }}
        />
      </Field>

      <Field label={t("form.fields.notes")}>
        <textarea
          className="s-input"
          rows={2}
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          disabled={isReadOnly}
          style={{ resize: "vertical", minHeight: 44 }}
        />
      </Field>

      <Field label={t("form.fields.active")}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--s-text)",
            cursor: isReadOnly ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setField("is_active", e.target.checked)}
            disabled={isReadOnly}
          />
          {t("form.fields.activeHint")}
        </label>
      </Field>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
          paddingTop: 16,
          borderTop: "0.5px solid var(--s-border)",
        }}
      >
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={handleSave}
          disabled={isPending || !canSave}
        >
          {isPending ? t("actions.saving") : t("actions.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "var(--s-success)" }}>
            {t("actions.saved")}
          </span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>
        )}
        {isEdit && check && !isReadOnly && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--s-danger)",
              background: "none",
              border: "0.5px solid var(--s-danger)",
              borderRadius: "var(--s-radius-md)",
              padding: "5px 10px",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
            }}
          >
            {t("actions.delete")}
          </button>
        )}
      </div>

      {isEdit && check && (
        <FixesEditor
          checkId={check.diagnostic_check_id}
          fixes={fixes}
          currentInstanceId={currentInstanceId}
          readOnly={isReadOnly}
        />
      )}
    </div>
  );
}

function translateError(err: string | undefined, t: ReturnType<typeof useTranslations>) {
  if (!err) return null;
  if (err === "EMPTY_REQUIRED") return t("errors.emptyRequired");
  if (err === "NO_INSTANCE") return t("errors.noInstance");
  return err;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="s-field">
      <label className="s-field-label">
        {label}
        {required && <span style={{ color: "var(--s-danger)" }}> *</span>}
      </label>
      {children}
      {hint && (
        <div
          style={{
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            marginTop: 4,
            paddingLeft: 2,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: "0.5px solid var(--s-border)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
