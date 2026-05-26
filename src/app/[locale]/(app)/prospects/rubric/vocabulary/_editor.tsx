"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  createSynonymPair,
  deleteSynonymPair,
  createTestQuery,
  deleteTestQuery,
} from "./actions";
import type { SynonymPair, TestQuery, Vertical } from "./page";

const LOCALES = ["es", "en"];
const INTENTS = ["category", "empty_state", "brand", "feature"];

export function VocabularyEditor({
  verticals,
  pairs,
  queries,
  currentInstanceId,
}: {
  verticals: Vertical[];
  pairs: SynonymPair[];
  queries: TestQuery[];
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.vocabulary");
  const [activeTab, setActiveTab] = useState<"pairs" | "queries">("pairs");

  const verticalMap = useMemo(
    () => new Map(verticals.map((v) => [v.vertical_id, v])),
    [verticals],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "0.5px solid var(--s-border)",
          marginBottom: 16,
        }}
      >
        <TabButton active={activeTab === "pairs"} onClick={() => setActiveTab("pairs")}>
          {t("synonymsTab")} ({pairs.length})
        </TabButton>
        <TabButton active={activeTab === "queries"} onClick={() => setActiveTab("queries")}>
          {t("queriesTab")} ({queries.length})
        </TabButton>
      </div>

      {activeTab === "pairs" ? (
        <SynonymPairsPanel
          verticals={verticals}
          pairs={pairs}
          verticalMap={verticalMap}
          currentInstanceId={currentInstanceId}
        />
      ) : (
        <TestQueriesPanel
          verticals={verticals}
          queries={queries}
          verticalMap={verticalMap}
          currentInstanceId={currentInstanceId}
        />
      )}
    </div>
  );
}

// ── Synonym pairs ──────────────────────────────────────────────────────────

function SynonymPairsPanel({
  verticals,
  pairs,
  verticalMap,
  currentInstanceId,
}: {
  verticals: Vertical[];
  pairs: SynonymPair[];
  verticalMap: Map<number, Vertical>;
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.vocabulary");
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    vertical_id: verticals[0]?.vertical_id ?? 0,
    term_a: "",
    term_b: "",
    locale: "es",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createSynonymPair({
        vertical_id: draft.vertical_id,
        term_a: draft.term_a,
        term_b: draft.term_b,
        locale: draft.locale,
        notes: draft.notes || null,
      });
      if ("error" in result) setError(result.error ?? null);
      else setDraft({ ...draft, term_a: "", term_b: "", notes: "" });
    });
  }

  return (
    <div>
      <Card>
        <CardHeader>{t("addSynonym")}</CardHeader>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.6fr 1fr auto", gap: 10 }}>
          <Select
            label={t("fields.vertical")}
            value={draft.vertical_id}
            onChange={(v) => setDraft({ ...draft, vertical_id: Number(v) })}
            options={verticals.map((v) => ({ value: v.vertical_id, label: v.vertical_name }))}
          />
          <TextInput
            label={t("fields.termA")}
            value={draft.term_a}
            onChange={(v) => setDraft({ ...draft, term_a: v })}
            placeholder="perro"
          />
          <TextInput
            label={t("fields.termB")}
            value={draft.term_b}
            onChange={(v) => setDraft({ ...draft, term_b: v })}
            placeholder="canino"
          />
          <Select
            label={t("fields.locale")}
            value={draft.locale}
            onChange={(v) => setDraft({ ...draft, locale: String(v) })}
            options={LOCALES.map((l) => ({ value: l, label: l }))}
          />
          <TextInput
            label={t("fields.notes")}
            value={draft.notes}
            onChange={(v) => setDraft({ ...draft, notes: v })}
            placeholder=""
          />
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              className="s-btn s-btn-primary"
              onClick={handleCreate}
              disabled={isPending}
              style={{ height: 36 }}
            >
              {t("addButton")}
            </button>
          </div>
        </div>
        {error && (
          <div style={{ padding: "0 14px 12px", fontSize: 12, color: "var(--s-danger)" }}>
            {error}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          {t("synonymsTitle")} <Hint>{t("templateHint")}</Hint>
        </CardHeader>
        {pairs.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("fields.vertical")}</Th>
                <Th>{t("fields.termA")}</Th>
                <Th>{t("fields.termB")}</Th>
                <Th>{t("fields.locale")}</Th>
                <Th>{t("fields.notes")}</Th>
                <Th>{t("fields.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <PairRow
                  key={p.pair_id}
                  pair={p}
                  verticalName={verticalMap.get(p.vertical_id)?.vertical_name ?? "?"}
                  currentInstanceId={currentInstanceId}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function PairRow({
  pair,
  verticalName,
  currentInstanceId,
}: {
  pair: SynonymPair;
  verticalName: string;
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.vocabulary");
  const [isPending, startTransition] = useTransition();
  const isTemplate = pair.instance_id === 0 && currentInstanceId !== 0;
  return (
    <tr style={{ borderBottom: "0.5px solid var(--s-border)", opacity: pair.is_active ? 1 : 0.55 }}>
      <Td>{verticalName}</Td>
      <Td mono>{pair.term_a}</Td>
      <Td mono>{pair.term_b}</Td>
      <Td>{pair.locale}</Td>
      <Td>{pair.notes ?? ""}</Td>
      <Td>
        {isTemplate ? (
          <span style={{ fontSize: 10, color: "var(--s-text-tertiary)" }}>{t("template")}</span>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(t("confirmDelete"))) return;
              startTransition(async () => {
                await deleteSynonymPair(pair.pair_id);
              });
            }}
            style={{
              fontSize: 11,
              color: "var(--s-danger)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
              padding: 0,
            }}
          >
            {t("delete")}
          </button>
        )}
      </Td>
    </tr>
  );
}

// ── Test queries ───────────────────────────────────────────────────────────

function TestQueriesPanel({
  verticals,
  queries,
  verticalMap,
  currentInstanceId,
}: {
  verticals: Vertical[];
  queries: TestQuery[];
  verticalMap: Map<number, Vertical>;
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.vocabulary");
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    vertical_id: verticals[0]?.vertical_id ?? 0,
    query_text: "",
    locale: "es",
    intent: "category",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createTestQuery({
        vertical_id: draft.vertical_id,
        query_text: draft.query_text,
        locale: draft.locale,
        intent: draft.intent,
        notes: draft.notes || null,
      });
      if ("error" in result) setError(result.error ?? null);
      else setDraft({ ...draft, query_text: "", notes: "" });
    });
  }

  return (
    <div>
      <Card>
        <CardHeader>{t("addQuery")}</CardHeader>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1.4fr 0.6fr 0.8fr 1fr auto", gap: 10 }}>
          <Select
            label={t("fields.vertical")}
            value={draft.vertical_id}
            onChange={(v) => setDraft({ ...draft, vertical_id: Number(v) })}
            options={verticals.map((v) => ({ value: v.vertical_id, label: v.vertical_name }))}
          />
          <TextInput
            label={t("fields.queryText")}
            value={draft.query_text}
            onChange={(v) => setDraft({ ...draft, query_text: v })}
            placeholder="comida para perro"
          />
          <Select
            label={t("fields.locale")}
            value={draft.locale}
            onChange={(v) => setDraft({ ...draft, locale: String(v) })}
            options={LOCALES.map((l) => ({ value: l, label: l }))}
          />
          <Select
            label={t("fields.intent")}
            value={draft.intent}
            onChange={(v) => setDraft({ ...draft, intent: String(v) })}
            options={INTENTS.map((i) => ({ value: i, label: i }))}
          />
          <TextInput
            label={t("fields.notes")}
            value={draft.notes}
            onChange={(v) => setDraft({ ...draft, notes: v })}
            placeholder=""
          />
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              className="s-btn s-btn-primary"
              onClick={handleCreate}
              disabled={isPending}
              style={{ height: 36 }}
            >
              {t("addButton")}
            </button>
          </div>
        </div>
        {error && (
          <div style={{ padding: "0 14px 12px", fontSize: 12, color: "var(--s-danger)" }}>
            {error}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          {t("queriesTitle")} <Hint>{t("templateHint")}</Hint>
        </CardHeader>
        {queries.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("fields.vertical")}</Th>
                <Th>{t("fields.queryText")}</Th>
                <Th>{t("fields.locale")}</Th>
                <Th>{t("fields.intent")}</Th>
                <Th>{t("fields.notes")}</Th>
                <Th>{t("fields.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <QueryRow
                  key={q.query_id}
                  query={q}
                  verticalName={verticalMap.get(q.vertical_id)?.vertical_name ?? "?"}
                  currentInstanceId={currentInstanceId}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function QueryRow({
  query,
  verticalName,
  currentInstanceId,
}: {
  query: TestQuery;
  verticalName: string;
  currentInstanceId: number;
}) {
  const t = useTranslations("prospects.vocabulary");
  const [isPending, startTransition] = useTransition();
  const isTemplate = query.instance_id === 0 && currentInstanceId !== 0;
  return (
    <tr style={{ borderBottom: "0.5px solid var(--s-border)", opacity: query.is_active ? 1 : 0.55 }}>
      <Td>{verticalName}</Td>
      <Td mono>{query.query_text}</Td>
      <Td>{query.locale}</Td>
      <Td>{query.intent}</Td>
      <Td>{query.notes ?? ""}</Td>
      <Td>
        {isTemplate ? (
          <span style={{ fontSize: 10, color: "var(--s-text-tertiary)" }}>{t("template")}</span>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(t("confirmDelete"))) return;
              startTransition(async () => {
                await deleteTestQuery(query.query_id);
              });
            }}
            style={{
              fontSize: 11,
              color: "var(--s-danger)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--s-font)",
              padding: 0,
            }}
          >
            {t("delete")}
          </button>
        )}
      </Td>
    </tr>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 14px",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid var(--scout-accent)" : "2px solid transparent",
        color: active ? "var(--s-text)" : "var(--s-text-tertiary)",
        fontWeight: active ? 600 : 400,
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "var(--s-font)",
      }}
    >
      {children}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "0.5px solid var(--s-border)",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--s-text)",
      }}
    >
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ marginLeft: 6, color: "var(--s-text-tertiary)", fontWeight: 400, fontSize: 11 }}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 24, textAlign: "center", color: "var(--s-text-tertiary)", fontSize: 12 }}>
      {children}
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
        color: "var(--s-text-tertiary)",
        borderBottom: "0.5px solid var(--s-border)",
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
        color: "var(--s-text)",
        fontFamily: mono ? "var(--s-font-mono, ui-monospace, monospace)" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="s-field" style={{ marginBottom: 0 }}>
      <label className="s-field-label" style={{ fontSize: 11 }}>{label}</label>
      <input
        type="text"
        className="s-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Select<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="s-field" style={{ marginBottom: 0 }}>
      <label className="s-field-label" style={{ fontSize: 11 }}>{label}</label>
      <select
        className="s-input"
        value={value}
        onChange={(e) => onChange((typeof value === "number" ? Number(e.target.value) : e.target.value) as T)}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
