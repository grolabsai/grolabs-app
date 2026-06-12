"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * UI state for the right-side Assistant panel — collapse state and the
 * user-dragged width. Kept separate from `AgentLogContext` (which holds the
 * message log) so features can push messages without caring about layout,
 * and so the panel's open/width can be driven from anywhere (e.g. auto-open
 * the panel when an error is logged).
 *
 * Both values persist in localStorage so the user's preference survives
 * reloads and route transitions.
 */

const COLLAPSED_KEY = "agent-panel-collapsed";
const WIDTH_KEY = "agent-panel-width";

export const AGENT_PANEL_MIN_WIDTH = 300;
export const AGENT_PANEL_MAX_WIDTH = 720;
export const AGENT_PANEL_DEFAULT_WIDTH = 384;

type Ctx = {
  collapsed: boolean;
  /** True until localStorage has been read — avoids a layout flash. */
  mounted: boolean;
  width: number;
  toggle: () => void;
  /** Force the panel open (e.g. when an error needs to be seen). */
  open: () => void;
  setWidth: (w: number) => void;
};

const AgentPanelCtx = createContext<Ctx | null>(null);

function clampWidth(w: number): number {
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, w));
}

export function AgentPanelProvider({ children }: { children: ReactNode }) {
  // Lazy initializers read localStorage directly. On the server (no window)
  // they fall back to defaults; the panel itself doesn't paint until `mounted`
  // flips, so SSR markup stays stable and there's no hydration mismatch.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });
  const [width, setWidthState] = useState(() => {
    if (typeof window === "undefined") return AGENT_PANEL_DEFAULT_WIDTH;
    try {
      const saved = localStorage.getItem(WIDTH_KEY);
      const n = saved !== null ? Number(saved) : NaN;
      return Number.isFinite(n) ? clampWidth(n) : AGENT_PANEL_DEFAULT_WIDTH;
    } catch {
      return AGENT_PANEL_DEFAULT_WIDTH;
    }
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const persistCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(
    () => persistCollapsed(!collapsed),
    [collapsed, persistCollapsed]
  );
  const open = useCallback(() => persistCollapsed(false), [persistCollapsed]);

  const setWidth = useCallback((w: number) => {
    const clamped = clampWidth(w);
    setWidthState(clamped);
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({ collapsed, mounted, width, toggle, open, setWidth }),
    [collapsed, mounted, width, toggle, open, setWidth]
  );

  return <AgentPanelCtx.Provider value={value}>{children}</AgentPanelCtx.Provider>;
}

export function useAgentPanel(): Ctx {
  const ctx = useContext(AgentPanelCtx);
  if (!ctx) throw new Error("useAgentPanel must be used inside AgentPanelProvider");
  return ctx;
}
