/**
 * Tiny framework-agnostic pub/sub bridging imperative `toast.*()` calls to the
 * right-side Assistant panel.
 *
 * Why a module-level bus instead of calling `useAgentLog().append()` directly:
 * toasts are fired from event handlers and `.then()` callbacks — imperative
 * code that can't call React hooks. The `toast` shim (`ui/agent-toast`) emits
 * here; `AgentLogProvider` subscribes once on mount and appends to its state.
 *
 * Buffer-and-flush: a message emitted before any panel has subscribed (e.g. a
 * page's mount effect runs before the ancestor provider's subscribe effect, or
 * a toast fires mid-navigation) is held briefly. If a subscriber attaches in
 * the same tick it drains the buffer into the panel; if none does (a truly
 * panel-less surface like the public blog), the per-message `fallback` fires so
 * the message is still seen as a real toast.
 */

export type AgentBusKind = "info" | "thinking" | "success" | "warning" | "error";

export interface AgentBusMessage {
  kind: AgentBusKind;
  title: string;
  body?: string;
  raw?: unknown;
}

type Subscriber = (m: AgentBusMessage) => void;

interface Pending {
  msg: AgentBusMessage;
  fallback?: () => void;
}

const subscribers = new Set<Subscriber>();
let buffer: Pending[] = [];

export function subscribeAgentLog(fn: Subscriber): () => void {
  subscribers.add(fn);
  // Drain anything emitted before this subscriber existed.
  if (buffer.length > 0) {
    const pending = buffer;
    buffer = [];
    for (const p of pending) fn(p.msg);
  }
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Dispatch a message to the panel. If nothing is listening yet, hold it for a
 * tick; should no subscriber appear, run `fallback` (a real toast).
 */
export function emitAgentLog(m: AgentBusMessage, fallback?: () => void): void {
  if (subscribers.size > 0) {
    for (const fn of subscribers) fn(m);
    return;
  }
  const entry: Pending = { msg: m, fallback };
  buffer.push(entry);
  setTimeout(() => {
    const i = buffer.indexOf(entry);
    if (i !== -1) {
      buffer.splice(i, 1);
      entry.fallback?.();
    }
  }, 0);
}
