"use client";

import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * Inline-edit primitives for the product detail page.
 *
 * Pattern: render-as-text by default; on click, swap to the matching
 * input. Blur or Enter commits via the supplied saver. Empty values
 * render with the muted "— vacío —" placeholder.
 *
 * Optimistic UI is implemented via React 19's useOptimistic — the
 * displayed value is the optimistic value during the in-flight save,
 * and after the transition ends it falls back to the prop (which by
 * then reflects the saved value because the server action calls
 * revalidatePath). On error the optimistic auto-reverts and a sonner
 * toast surfaces the message.
 *
 * Each save reports up via `onSaved()` so the editor's "Guardado hace …"
 * indicator can update.
 */

export type SaveResult = { ok: true } | { error: string };

type CommonProps = {
  onSaved: () => void;
};

// ─── Single-line text ───────────────────────────────────────────────────────

export function InlineText({
  initial,
  onSave,
  onSaved,
  monospace = false,
  ariaLabel,
}: CommonProps & {
  initial: string | null;
  onSave: (value: string) => Promise<SaveResult>;
  monospace?: boolean;
  ariaLabel?: string;
}) {
  const t = useTranslations("product.detail");
  const safeInitial = initial ?? "";
  const [optimistic, addOptimistic] = useOptimistic(
    safeInitial,
    (_, next: string) => next,
  );
  const [editValue, setEditValue] = useState(safeInitial);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setEditValue(optimistic);
    setEditing(true);
  }

  const commit = useCallback(() => {
    setEditing(false);
    if (editValue === optimistic) return;
    const next = editValue;
    startTransition(async () => {
      addOptimistic(next);
      const r = await onSave(next);
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
      } else {
        onSaved();
      }
    });
  }, [editValue, optimistic, addOptimistic, onSave, onSaved, t]);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditValue(optimistic);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`s-input ${monospace ? "s-input-mono" : ""}`}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      }}
      style={{
        cursor: "text",
        padding: "8px 12px",
        minHeight: 36,
        borderRadius: 6,
        border: "1px solid transparent",
        fontFamily: monospace ? "var(--s-font-mono)" : "inherit",
        fontSize: 13,
        color: optimistic ? "var(--s-text)" : "var(--s-text-muted)",
        fontStyle: optimistic ? "normal" : "italic",
      }}
      aria-label={ariaLabel}
    >
      {optimistic || t("empty")}
    </div>
  );
}

// ─── Multi-line textarea (expand-on-focus) ──────────────────────────────────

export function InlineTextarea({
  initial,
  onSave,
  onSaved,
  rows = 4,
  ariaLabel,
}: CommonProps & {
  initial: string | null;
  onSave: (value: string) => Promise<SaveResult>;
  rows?: number;
  ariaLabel?: string;
}) {
  const t = useTranslations("product.detail");
  const safeInitial = initial ?? "";
  const [optimistic, addOptimistic] = useOptimistic(
    safeInitial,
    (_, next: string) => next,
  );
  const [editValue, setEditValue] = useState(safeInitial);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function startEdit() {
    setEditValue(optimistic);
    setEditing(true);
  }

  const commit = useCallback(() => {
    setEditing(false);
    if (editValue === optimistic) return;
    const next = editValue;
    startTransition(async () => {
      addOptimistic(next);
      const r = await onSave(next);
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
      } else {
        onSaved();
      }
    });
  }, [editValue, optimistic, addOptimistic, onSave, onSaved, t]);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditValue(optimistic);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="s-textarea"
        rows={rows}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        aria-label={ariaLabel}
      />
    );
  }

  // Collapsed preview — first non-empty line, truncated.
  const previewLine = optimistic.split("\n").find((l) => l.trim()) ?? "";
  return (
    <div
      onClick={startEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      }}
      style={{
        cursor: "text",
        padding: "8px 12px",
        minHeight: 36,
        borderRadius: 6,
        border: "1px solid transparent",
        fontSize: 13,
        color: previewLine ? "var(--s-text)" : "var(--s-text-muted)",
        fontStyle: previewLine ? "normal" : "italic",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      aria-label={ariaLabel}
    >
      {previewLine || t("empty")}
    </div>
  );
}

// ─── Select ─────────────────────────────────────────────────────────────────

export function InlineSelect({
  initial,
  options,
  allowNull,
  onSave,
  onSaved,
  ariaLabel,
}: CommonProps & {
  initial: number | null;
  options: { id: number; label: string }[];
  /** If true, the dropdown includes a blank option that clears the value. Omit to make the field required. */
  allowNull?: boolean;
  onSave: (value: number | null) => Promise<SaveResult>;
  ariaLabel?: string;
}) {
  const t = useTranslations("product.detail");
  const [optimistic, addOptimistic] = useOptimistic(
    initial,
    (_: number | null, next: number | null) => next,
  );
  const [, startTransition] = useTransition();

  function commit(next: number | null) {
    if (next === optimistic) return;
    startTransition(async () => {
      addOptimistic(next);
      const r = await onSave(next);
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
      } else {
        onSaved();
      }
    });
  }

  const NULL_TOKEN = "__null__";
  return (
    <Select
      value={optimistic === null ? NULL_TOKEN : String(optimistic)}
      onValueChange={(v) => commit(v === NULL_TOKEN ? null : Number(v))}
    >
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNull ? <SelectItem value={NULL_TOKEN}>{" "}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.id} value={String(o.id)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Switch (boolean) ───────────────────────────────────────────────────────

export function InlineSwitch({
  initial,
  onSave,
  onSaved,
  ariaLabel,
}: CommonProps & {
  initial: boolean;
  onSave: (value: boolean) => Promise<SaveResult>;
  ariaLabel?: string;
}) {
  const t = useTranslations("product.detail");
  const [optimistic, addOptimistic] = useOptimistic(
    initial,
    (_: boolean, next: boolean) => next,
  );
  const [, startTransition] = useTransition();

  function commit(next: boolean) {
    if (next === optimistic) return;
    startTransition(async () => {
      addOptimistic(next);
      const r = await onSave(next);
      if ("error" in r) {
        toast.error(t("saveError"), { description: r.error });
      } else {
        onSaved();
      }
    });
  }

  return (
    <Switch checked={optimistic} onCheckedChange={commit} aria-label={ariaLabel} />
  );
}
