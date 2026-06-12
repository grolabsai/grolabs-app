"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import { createEntry, updateEntry, deleteEntry, type VariantInput } from "./_actions";
import { HintedInput, HintedSelect } from "@/components/ui/hinted-field";

type VariantType = "canonical" | "typo" | "synonym" | "plural" | "partial";

export type EntryWithVariants = {
  entry_id: number;
  intent_label: string;
  locale: string;
  notes: string | null;
  is_active: boolean;
  variants: Array<{
    variant_id: number;
    variant_type: VariantType;
    query_text: string;
    notes: string | null;
    sort_order: number;
  }>;
};

type Source = "vertical" | "prospect";
type EntryRow = EntryWithVariants & { source: Source };

const VARIANT_LABELS: Record<VariantType, string> = {
  canonical: "Canonical",
  typo: "Typo",
  synonym: "Synonym",
  plural: "Plural",
  partial: "Partial",
};

const VARIANT_COLORS: Record<VariantType, string> = {
  canonical: "var(--gl-accent)",
  typo: "#facc15",
  synonym: "#60a5fa",
  plural: "#a78bfa",
  partial: "#f97316",
};

export function VocabularyEditor({
  prospectId,
  verticalEntries,
  prospectEntries,
}: {
  prospectId: number;
  verticalEntries: EntryRow[];
  prospectEntries: EntryRow[];
}) {
  const t = useTranslations("prospects.testEntries");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Prospect overrides — editable */}
      <Section
        title={t("prospectSection")}
        subtitle={t("prospectSubtitle")}
        action={
          !creating && editingId === null ? (
            <button
              type="button"
              className="s-btn s-btn-primary"
              onClick={() => setCreating(true)}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              + {t("addEntry")}
            </button>
          ) : null
        }
      >
        {creating && (
          <EntryForm
            mode="create"
            prospectId={prospectId}
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        )}

        {prospectEntries.length === 0 && !creating ? (
          <EmptyState>{t("noProspectEntries")}</EmptyState>
        ) : (
          prospectEntries.map((entry) =>
            editingId === entry.entry_id ? (
              <EntryForm
                key={entry.entry_id}
                mode="edit"
                prospectId={prospectId}
                entry={entry}
                onDone={() => setEditingId(null)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <EntryCard
                key={entry.entry_id}
                entry={entry}
                onEdit={() => setEditingId(entry.entry_id)}
                editable
                prospectId={prospectId}
              />
            ),
          )
        )}
      </Section>

      {/* Vertical templates — read-only here */}
      {verticalEntries.length > 0 && (
        <Section
          title={t("verticalSection")}
          subtitle={t("verticalSubtitle")}
        >
          {verticalEntries.map((entry) => (
            <EntryCard
              key={entry.entry_id}
              entry={entry}
              prospectId={prospectId}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

// ── Section wrapper ─────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--gl-surface)",
        border: "0.5px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-lg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "0.5px solid var(--gl-border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--gl-text-tertiary)",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 12,
                color: "var(--gl-text-secondary)",
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        fontSize: 13,
        color: "var(--gl-text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

// ── Entry card (read-only view) ─────────────────────────────────────────

function EntryCard({
  entry,
  onEdit,
  editable,
  prospectId,
}: {
  entry: EntryRow;
  onEdit?: () => void;
  editable?: boolean;
  prospectId: number;
}) {
  const t = useTranslations("prospects.testEntries");
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      const res = await deleteEntry(entry.entry_id, prospectId);
      if (res.error) toast.error(res.error);
      else toast.success(t("deleted"));
    });
  }

  const sortedVariants = [...entry.variants].sort((a, b) => {
    // Canonical first, then by sort_order
    if (a.variant_type === "canonical") return -1;
    if (b.variant_type === "canonical") return 1;
    return a.sort_order - b.sort_order;
  });

  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: "0.5px solid var(--gl-border)",
        opacity: entry.is_active ? 1 : 0.55,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.intent_label}</div>
          {entry.notes && (
            <div
              style={{
                fontSize: 11,
                color: "var(--gl-text-tertiary)",
                marginTop: 2,
              }}
            >
              {entry.notes}
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--gl-text-tertiary)",
            fontFamily: "var(--gl-font-mono)",
          }}
        >
          {entry.locale}
        </span>
        {editable && (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="s-btn"
              style={{ fontSize: 11, padding: "4px 10px" }}
            >
              {t("edit")}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="s-btn"
              disabled={isPending}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                color: "var(--gl-danger)",
              }}
            >
              {t("delete")}
            </button>
          </>
        )}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {sortedVariants.map((v) => (
          <VariantChip key={v.variant_id} type={v.variant_type} text={v.query_text} />
        ))}
      </div>
    </div>
  );
}

function VariantChip({ type, text }: { type: VariantType; text: string }) {
  const color = VARIANT_COLORS[type];
  return (
    <span
      title={VARIANT_LABELS[type]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 4px",
        borderRadius: "var(--gl-radius-pill)",
        background: "var(--gl-surface-alt)",
        border: "0.5px solid var(--gl-border)",
        fontSize: 11,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span style={{ color: "var(--gl-text-tertiary)" }}>{type}</span>
      <span style={{ fontFamily: "var(--gl-font-mono)" }}>{text}</span>
    </span>
  );
}

// ── Entry form (create + edit) ──────────────────────────────────────────

function EntryForm({
  mode,
  prospectId,
  entry,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  prospectId: number;
  entry?: EntryRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("prospects.testEntries");
  const formId = useId();
  const [isPending, startTransition] = useTransition();
  const [intentLabel, setIntentLabel] = useState(entry?.intent_label ?? "");
  const [locale, setLocale] = useState(entry?.locale ?? "en");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [variants, setVariants] = useState<VariantInput[]>(
    entry
      ? entry.variants.map((v) => ({
          variant_type: v.variant_type,
          query_text: v.query_text,
          notes: v.notes,
        }))
      : [{ variant_type: "canonical", query_text: "", notes: null }],
  );

  function updateVariant(idx: number, patch: Partial<VariantInput>) {
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function addVariant(type: VariantType) {
    setVariants((vs) => [...vs, { variant_type: type, query_text: "", notes: null }]);
  }
  function removeVariant(idx: number) {
    setVariants((vs) => vs.filter((_, i) => i !== idx));
  }

  function submit() {
    if (intentLabel.trim().length === 0) {
      toast.error(t("errors.emptyLabel"));
      return;
    }
    if (!variants.some((v) => v.variant_type === "canonical" && v.query_text.trim().length > 0)) {
      toast.error(t("errors.needsCanonical"));
      return;
    }
    startTransition(async () => {
      if (mode === "create") {
        const res = await createEntry({
          prospect_id: prospectId,
          intent_label: intentLabel,
          locale,
          notes,
          variants,
        });
        if (res.error) toast.error(res.error);
        else {
          toast.success(t("created"));
          onDone();
        }
      } else {
        const res = await updateEntry({
          entry_id: entry!.entry_id,
          prospect_id: prospectId,
          intent_label: intentLabel,
          locale,
          notes,
          variants,
        });
        if (res.error) toast.error(res.error);
        else {
          toast.success(t("updated"));
          onDone();
        }
      }
    });
  }

  return (
    <div
      style={{
        padding: 18,
        borderBottom: "0.5px solid var(--gl-border)",
        background: "var(--gl-surface-alt)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
          <HintedInput
            id={`${formId}-intent`}
            label={t("intentLabel")}
            value={intentLabel}
            onChange={(e) => setIntentLabel(e.target.value)}
            hint={{ label: t("intentLabel"), body: t("intentLabelHint") }}
          />
          <HintedSelect
            id={`${formId}-locale`}
            label={t("localeField")}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
          </HintedSelect>
        </div>

        <HintedInput
          id={`${formId}-notes`}
          label={t("notesField")}
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--gl-text-tertiary)",
              marginBottom: 10,
            }}
          >
            {t("variantsHeader")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {variants.map((v, idx) => (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "130px 1fr 36px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <HintedSelect
                  id={`${formId}-variant-${idx}-type`}
                  label={t("variantTypeLabel")}
                  value={v.variant_type}
                  onChange={(e) =>
                    updateVariant(idx, { variant_type: e.target.value as VariantType })
                  }
                >
                  <option value="canonical">{VARIANT_LABELS.canonical}</option>
                  <option value="typo">{VARIANT_LABELS.typo}</option>
                  <option value="synonym">{VARIANT_LABELS.synonym}</option>
                  <option value="plural">{VARIANT_LABELS.plural}</option>
                  <option value="partial">{VARIANT_LABELS.partial}</option>
                </HintedSelect>
                <HintedInput
                  id={`${formId}-variant-${idx}-query`}
                  label={t("variantQueryLabel")}
                  value={v.query_text}
                  onChange={(e) => updateVariant(idx, { query_text: e.target.value })}
                  hint={{
                    label: `${VARIANT_LABELS[v.variant_type]} — ${t("variantQueryLabel")}`,
                    body: t(`variantHintBodies.${v.variant_type}`),
                  }}
                  className="font-mono"
                />
                <button
                  type="button"
                  className="s-btn"
                  onClick={() => removeVariant(idx)}
                  disabled={variants.length === 1}
                  style={{
                    fontSize: 11,
                    padding: "0",
                    width: 36,
                    height: 40,
                    color: "var(--gl-text-tertiary)",
                    justifyContent: "center",
                  }}
                  title={t("removeVariant")}
                  aria-label={t("removeVariant")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <AddVariantButton onClick={() => addVariant("typo")} label={`+ ${t("addTypo")}`} />
            <AddVariantButton onClick={() => addVariant("synonym")} label={`+ ${t("addSynonym")}`} />
            <AddVariantButton onClick={() => addVariant("plural")} label={`+ ${t("addPlural")}`} />
            <AddVariantButton onClick={() => addVariant("partial")} label={`+ ${t("addPartial")}`} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="s-btn"
            onClick={onCancel}
            disabled={isPending}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={submit}
            disabled={isPending}
          >
            {isPending ? t("saving") : mode === "create" ? t("create") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddVariantButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="s-btn"
      style={{
        fontSize: 11,
        padding: "4px 10px",
        background: "transparent",
      }}
    >
      {label}
    </button>
  );
}
