"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Sub-navigation tabs that sit under the Pricing module header.
 * Mirrors the design's `.nav-tabs` strip; active state is computed from the
 * current pathname so deep links highlight the right tab.
 */
export function PricingTabs() {
  const t = useTranslations("pricing.tabs");
  const pathname = usePathname();

  const tabs: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
    { href: "/pricing", label: t("overview"), exact: true },
    { href: "/pricing/policies", label: t("policies") },
    { href: "/pricing/providers", label: t("providers") },
    { href: "/pricing/changes", label: t("changes") },
    { href: "/pricing/violations", label: t("violations") },
    { href: "/pricing/sync", label: t("sync") },
  ];

  return (
    <nav
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--s-border)",
        marginBottom: 32,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn("pricing-tab", isActive && "active")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
