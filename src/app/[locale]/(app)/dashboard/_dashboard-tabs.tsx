"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import type { Route } from "next";
import { LayoutDashboard, Activity, Search, ShoppingCart, Gauge, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const TABS: { key: "signals" | "overview" | "carts" | "traffic" | "search"; href: Route; icon: LucideIcon }[] = [
  { key: "signals", href: "/dashboard/signals" as Route, icon: Gauge },
  { key: "overview", href: "/dashboard/overview" as Route, icon: LayoutDashboard },
  { key: "carts", href: "/dashboard/carts" as Route, icon: ShoppingCart },
  { key: "traffic", href: "/dashboard/traffic" as Route, icon: Activity },
  { key: "search", href: "/dashboard/search" as Route, icon: Search },
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
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
              active
                ? "bg-background text-foreground shadow"
                : "hover:text-foreground",
            )}
          >
            {/* Same treatment as the left nav: active → yellow icon, inactive →
                icon inherits the font color (currentColor). */}
            <Icon
              icon={tab.icon}
              size={14}
              color={active ? "#fae194" : undefined}
            />
            {t(tab.key)}
          </Link>
        );
      })}
    </div>
  );
}
