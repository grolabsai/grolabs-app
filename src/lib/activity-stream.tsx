"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAgentLog } from "@/components/shell/AgentLogContext";
import type { AgentMessage } from "@/lib/import/types";

/**
 * Bridges server-side failures into the right-side Activity Stream (the
 * Assistant panel, `useAgentLog`). Server actions and API routes can only
 * return Result-shaped values; the calling client component invokes one of
 * these reporters on the failure branch so the operator gets a *persistent*,
 * timestamped, copyable entry — not just an ephemeral toast.
 *
 * The toast still fires, but only as a brief pointer ("see the Assistant
 * panel"); the panel entry is the source of truth for diagnosis.
 */

type ReportInput = {
  /** Where the failure came from, e.g. "WooCommerce import · categories". */
  source: string;
  /** One-line headline for the panel bubble. */
  title: string;
  /** Human-readable failure detail (usually the server's error string). */
  message: string;
  /**
   * Optional structured payload the operator can copy verbatim. `source` and
   * `message` are folded in automatically, so pass only the extra context
   * (ids, phase, counts, the raw server result, …).
   */
  context?: Record<string, unknown>;
};

function buildMessage(
  kind: Extract<AgentMessage["kind"], "error" | "warning" | "info">,
  input: ReportInput,
): AgentMessage {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `as-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    kind,
    title: input.title,
    body: input.message,
    raw: {
      source: input.source,
      message: input.message,
      ...(input.context ?? {}),
    },
  };
}

export function useActivityStream() {
  const { append } = useAgentLog();
  const t = useTranslations("activityStream");

  const reportError = useCallback(
    (input: ReportInput) => {
      append(buildMessage("error", input));
      toast.error(t("errorToastTitle"), { description: t("seePanel") });
    },
    [append, t],
  );

  const reportWarning = useCallback(
    (input: ReportInput) => {
      append(buildMessage("warning", input));
      toast.warning(t("warningToastTitle"), { description: t("seePanel") });
    },
    [append, t],
  );

  const reportInfo = useCallback(
    (input: ReportInput) => {
      append(buildMessage("info", input));
    },
    [append],
  );

  return { reportError, reportWarning, reportInfo };
}
