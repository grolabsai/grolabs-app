"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createAttribute,
  updateAttribute,
  deleteAttribute,
  addAttributeOption,
  deleteAttributeOption,
} from "./actions";
import type { AttributeRow, OptionRow } from "./_types";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type FormState = {
  attribute_name: string;
  attribute_code: string;
  description: string;
  parsing_hint: string;
  data_type: string;
  dimension: string | null;
  is_multivalue: boolean;
  is_filterable: boolean;
  is_searchable: boolean;
  is_active: boolean;
};

const DEFAULT_FORM: FormState = {
  attribute_name: "",
  attribute_code: "",
  description: "",
  parsing_hint: "",
  data_type: "text",
  dimension: null,
  is_multivalue: false,
  is_filterable: false,
  is_searchable: false,
  is_active: true,
};

export function AttributeEditor({
  attribute,
  options: initialOptions,
  mode,
}: {
  attribute: AttributeRow | null;
  options: OptionRow[];
  mode: "empty" | "create" | "edit";
}) {
  const t = useTranslations("catalog.attributes");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [options, setOptions] = useState<OptionRow[]>(initialOptions);
  const [newOptionValue, setNewOptionValue] = useState("");
  const [addingOption, setAddingOption] = useState(false);

  const [form, setFormState] = useState<FormState>(
    attribute
      ? {
          attribute_name: attribute.attribute_name,
          attribute_code: attribute.attribute_code,
          description: attribute.description ?? "",
          parsing_hint: attribute.parsing_hint ?? "",
          data_type: attribute.data_type ?? "text",
          dimension: attribute.dimension ?? null,
          is_multivalue: attribute.is_multivalue,
          is_filterable: attribute.is_filterable,
          is_searchable: attribute.is_searchable,
          is_active: attribute.is_active,
        }
      : DEFAULT_FORM,
  );

  const DATA_TYPE_LABELS: Record<string, string> = {
    list: t("form.dataTypes.list"),
    text: t("form.dataTypes.text"),
    number: t("form.dataTypes.number"),
    boolean: t("form.dataTypes.boolean"),
    date: t("form.dataTypes.date"),
    quantity: t("form.dataTypes.quantity"),
    single_ref: t("form.dataTypes.single_ref"),
  };

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setFormState((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "attribute_name" && !codeManuallyEdited && mode === "create") {
        next.attribute_code = slugify(value as string);
      }
      return next;
    });
    setSaved(false);
    setError(null);
  }

  function handleSave() {
    startTransition(async () => {
      setError(null);
      const input = {
        attribute_name: form.attribute_name,
        attribute_code: form.attribute_code,
        description: form.description || null,
        parsing_hint: form.parsing_hint.trim() || null,
        data_type: form.data_type,
        dimension: form.data_type === "quantity" ? form.dimension : null,
        is_multivalue: form.is_multivalue,
        is_filterable: form.is_filterable,
        is_searchable: form.is_searchable,
        is_active: form.is_active,
      };

      if (mode === "create") {
        const result = await createAttribute(input);
        if ("error" in result) {
          setError(result.error ?? null);
        } else {
          router.push(`?id=${result.data!.attribute_id}`);
        }
      } else if (attribute) {
        const result = await updateAttribute(attribute.attribute_id, input);
        if ("error" in result) {
          setError(result.error ?? null);
        } else {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }
      }
    });
  }

  function handleDelete() {
    if (!attribute) return;
    if (!window.confirm(t("actions.confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteAttribute(attribute.attribute_id);
      if ("error" in result) {
        const err = result.error ?? "";
        if (err.startsWith("LINKED:")) {
          const n = err.split(":")[1];
          setError(t("actions.deleteLinked", { n }));
        } else {
          setError(err || null);
        }
      } else {
        router.push("/catalog/attributes");
      }
    });
  }

  async function handleAddOption() {
    if (!attribute || !newOptionValue.trim()) return;
    setAddingOption(true);
    const result = await addAttributeOption(attribute.attribute_id, {
      value: newOptionValue.trim(),
      value_code: slugify(newOptionValue.trim()),
      sort_order: options.length + 1,
      is_active: true,
    });
    if (!("error" in result) && result.data) {
      setOptions((prev) => [
        ...prev,
        {
          value_id: result.data.value_id,
          value: newOptionValue.trim(),
          value_code: slugify(newOptionValue.trim()),
          sort_order: prev.length + 1,
          is_active: true,
        },
      ]);
      setNewOptionValue("");
    }
    setAddingOption(false);
  }

  async function handleDeleteOption(valueId: number) {
    setOptions((prev) => prev.filter((o) => o.value_id !== valueId));
    await deleteAttributeOption(valueId);
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

  function codeHint(): string {
    if (isEdit) return t("form.fields.codeLockedHint");
    if (codeManuallyEdited) return t("form.fields.codeManualHint");
    return t("form.fields.codeAutoHint");
  }

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 20px", color: "var(--s-text)" }}>
        {isEdit ? t("form.editTitle") : t("form.createTitle")}
      </h2>

      {/* Basic info */}
      <SectionHeader>{t("form.sections.basic")}</SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.name")}</label>
        <input
          type="text"
          className="s-input"
          value={form.attribute_name}
          placeholder={t("form.fields.namePlaceholder")}
          onChange={(e) => setField("attribute_name", e.target.value)}
          readOnly={isEdit}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.code")}</label>
        <input
          type="text"
          className="s-input s-input-mono"
          value={form.attribute_code}
          placeholder={t("form.fields.codePlaceholder")}
          readOnly={isEdit}
          onChange={(e) => {
            if (isEdit) return;
            setCodeManuallyEdited(true);
            setField("attribute_code", e.target.value);
          }}
          style={isEdit ? { opacity: 0.6, cursor: "default" } : undefined}
        />
        <div style={{ fontSize: 10, color: "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
          {codeHint()}
        </div>
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.description")}</label>
        <textarea
          className="s-textarea"
          rows={2}
          value={form.description}
          placeholder={t("form.fields.descriptionPlaceholder")}
          onChange={(e) => setField("description", e.target.value)}
        />
      </div>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.parsingHint")}</label>
        <textarea
          className="s-textarea"
          rows={3}
          value={form.parsing_hint}
          placeholder={t("form.fields.parsingHintPlaceholder")}
          onChange={(e) => setField("parsing_hint", e.target.value)}
        />
        <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 4, paddingLeft: 2 }}>
          {t("form.fields.parsingHintDesc")}
        </div>
      </div>

      {/* Data type */}
      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.type")}</SectionHeader>

      <div className="s-field">
        <label className="s-field-label">{t("form.fields.dataType")}</label>
        <select
          className="s-select"
          value={form.data_type}
          disabled={isEdit}
          onChange={(e) => setField("data_type", e.target.value)}
          style={isEdit ? { opacity: 0.6, cursor: "default" } : undefined}
        >
          <option value="" disabled>
            {t("form.fields.dataTypePlaceholder")}
          </option>
          {Object.entries(DATA_TYPE_LABELS).map(([dt, label]) => (
            <option key={dt} value={dt}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {form.data_type === "quantity" && (
        <div className="s-field">
          <label className="s-field-label">{t("form.fields.dimension")}</label>
          <select
            className="s-select"
            value={form.dimension ?? ""}
            onChange={(e) => setField("dimension", e.target.value || null)}
          >
            <option value="" disabled>
              {t("form.fields.dimensionPlaceholder")}
            </option>
            <option value="mass">{t("form.fields.dimensionMass")}</option>
            <option value="volume">{t("form.fields.dimensionVolume")}</option>
            <option value="count">{t("form.fields.dimensionCount")}</option>
          </select>
        </div>
      )}

      {/* Behavior */}
      <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.behavior")}</SectionHeader>
      <div>
        <ToggleRow
          title={t("form.behavior.isMultivalue")}
          desc={t("form.behavior.isMultivalueDesc")}
          value={form.is_multivalue}
          onChange={(v) => setField("is_multivalue", v)}
        />
        <ToggleRow
          title={t("form.behavior.isFilterable")}
          desc={t("form.behavior.isFilterableDesc")}
          value={form.is_filterable}
          onChange={(v) => setField("is_filterable", v)}
        />
        <ToggleRow
          title={t("form.behavior.isSearchable")}
          desc={t("form.behavior.isSearchableDesc")}
          value={form.is_searchable}
          onChange={(v) => setField("is_searchable", v)}
        />
        <ToggleRow
          title={t("form.behavior.isActive")}
          desc={t("form.behavior.isActiveDesc")}
          value={form.is_active}
          onChange={(v) => setField("is_active", v)}
        />
      </div>

      {/* Options — list type, edit mode only */}
      {form.data_type === "list" && isEdit && (
        <>
          <SectionHeader style={{ marginTop: 20 }}>{t("form.sections.options")}</SectionHeader>

          {options.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--s-text-tertiary)", marginBottom: 8 }}>
              {t("form.options.noOptions")}
            </p>
          )}

          {options.map((opt) => (
            <div
              key={opt.value_id}
              style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
            >
              <input
                type="text"
                className="s-input"
                style={{ flex: 1, height: 34, fontSize: 12 }}
                value={opt.value}
                readOnly
              />
              <button
                type="button"
                onClick={() => handleDeleteOption(opt.value_id)}
                style={{
                  fontSize: 14,
                  color: "var(--s-text-tertiary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 6px",
                  fontFamily: "var(--s-font)",
                }}
              >
                {t("form.options.deleteOption")}
              </button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              className="s-input"
              style={{ flex: 1, height: 34, fontSize: 12 }}
              value={newOptionValue}
              placeholder={t("form.options.optionValuePlaceholder")}
              onChange={(e) => setNewOptionValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddOption();
                }
              }}
            />
            <button
              type="button"
              className="s-btn s-btn-primary"
              style={{ height: 34, fontSize: 12, padding: "0 12px" }}
              onClick={handleAddOption}
              disabled={!newOptionValue.trim() || addingOption}
            >
              {t("form.options.addOption")}
            </button>
          </div>
        </>
      )}

      {/* Actions */}
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
          disabled={isPending}
        >
          {isPending ? t("actions.saving") : t("actions.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "var(--s-success)" }}>{t("actions.saved")}</span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "var(--s-danger)" }}>{error}</span>
        )}
        {isEdit && attribute && (
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

function ToggleRow({
  title,
  desc,
  value,
  onChange,
}: {
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="s-toggle-row">
      <div className="s-toggle-info">
        <div className="s-toggle-title">{title}</div>
        <div className="s-toggle-sub">{desc}</div>
      </div>
      <button
        type="button"
        className={`s-toggle${value ? " on" : ""}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      />
    </div>
  );
}
