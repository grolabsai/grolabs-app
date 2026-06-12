"use client";

import { useState, useTransition } from "react";
import { acknowledgeAlert } from "@/app/[locale]/(app)/dashboard/traffic/actions";

export interface InboxItem {
  id: number;
  title: string;
  sub: string;
  acknowledged: boolean;
}

/**
 * Active-alert inbox with an Acknowledge action per row. All display strings
 * are pre-formatted server-side and passed in, so this stays i18n-clean.
 */
export function AlertInbox({
  items,
  ackLabel,
  ackedLabel,
}: {
  items: InboxItem[];
  ackLabel: string;
  ackedLabel: string;
}) {
  const [acked, setAcked] = useState<Set<number>>(
    () => new Set(items.filter((i) => i.acknowledged).map((i) => i.id)),
  );
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function ack(id: number) {
    setPendingId(id);
    startTransition(async () => {
      const res = await acknowledgeAlert(id);
      if (res.ok) {
        setAcked((prev) => new Set(prev).add(id));
      }
      setPendingId(null);
    });
  }

  return (
    <>
      {items.map((item) => {
        const done = acked.has(item.id);
        return (
          <div className="inbox-row" key={item.id}>
            <div className="inbox-main">
              <span className="inbox-title">{item.title}</span>
              <span className="inbox-sub">{item.sub}</span>
            </div>
            <button
              className="inbox-btn"
              disabled={done || pendingId === item.id}
              onClick={() => ack(item.id)}
            >
              {done ? ackedLabel : ackLabel}
            </button>
          </div>
        );
      })}
    </>
  );
}
