import type { AgentMessage } from "@/lib/import/types";

/**
 * Build an AgentMessage with a fresh id + timestamp. Steps call this and
 * dispatch the result via `APPEND_AGENT_MESSAGE` to log into the right-side
 * panel. Keeping the helper here (not in the component) means server-side
 * code can build messages too if it ever needs to.
 */
export function makeAgentMessage(input: {
  kind: AgentMessage["kind"];
  title: string;
  body: string;
  raw?: unknown;
}): AgentMessage {
  return {
    id: `am-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    kind: input.kind,
    title: input.title,
    body: input.body,
    raw: input.raw,
  };
}
