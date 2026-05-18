/**
 * Activity Stream — the single event shape shared by server and client.
 *
 * This module is import-safe from both the server (collector) and the
 * client (React context). It must not pull in any server- or client-only
 * APIs. `crypto.randomUUID` exists in both Node 18+ and the browser.
 *
 * Activity events are in-memory only. They are never persisted; the
 * client buffer resets on page reload by design.
 */

export type ActivityActor = "user" | "system" | "agent";
export type ActivitySeverity = "info" | "warn" | "error" | "success";

export type ActivityEvent = {
  /** Client-/server-generated UUID. Stable for React keys. */
  id: string;
  /** ISO-8601 datetime the event was created. */
  timestamp: string;
  actor: ActivityActor;
  /** Free-form slug, e.g. `sync.meilisearch.started`, `error.uncaught`. */
  type: string;
  severity: ActivitySeverity;
  /** Short, human-readable one-liner. */
  title: string;
  /** Full structured payload — request/response/error/etc. Anything. */
  payload?: unknown;
};

/** Fields a caller supplies; id + timestamp are filled in if absent. */
export type ActivityEventInput = Omit<ActivityEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export function makeActivityEvent(input: ActivityEventInput): ActivityEvent {
  return {
    id: input.id ?? crypto.randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    actor: input.actor,
    type: input.type,
    severity: input.severity,
    title: input.title,
    payload: input.payload,
  };
}

/** Result wrapper: any server-action return value can carry drained events. */
export type WithActivity<T> = T & { __activity?: ActivityEvent[] };
