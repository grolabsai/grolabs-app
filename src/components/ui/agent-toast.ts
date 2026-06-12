/**
 * Drop-in replacement for sonner's `toast`. Instead of a transient toast at the
 * bottom of the screen, messages are routed into the right-side Assistant
 * panel (persistent + copyable). This is the single interception point: feature
 * code keeps calling `toast.success(...)` / `toast.error(...)` exactly as before
 * — only the import source changes (`sonner` → `@/components/ui/agent-toast`).
 *
 * Fallback: on surfaces with no Assistant panel mounted (e.g. the public blog),
 * `emitAgentLog` returns false and we defer to a real sonner toast so the
 * message is still seen.
 *
 * API parity: the codebase only uses success / error / warning / message /
 * dismiss (+ a bare call). Less-common sonner methods (promise / loading / etc.)
 * pass straight through to the real implementation.
 */

import type { ReactNode } from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";
import {
  emitAgentLog,
  type AgentBusKind,
} from "@/components/shell/agent-log-bus";

// In this codebase the message and `description` are always `t()` strings; we
// coerce defensively in case a ReactNode ever slips through.
function asText(v: unknown): string | undefined {
  return typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : undefined;
}

function route(
  kind: AgentBusKind,
  message: ReactNode,
  options: ExternalToast | undefined,
  fallback: (m: ReactNode, o?: ExternalToast) => string | number,
): void {
  const title = asText(message) ?? "";
  const body = asText(options?.description);
  emitAgentLog({ kind, title, body }, () => {
    fallback(message, options);
  });
}

export const toast = Object.assign(
  (message: ReactNode, options?: ExternalToast) =>
    route("info", message, options, sonnerToast),
  {
    success: (message: ReactNode, options?: ExternalToast) =>
      route("success", message, options, sonnerToast.success),
    error: (message: ReactNode, options?: ExternalToast) =>
      route("error", message, options, sonnerToast.error),
    warning: (message: ReactNode, options?: ExternalToast) =>
      route("warning", message, options, sonnerToast.warning),
    info: (message: ReactNode, options?: ExternalToast) =>
      route("info", message, options, sonnerToast.info),
    message: (message: ReactNode, options?: ExternalToast) =>
      route("info", message, options, sonnerToast.message),
    // No panel analogue — dismiss/promise/loading defer to the real toaster.
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
    promise: sonnerToast.promise.bind(sonnerToast),
    loading: sonnerToast.loading.bind(sonnerToast),
  },
);
