"use client";

import { useEffect } from "react";
import { useAgentLog } from "@/components/shell/AgentLogContext";
import { subscribeMissingTranslations } from "@/lib/i18n/missing-translation";

/**
 * Bridges the missing-translation collector into the Activity Stream
 * panel. Mounted inside `AgentLogProvider` (see `(app)/layout.tsx`) so
 * every authenticated screen gets coverage; the brief moment between
 * locale layout mount and (app) layout mount is intentionally not
 * covered — pre-auth screens (login) are tightly scoped and unlikely
 * to drift.
 *
 * Renders nothing. Subscribes once on mount, unsubscribes on unmount.
 * Notifications arrive in a microtask after the offending render, so
 * calling `append` here is safe (no setState-during-render warning).
 */
export function MissingTranslationListener() {
  const { append } = useAgentLog();

  useEffect(() => {
    return subscribeMissingTranslations((event) => {
      const fullKey = event.namespace
        ? `${event.namespace}.${event.key}`
        : event.key;
      append({
        id: `i18n-missing-${event.locale}-${fullKey}`,
        timestamp: Date.now(),
        kind: "warning",
        title: `Missing ${event.locale} translation`,
        body: `Key "${fullKey}" has no value in messages/${event.locale}.json. The screen rendered with a placeholder; add the key to fix.`,
        raw: { source: "i18n", ...event, file: `messages/${event.locale}.json` },
      });
    });
  }, [append]);

  return null;
}
