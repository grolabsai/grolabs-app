"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import type { Route } from "next";
import { cn } from "@/lib/utils";

const TABS: { key: "traffic" | "search"; href: Route }[] = [
  { key: "traffic", href: "/dashboard/traffic" as Route },
  { key: "search", href: "/dashboard/search" as Route },
];

/**
 * Route-based dashboard tabs (Traffic / Search). Route-driven rather than
 * client-state so each panel keeps its own URL state (the Search panel uses
 * ?window / ?offset for the no-results table).
 */
export function DashboardTabs() {
  const t = useTranslations("dashboard.tabs");
  const pathname = usePathname();

  return (
    <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
              active
                ? "bg-background text-foreground shadow"
                : "hover:text-foreground",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </div>
  );
}
