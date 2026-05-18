"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  makeActivityEvent,
  type ActivityEvent,
  type ActivityEventInput,
} from "@/lib/activity/event";
import type { AgentMessage } from "@/lib/import/types";

/**
 * In-memory, app-wide operator activity log. Surfaced in the right-side
 * Activity panel (`shell/ActivityStream`). Any client component or the
 * drained result of any server action can push events via
 * `useActivityStream().emit(...)`.
 *
 * Newest-first. Capped at 100 events (oldest dropped). Not persisted —
 * resets on reload by design. Lives at the (app) layout so events survive
 * route transitions within a session.
 *
 *   // Ad-hoc manual logging from any client component:
 *   const { emit } = useActivityStream();
 *   emit({ actor: "user", type: "debug.custom", severity: "info",
 *          title: "Tested something", payload: someData });
 */

const MAX_EVENTS = 100;

type Ctx = {
  events: ActivityEvent[];
  emit: (e: ActivityEventInput) => void;
  /** Push a batch (e.g. drained from a server action) preserving order. */
  emitMany: (e: ActivityEvent[]) => void;
  clear: () => void;
};

const ActivityStreamCtx = createContext<Ctx | null>(null);

export function ActivityStreamProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const emit = useCallback((input: ActivityEventInput) => {
    const ev = makeActivityEvent(input);
    setEvents((prev) => [ev, ...prev].slice(0, MAX_EVENTS));
  }, []);

  const emitMany = useCallback((batch: ActivityEvent[]) => {
    if (batch.length === 0) return;
    // batch is oldest→newest; prepend reversed so newest ends up on top.
    setEvents((prev) => [...[...batch].reverse(), ...prev].slice(0, MAX_EVENTS));
  }, []);

  const clear = useCallback(() => setEvents([]), []);

  const value = useMemo<Ctx>(
    () => ({ events, emit, emitMany, clear }),
    [events, emit, emitMany, clear],
  );
  return (
    <ActivityStreamCtx.Provider value={value}>
      {children}
    </ActivityStreamCtx.Provider>
  );
}

export function useActivityStream(): Ctx {
  const ctx = useContext(ActivityStreamCtx);
  if (!ctx) {
    throw new Error(
      "useActivityStream must be used inside ActivityStreamProvider",
    );
  }
  return ctx;
}

/**
 * Drain a server action's `__activity` field into the stream. Server code
 * collects events via `withActivity()` and returns them on the result;
 * call this in the client handler that invoked the action.
 */
export function useDrainServerActivity(): (
  result: { __activity?: ActivityEvent[] } | null | undefined,
) => void {
  const { emitMany } = useActivityStream();
  return useCallback(
    (result) => {
      if (result && Array.isArray(result.__activity)) {
        emitMany(result.__activity);
      }
    },
    [emitMany],
  );
}

// ─── Backward-compat adapter for the import wizard ─────────────────────────
// The wizard narrates agent progress via the older AgentMessage shape. It
// is a legitimate second producer; rather than rewrite its three step
// components, map its messages onto the new event model here.

function severityForKind(
  kind: AgentMessage["kind"],
): ActivityEvent["severity"] {
  switch (kind) {
    case "success":
      return "success";
    case "warning":
      return "warn";
    case "error":
      return "error";
    default:
      return "info";
  }
}

export function useAgentLog(): {
  append: (m: AgentMessage) => void;
  clear: () => void;
} {
  const { emit, clear } = useActivityStream();
  const append = useCallback(
    (m: AgentMessage) => {
      emit({
        id: m.id,
        timestamp: new Date(m.timestamp).toISOString(),
        actor: "agent",
        type: `agent.wizard.${m.kind}`,
        severity: severityForKind(m.kind),
        title: m.title,
        payload: m.raw !== undefined ? { body: m.body, raw: m.raw } : { body: m.body },
      });
    },
    [emit],
  );
  return { append, clear };
}
