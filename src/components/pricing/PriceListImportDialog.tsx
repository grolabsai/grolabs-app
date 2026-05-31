"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

import { parseSpreadsheetFile } from "@/lib/import/xlsx";
import type { ParsedFile } from "@/lib/import/types";
import { suggestColumns, type KeyColumnKind } from "@/lib/pricing/column-detect";
import { parseMoney } from "@/lib/pricing/parse-money";
import {
  importPriceList,
  listActiveProvidersBrief,
  createProvider,
  type ProviderRow,
} from "@/lib/actions/pricing";

type Step = "upload" | "configure" | "result";

type ImportResult = {
  priceListId: number;
  inserted: number;
  matched: number;
  unmatched: number;
  invalidRows: number;
};

const NEW_PROVIDER_VALUE = "__new__";
const NONE_VALUE = "__none__";

export function PriceListImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once an import completes successfully so the parent can refresh. */
  onImported?: () => void;
}) {
  const t = useTranslations("pricing.importDialog");

  const [step, setStep] = useState<Step>("upload");
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [providerSelection, setProviderSelection] = useState<string>("");
  const [newProviderName, setNewProviderName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [keyKind, setKeyKind] = useState<KeyColumnKind>("barcode");
  const [keyColumnIndex, setKeyColumnIndex] = useState<number | null>(null);
  const [costColumnIndex, setCostColumnIndex] = useState<number | null>(null);
  const [suggestedPriceColumnIndex, setSuggestedPriceColumnIndex] = useState<
    number | null
  >(null);

  const [parsing, startParse] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Pull providers when stepping into the configure stage.
  useEffect(() => {
    if (step !== "configure") return;
    let alive = true;
    listActiveProvidersBrief().then((res) => {
      if (!alive || !res.ok) return;
      setProviders(res.providers);
    });
    return () => {
      alive = false;
    };
  }, [step]);

  function resetAll() {
    setStep("upload");
    setParsedFile(null);
    setProviderSelection("");
    setNewProviderName("");
    setEffectiveDate("");
    setKeyKind("barcode");
    setKeyColumnIndex(null);
    setCostColumnIndex(null);
    setSuggestedPriceColumnIndex(null);
    setResult(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetAll();
    onOpenChange(next);
  }

  function handleFile(file: File) {
    startParse(async () => {
      try {
        const parsed = await parseSpreadsheetFile(file, true);
        // Apply column auto-suggestions in the same render as the file lands
        // so we don't trigger a cascading re-render via useEffect.
        const suggestion = suggestColumns(parsed.columns);
        setParsedFile(parsed);
        setKeyColumnIndex(suggestion.keyColumnIndex);
        setKeyKind(suggestion.keyKind ?? "barcode");
        setCostColumnIndex(suggestion.costColumnIndex);
        setSuggestedPriceColumnIndex(suggestion.suggestedPriceColumnIndex);
      } catch (e) {
        const description = e instanceof Error ? e.message : String(e);
        toast.error(t("parseError"), { description });
      }
    });
  }

  function onPick() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  const canContinueFromUpload = !!parsedFile && parsedFile.rows.length > 0;

  const canSubmit =
    !!parsedFile &&
    keyColumnIndex !== null &&
    costColumnIndex !== null &&
    (providerSelection !== "" &&
      (providerSelection !== NEW_PROVIDER_VALUE ||
        newProviderName.trim().length >= 2));

  // Live preview of the resolved values for the first 5 rows.
  const previewRows = useMemo(() => {
    if (!parsedFile || keyColumnIndex === null || costColumnIndex === null) {
      return [];
    }
    return parsedFile.rows.slice(0, 5).map((row) => {
      const key = row[keyColumnIndex] ?? "";
      const costRaw = row[costColumnIndex] ?? "";
      const suggRaw =
        suggestedPriceColumnIndex !== null
          ? row[suggestedPriceColumnIndex] ?? ""
          : "";
      return {
        key: String(key),
        costRaw: String(costRaw),
        cost: parseMoney(costRaw),
        suggested: suggestedPriceColumnIndex !== null ? parseMoney(suggRaw) : null,
      };
    });
  }, [parsedFile, keyColumnIndex, costColumnIndex, suggestedPriceColumnIndex]);

  async function onSubmit() {
    if (!parsedFile || keyColumnIndex === null || costColumnIndex === null)
      return;

    startSubmit(async () => {
      // Resolve provider — create if needed.
      let providerId: number;
      if (providerSelection === NEW_PROVIDER_VALUE) {
        const created = await createProvider(newProviderName);
        if (!created.ok) {
          toast.error(t("toastProviderError"), { description: created.error });
          return;
        }
        providerId = created.provider.provider_id;
      } else {
        providerId = Number(providerSelection);
      }

      const rows: Array<[string, string, string | null]> = parsedFile.rows.map(
        (row) => [
          String(row[keyColumnIndex] ?? "").trim(),
          String(row[costColumnIndex] ?? "").trim(),
          suggestedPriceColumnIndex !== null
            ? String(row[suggestedPriceColumnIndex] ?? "").trim() || null
            : null,
        ],
      );

      const res = await importPriceList({
        providerId,
        effectiveDate: effectiveDate || null,
        fileName: parsedFile.fileName,
        keyKind,
        rows,
      });

      if (!res.ok) {
        toast.error(t("toastImportError"), { description: res.error });
        return;
      }

      setResult({
        priceListId: res.priceListId,
        inserted: res.inserted,
        matched: res.matched,
        unmatched: res.unmatched,
        invalidRows: res.invalidRows,
      });
      setStep("result");
      onImported?.();
      toast.success(
        t("toastImportSuccess", { matched: res.matched, total: rows.length }),
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // Wider than the shadcn default — the configure step shows a preview
        // table and four mappings side-by-side.
        className="max-w-[720px]"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t(`description.${step}`)}</DialogDescription>
        </DialogHeader>

        {step === "upload" ? (
          <div>
            <div
              role="button"
              tabIndex={0}
              onClick={onPick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onPick();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${
                  dragOver ? "var(--rre-accent)" : "var(--s-border-strong)"
                }`,
                background: dragOver
                  ? "var(--rre-accent-50)"
                  : "var(--s-surface-alt)",
                padding: 40,
                borderRadius: "var(--s-radius-lg)",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.12s",
              }}
            >
              <Icon icon={Upload} size={28} strokeWidth={1.5} />
              <div style={{ fontSize: 14, fontWeight: 500, margin: "12px 0 4px" }}>
                {parsing
                  ? t("parsing")
                  : parsedFile
                    ? parsedFile.fileName
                    : t("dropZone")}
              </div>
              <div style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
                {t("dropHint")}
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFileChange}
              style={{ display: "none" }}
            />

            {parsedFile ? (
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                  color: "var(--s-text-secondary)",
                }}
              >
                <Icon icon={FileText} size={14} strokeWidth={1.5} />
                {t("fileMeta", {
                  columns: parsedFile.columns.length,
                  rows: parsedFile.rows.length,
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "configure" && parsedFile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Provider + date row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 200px",
                gap: 12,
              }}
            >
              <Field label={t("fields.provider")}>
                <Select
                  value={providerSelection}
                  onValueChange={setProviderSelection}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("placeholders.provider")} />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem
                        key={p.provider_id}
                        value={String(p.provider_id)}
                      >
                        {p.provider_name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_PROVIDER_VALUE}>
                      {t("providerCreateOption")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {providerSelection === NEW_PROVIDER_VALUE ? (
                  <input
                    type="text"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder={t("placeholders.newProviderName")}
                    style={inputStyle}
                  />
                ) : null}
              </Field>
              <Field label={t("fields.effectiveDate")}>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </div>

            {/* Key column kind + key column */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Field label={t("fields.keyKind")}>
                <Select
                  value={keyKind}
                  onValueChange={(v) => setKeyKind(v as KeyColumnKind)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="barcode">
                      {t("keyKinds.barcode")}
                    </SelectItem>
                    <SelectItem value="provider_sku">
                      {t("keyKinds.provider_sku")}
                    </SelectItem>
                    <SelectItem value="sku">{t("keyKinds.sku")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("fields.keyColumn")}>
                <ColumnPicker
                  columns={parsedFile.columns}
                  value={keyColumnIndex}
                  onChange={setKeyColumnIndex}
                  placeholder={t("placeholders.column")}
                />
              </Field>
            </div>

            {/* Cost + suggested price */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Field label={t("fields.costColumn")}>
                <ColumnPicker
                  columns={parsedFile.columns}
                  value={costColumnIndex}
                  onChange={setCostColumnIndex}
                  placeholder={t("placeholders.column")}
                />
              </Field>
              <Field
                label={t("fields.suggestedPriceColumn")}
                hint={t("fields.suggestedPriceColumnHint")}
              >
                <ColumnPicker
                  columns={parsedFile.columns}
                  value={suggestedPriceColumnIndex}
                  onChange={setSuggestedPriceColumnIndex}
                  placeholder=""
                  allowNone
                />
              </Field>
            </div>

            {/* Preview */}
            {previewRows.length > 0 ? (
              <div
                style={{
                  border: "1px solid var(--s-border)",
                  borderRadius: "var(--s-radius-md)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--s-text-secondary)",
                    background: "var(--s-surface-alt)",
                    borderBottom: "1px solid var(--s-border)",
                  }}
                >
                  {t("preview.title")}
                </div>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <thead>
                    <tr style={{ background: "var(--s-surface)" }}>
                      <Th>{t("preview.key")}</Th>
                      <Th>{t("preview.cost")}</Th>
                      <Th>{t("preview.suggested")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        <Td>{row.key || ""}</Td>
                        <Td>
                          {row.cost === null ? (
                            <span style={{ color: "var(--s-danger)" }}>
                              {row.costRaw || ""}
                            </span>
                          ) : (
                            row.cost.toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          )}
                        </Td>
                        <Td>
                          {suggestedPriceColumnIndex === null
                            ? "—"
                            : row.suggested === null
                              ? "—"
                              : row.suggested.toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "result" && result ? (
          <div style={{ padding: "8px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <Icon
                icon={CheckCircle2}
                size={20}
                strokeWidth={2}
                className="text-green-600"
              />
              <span style={{ fontSize: 15, fontWeight: 500 }}>
                {t("result.heading")}
              </span>
            </div>
            <ResultRow
              label={t("result.matched")}
              value={result.matched.toString()}
            />
            <ResultRow
              label={t("result.unmatched")}
              value={result.unmatched.toString()}
              warn={result.unmatched > 0}
            />
            <ResultRow
              label={t("result.invalid")}
              value={result.invalidRows.toString()}
              warn={result.invalidRows > 0}
            />
          </div>
        ) : null}

        <DialogFooter>
          {step === "upload" ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t("buttons.cancel")}
              </Button>
              <Button
                disabled={!canContinueFromUpload || parsing}
                onClick={() => setStep("configure")}
              >
                {t("buttons.continue")}
              </Button>
            </>
          ) : null}

          {step === "configure" ? (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                {t("buttons.back")}
              </Button>
              <Button disabled={!canSubmit || submitting} onClick={onSubmit}>
                {submitting ? t("buttons.importing") : t("buttons.import")}
              </Button>
            </>
          ) : null}

          {step === "result" ? (
            <Button onClick={() => handleOpenChange(false)}>
              {t("buttons.close")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid var(--s-border-strong)",
  borderRadius: "var(--s-radius-md)",
  background: "var(--s-surface)",
  color: "var(--s-text)",
  marginTop: 6,
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--s-text-secondary)",
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function ColumnPicker({
  columns,
  value,
  onChange,
  placeholder,
  allowNone,
}: {
  columns: string[];
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  allowNone?: boolean;
}) {
  const stringValue = value === null ? (allowNone ? NONE_VALUE : "") : String(value);
  return (
    <Select
      value={stringValue}
      onValueChange={(v) => {
        if (v === NONE_VALUE) onChange(null);
        else onChange(Number(v));
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? (
          <SelectItem value={NONE_VALUE}>{" "}</SelectItem>
        ) : null}
        {columns.map((c, i) => (
          <SelectItem key={i} value={String(i)}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        fontWeight: 500,
        color: "var(--s-text-tertiary)",
        borderBottom: "1px solid var(--s-border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid var(--s-border)",
        color: "var(--s-text)",
      }}
    >
      {children}
    </td>
  );
}

function ResultRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid var(--s-border)",
        fontSize: 14,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: warn ? "var(--s-danger)" : "var(--s-text-secondary)",
        }}
      >
        {warn ? (
          <Icon icon={AlertTriangle} size={14} strokeWidth={2} />
        ) : null}
        {label}
      </span>
      <span style={{ fontWeight: 600, color: "var(--s-text)" }}>{value}</span>
    </div>
  );
}
