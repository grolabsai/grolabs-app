"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DASHBOARD_RANGES,
  type DashboardRange,
} from "@/lib/integrations/ga4/range";
import { cn } from "@/lib/utils";

/**
 * Pill selector with Hoy / Ayer / 7 días / 30 días.
 * Updates the URL's `?range=` param so the selection is shareable.
 */
export function TimeRangeSelector({
  current,
}: {
  current: DashboardRange;
}) {
  const t = useTranslations("dashboard.timeRange");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(r: DashboardRange) {
    const next = new URLSearchParams(params.toString());
    next.set("range", r);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
        padding: 4,
      }}
    >
      {DASHBOARD_RANGES.map((r) => {
        const isActive = r === current;
        return (
          <button
            key={r}
            type="button"
            onClick={() => go(r)}
            className={cn("transition-colors")}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 500,
              border: "none",
              borderRadius: "var(--s-radius-sm)",
              background: isActive ? "var(--scout-accent)" : "transparent",
              color: isActive ? "white" : "var(--s-text-secondary)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t(r)}
          </button>
        );
      })}
    </div>
  );
}
