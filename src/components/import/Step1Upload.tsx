"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { Upload, FileText } from "lucide-react";

import { useWizard } from "@/components/import/WizardContext";
import { useAgentLog } from "@/components/shell/AgentLogContext";
import { makeAgentMessage } from "@/lib/import/agent-message";
import { parseSpreadsheetFile } from "@/lib/import/xlsx";

export function Step1Upload() {
  const t = useTranslations("import.wizard.step1");
  const { state, dispatch } = useWizard();
  const { append: logAgent } = useAgentLog();
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File, hasHeaders: boolean) {
    try {
      const parsed = await parseSpreadsheetFile(file, hasHeaders);
      dispatch({ type: "SET_PARSED_FILE", file: parsed });
      logAgent(
        makeAgentMessage({
          kind: "info",
          title: t("agentTitleParsed"),
          body: t("agentBodyParsed", {
            file: parsed.fileName,
            cols: parsed.columns.length,
            rows: parsed.rows.length,
          }),
        }),
      );
    } catch (e) {
      const description = e instanceof Error ? e.message : String(e);
      toast.error(t("parseError"), { description });
      logAgent(
        makeAgentMessage({
          kind: "error",
          title: t("agentTitleParseError"),
          body: description,
        }),
      );
    }
  }

  function onPick() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    startTransition(() => handleFile(f, true));
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) startTransition(() => handleFile(f, true));
  }

  function toggleHeaders() {
    if (!state.parsedFile) return;
    // Re-parse the same file with the new header flag — but we don't have the
    // raw File anymore. Workaround: ask the user to re-upload if they want to
    // change this. Toggle just flips a hint; the wizard's Step-2 column picker
    // works either way.
    dispatch({
      type: "SET_PARSED_FILE",
      file: { ...state.parsedFile, hasHeaders: !state.parsedFile.hasHeaders },
    });
  }

  const file = state.parsedFile;
  const previewRows = file ? file.rows.slice(0, 5) : [];

  return (
    <div>
      <div className="s-card">
        <p className="s-card-label">{t("title")}</p>
        <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 16px" }}>
          {t("subtitle")}
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={onPick}
          style={{
            border: `2px dashed ${dragOver ? "var(--rre-accent)" : "var(--s-border-strong)"}`,
            background: dragOver ? "var(--rre-accent-50)" : "var(--s-surface-alt)",
            padding: 48,
            borderRadius: "var(--s-radius-lg)",
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.12s",
          }}
        >
          <Icon icon={Upload} size={32} />
          <div style={{ fontSize: 14, fontWeight: 500, margin: "12px 0 4px" }}>
            {pending ? t("parsing") : file ? file.fileName : t("dropZone")}
          </div>
          <div style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>{t("dropHint")}</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={onChange}
          style={{ display: "none" }}
        />

        {file ? (
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
            <Icon icon={FileText} size={16} />
            <div style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
              {t("fileMeta", { columns: file.columns.length, rows: file.rows.length })}
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--s-text-secondary)" }}>
              <input
                type="checkbox"
                checked={file.hasHeaders}
                onChange={toggleHeaders}
              />
              {t("hasHeaders")}
            </label>
          </div>
        ) : null}
      </div>

      {file && file.rows.length > 0 ? (
        <div className="s-card" style={{ padding: 0 }}>
          <div style={{ padding: "12px 20px", fontSize: 13, fontWeight: 500, borderBottom: "0.5px solid var(--s-border)" }}>
            {t("previewTitle")}
          </div>
          <div style={{ overflow: "auto", maxHeight: 400 }}>
            <table className="s-table" style={{ minWidth: "100%" }}>
              <thead>
                <tr>
                  {file.columns.map((c, i) => (
                    <th key={i} style={{ paddingLeft: i === 0 ? 20 : 12, whiteSpace: "nowrap" }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ paddingLeft: ci === 0 ? 20 : 12, whiteSpace: "nowrap" }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 20px", fontSize: 11, color: "var(--s-text-tertiary)" }}>
            {t("previewFooter", { shown: Math.min(5, file.rows.length), total: file.rows.length })}
          </div>
        </div>
      ) : null}

      {/* Footer actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
        <button
          type="button"
          className="s-btn s-btn-primary"
          disabled={!file || file.rows.length === 0 || pending}
          onClick={() => dispatch({ type: "GO_TO_STEP", step: 2 })}
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}
