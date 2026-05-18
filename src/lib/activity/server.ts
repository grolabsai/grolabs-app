/**
 * Server-side activity collector.
 *
 * The Activity Stream lives in client memory with no backend. The only
 * transport from server code to the client is a server action's return
 * value. So: any server code (sync actions, the GLPIM client, the search
 * indexer) emits into a request-scoped buffer via `recordActivity()`. The
 * outermost server action wraps its body in `withActivity()`, which drains
 * the buffer and attaches the events to its returned object under
 * `__activity`. The client caller then feeds those into the React context.
 *
 * `recordActivity()` is a safe no-op when called outside a `withActivity`
 * scope — deep helpers can call it unconditionally without caring whether
 * the current entrypoint chose to collect.
 *
 * This is observability only: it never changes the wrapped value or
 * throws. If the wrapped function throws, the error propagates unchanged
 * (collected events for that call are dropped — acceptable, see report).
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  makeActivityEvent,
  type ActivityEvent,
  type ActivityEventInput,
  type WithActivity,
} from "@/lib/activity/event";

const storage = new AsyncLocalStorage<ActivityEvent[]>();

/** Emit an event into the ambient collector. No-op if none is active. */
export function recordActivity(input: ActivityEventInput): void {
  const buffer = storage.getStore();
  if (!buffer) return;
  buffer.push(makeActivityEvent(input));
}

/**
 * Run `fn` inside a fresh collector scope and attach the drained events to
 * its (object) result as `__activity`. Non-object results pass through
 * untouched.
 */
export async function withActivity<T>(
  fn: () => Promise<T>,
): Promise<WithActivity<T>> {
  const buffer: ActivityEvent[] = [];
  const result = await storage.run(buffer, fn);
  if (result !== null && typeof result === "object") {
    return { ...(result as object), __activity: buffer } as WithActivity<T>;
  }
  return result as WithActivity<T>;
}
