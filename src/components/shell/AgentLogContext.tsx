"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { AgentMessage } from "@/lib/import/types";
import { subscribeAgentLog } from "./agent-log-bus";

/**
 * Global, app-wide log of agent activity. Surfaced in the right-side
 * Assistant panel (`shell/AgentPanel`). Any feature can push a message
 * via `useAgentLog().append(...)` — the wizard's Steps 1–3 do exactly
 * that today; future features (sync, dashboards) can do the same.
 *
 * Lives at the (app) layout so the messages persist across route
 * transitions within a session. Cleared explicitly via `clear()`.
 */

type Ctx = {
  messages: AgentMessage[];
  append: (m: AgentMessage) => void;
  clear: () => void;
};

const AgentLogCtx = createContext<Ctx | null>(null);

export function AgentLogProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  const append = useCallback((m: AgentMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);
  const clear = useCallback(() => setMessages([]), []);

  // Bridge imperative toast.*() calls (routed through the agent-log bus) into
  // the panel. One subscription per mounted provider; the seq ref keeps ids
  // unique without leaning on Math.random.
  const seq = useRef(0);
  useEffect(() => {
    return subscribeAgentLog((m) => {
      seq.current += 1;
      append({
        id: `toast-${Date.now()}-${seq.current}`,
        timestamp: Date.now(),
        kind: m.kind,
        title: m.title,
        body: m.body ?? "",
        raw: m.raw,
      });
    });
  }, [append]);

  const value = useMemo<Ctx>(() => ({ messages, append, clear }), [messages, append, clear]);
  return <AgentLogCtx.Provider value={value}>{children}</AgentLogCtx.Provider>;
}

export function useAgentLog(): Ctx {
  const ctx = useContext(AgentLogCtx);
  if (!ctx) throw new Error("useAgentLog must be used inside AgentLogProvider");
  return ctx;
}
