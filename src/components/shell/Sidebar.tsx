"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Route } from "next";
import {
  Package,
  LayoutList,
  LayoutDashboard,
  SlidersHorizontal,
  Building2,
  Shapes,
  Tag,
  GitMerge,
  PawPrint,
  Rabbit,
  UserRound,
  Settings,
  Search,
  Download,
  Palette,
  Workflow,
  RefreshCw,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * Scout sidebar navigation.
 *
 * Rebuilt on shadcn conventions (cn(), lucide-react icons, no inline SVGs).
 * Visual layout is identical to the previous version — same sections, same
 * sizes, same active/disabled states.
 *
 * Icons use lucide-react stroke style. Sizes match the original 14×14 SVGs.
 *
 * TODO (follow-up): swap plain next/link for @/i18n/routing Link once all
 * hrefs are migrated to locale-aware navigation.
 */

type NavItem = {
  href: Route | null; // null = not yet implemented
  label: string;
  icon: LucideIcon;
  // When true, render through the shared <Icon> wrapper. New entries opt in;
  // legacy entries stay raw until the whole-file migration ships.
  useIconWrapper?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

export function Sidebar({
  instanceName,
  typesenseConfigured = false,
}: {
  instanceName: string;
  /** When true, the Typesense nav item appears under Configuration. */
  typesenseConfigured?: boolean;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const t = useTranslations("configuration.algolia");
  const tTypesense = useTranslations("configuration.typesense");

  const NAV: NavGroup[] = [
    {
      title: tNav("dashboard"),
      items: [
        { href: "/dashboard" as Route, label: tNav("dashboard"), icon: LayoutDashboard },
      ],
    },
    {
      title: tNav("conversion"),
      items: [
        { href: "/funnel" as Route, label: tNav("funnel"), icon: Workflow, useIconWrapper: true },
      ],
    },
    {
      title: tNav("catalog"),
      items: [
        { href: "/catalog/products", label: tNav("products"), icon: Package },
        { href: "/catalog/categories" as Route, label: tNav("categories"), icon: LayoutList },
        { href: "/catalog/attributes" as Route, label: tNav("attributes"), icon: SlidersHorizontal },
        { href: null, label: tNav("brands"), icon: Building2 },
        { href: null, label: tNav("productTypes"), icon: Shapes },
        { href: null, label: tNav("tags"), icon: Tag },
        { href: null, label: tNav("matchingRules"), icon: GitMerge },
      ],
    },
    {
      title: tNav("data"),
      items: [
        { href: "/import" as Route, label: tNav("import"), icon: Download },
        { href: "/sync" as Route, label: tNav("sync"), icon: RefreshCw },
      ],
    },
    {
      title: tNav("references"),
      items: [
        { href: null, label: tNav("species"), icon: PawPrint },
        { href: null, label: tNav("breeds"), icon: Rabbit },
        { href: null, label: tNav("profileAttributes"), icon: UserRound },
      ],
    },
    {
      title: tNav("system"),
      items: [
        { href: "/styleguide" as Route, label: tNav("styleguide"), icon: Palette },
      ],
    },
    {
      title: tNav("configuration"),
      items: [
        { href: "/configuration/algolia" as Route, label: t("navLabel"), icon: Search },
        ...(typesenseConfigured
          ? [{ href: "/configuration/typesense" as Route, label: tTypesense("navLabel"), icon: Search }]
          : []),
        { href: "/configuration/woocommerce" as Route, label: tNav("woocommerce"), icon: ShoppingBag },
        { href: null, label: tNav("storeSettings"), icon: Settings },
      ],
    },
  ];

  return (
    <nav className="s-nav">
      {/* Brand mark */}
      <div className="s-brand">
        <div className="s-brand-mark" />
        <span className="s-brand-name">Scout</span>
      </div>

      {/* Nav groups */}
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="s-nav-section">{group.title}</p>

          {group.items.map((item) => {
            const ItemIcon = item.icon;
            const isActive = item.href
              ? pathname === item.href ||
                pathname.startsWith(item.href + "/")
              : false;

            // New entries route through the shared <Icon> wrapper; legacy
            // entries render the lucide component directly until the
            // whole-sidebar migration lands. Visual output matches.
            const iconNode = item.useIconWrapper ? (
              <Icon
                icon={ItemIcon}
                className="s-nav-icon"
                size={14}
                strokeWidth={1.5}
              />
            ) : (
              <ItemIcon
                className="s-nav-icon"
                size={14}
                strokeWidth={1.5}
              />
            );

            if (!item.href) {
              return (
                <div
                  key={item.label}
                  className="s-nav-item"
                  style={{ opacity: 0.45, cursor: "not-allowed" }}
                  title={tNav("comingSoon")}
                >
                  {iconNode}
                  {item.label}
                  <span className="s-nav-badge">···</span>
                </div>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn("s-nav-item", isActive && "active")}
              >
                {iconNode}
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}

      {/* Instance badge */}
      <div style={{ marginTop: 24, padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 4,
          }}
        >
          {tNav("instance")}
        </div>
        <div style={{ fontSize: 13, color: "var(--s-text)" }}>{instanceName}</div>
      </div>

      {/* Version */}
      <div style={{ padding: "4px 10px 8px" }}>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 2,
          }}
        >
          {tNav("version")}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            fontFamily: "var(--s-font-mono)",
          }}
        >
          {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_DATE}
        </div>
      </div>
    </nav>
  );
}
