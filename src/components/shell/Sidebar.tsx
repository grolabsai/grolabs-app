"use client";

import Link from "next/link";
// Locale-aware: strips the `/en` prefix from the pathname so NAV hrefs
// like `/dashboard` match correctly when the user is on `/en/dashboard`.
// The raw `next/navigation` usePathname returns the prefixed string and
// breaks every active-state match on non-default locales.
import { usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import type { Route } from "next";
import { useCallback, useSyncExternalStore } from "react";
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
  Telescope,
  Download,
  Palette,
  Workflow,
  RefreshCw,
  ShoppingBag,
  CircleDollarSign,
  ClipboardList,
  ShieldCheck,
  Receipt,
  Truck,
  LineChart,
  GitBranch,
  Layers,
  DollarSign,
  Database,
  Library,
  Wrench,
  FileText,
  Stethoscope,
  ListChecks,
  Gauge,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { InstanceSwitcher, type InstanceListItem } from "./InstanceSwitcher";
import { cn } from "@/lib/utils";

const SECTION_STATE_KEY = "grolabs.sidebar.sections";

/**
 * Per-tab persistence for manual section expand/collapse, backed by
 * sessionStorage and exposed through useSyncExternalStore so SSR and the
 * post-hydration client snapshot reconcile without a mismatch warning.
 */
type SectionState = Record<string, boolean>;

const sectionListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: SectionState = {};
const SERVER_SECTION_STATE: SectionState = {};

function readSectionState(): SectionState {
  try {
    const raw = sessionStorage.getItem(SECTION_STATE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = raw ? (JSON.parse(raw) as SectionState) : {};
    }
  } catch {
    cachedValue = {};
  }
  return cachedValue;
}

function subscribeSectionState(cb: () => void) {
  sectionListeners.add(cb);
  return () => {
    sectionListeners.delete(cb);
  };
}

function writeSectionState(next: SectionState) {
  try {
    sessionStorage.setItem(SECTION_STATE_KEY, JSON.stringify(next));
  } catch {
    /* ignore persistence failures (private mode, quota) */
  }
  cachedRaw = null; // force the next snapshot to re-read
  sectionListeners.forEach((l) => l());
}

/**
 * GroLabs sidebar navigation.
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
  // Stable, locale-independent key used for active detection and persistence.
  key: string;
  title: string;
  // Section header icon. Omitted for the flat Dashboard group.
  icon?: LucideIcon;
  // Flat groups (Dashboard) render as a single link with no collapse behavior.
  flat?: boolean;
  items: NavItem[];
};

function itemMatchesPath(href: Route | string | null, pathname: string): boolean {
  if (!href) return false;
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Pick the single active NAV item across all groups: the longest matching
 * href wins. Without this, a parent like `/prospects` and a child like
 * `/prospects/rubric` both light up when you're on `/prospects/rubric` —
 * the parent's prefix match collides with the child's exact match.
 */
function computeActiveHref(
  groups: { items: { href: Route | string | null }[] }[],
  pathname: string,
): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const href = item.href;
      if (!href) continue;
      if (!itemMatchesPath(href, pathname)) continue;
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

export function Sidebar({
  instanceName: _instanceName,
  instances,
  currentInstanceId,
}: {
  instanceName: string;
  instances: InstanceListItem[];
  currentInstanceId: number | null;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const t = useTranslations("configuration.algolia");
  const tSearch = useTranslations("configuration.search");
  const tGa4 = useTranslations("configuration.ga4");

  const NAV: NavGroup[] = [
    {
      key: "dashboard",
      title: tNav("dashboard"),
      flat: true,
      items: [
        { href: "/dashboard" as Route, label: tNav("dashboard"), icon: LayoutDashboard },
      ],
    },
    {
      key: "conversion",
      title: tNav("conversion"),
      icon: GitBranch,
      items: [
        { href: "/funnel" as Route, label: tNav("funnel"), icon: Workflow, useIconWrapper: true },
      ],
    },
    {
      key: "catalog",
      title: tNav("catalog"),
      icon: Layers,
      items: [
        { href: "/catalog/products", label: tNav("products"), icon: Package },
        { href: "/catalog/categories" as Route, label: tNav("categories"), icon: LayoutList },
        { href: "/catalog/attributes" as Route, label: tNav("attributes"), icon: SlidersHorizontal },
        { href: "/catalog/brands" as Route, label: tNav("brands"), icon: Building2 },
        { href: null, label: tNav("productTypes"), icon: Shapes },
        { href: null, label: tNav("tags"), icon: Tag },
        { href: null, label: tNav("matchingRules"), icon: GitMerge },
      ],
    },
    {
      key: "pricing",
      title: tNav("pricing"),
      icon: DollarSign,
      items: [
        { href: "/pricing" as Route, label: tNav("pricingOverview"), icon: CircleDollarSign, useIconWrapper: true },
        { href: "/pricing/policies" as Route, label: tNav("pricingPolicies"), icon: ShieldCheck, useIconWrapper: true },
        { href: "/pricing/providers" as Route, label: tNav("pricingProviders"), icon: Truck, useIconWrapper: true },
        { href: "/pricing/changes" as Route, label: tNav("pricingChanges"), icon: ClipboardList, useIconWrapper: true },
        { href: "/pricing/violations" as Route, label: tNav("pricingViolations"), icon: Receipt, useIconWrapper: true },
        { href: "/pricing/sync" as Route, label: tNav("pricingSync"), icon: RefreshCw, useIconWrapper: true },
      ],
    },
    {
      key: "data",
      title: tNav("data"),
      icon: Database,
      items: [
        { href: "/import" as Route, label: tNav("import"), icon: Download },
        { href: "/sync" as Route, label: tNav("sync"), icon: RefreshCw },
      ],
    },
    {
      key: "content",
      title: tNav("content"),
      icon: FileText,
      items: [
        { href: "/content/posts" as Route, label: tNav("blog"), icon: FileText },
      ],
    },
    {
      key: "prospects",
      title: tNav("prospects"),
      icon: Stethoscope,
      items: [
        { href: "/prospects" as Route, label: tNav("prospectsList"), icon: Stethoscope, useIconWrapper: true },
        { href: "/prospects/rubric" as Route, label: tNav("prospectsRubric"), icon: ListChecks, useIconWrapper: true },
        { href: "/prospects/benchmarks" as Route, label: tNav("prospectsBenchmarks"), icon: Gauge, useIconWrapper: true },
      ],
    },
    {
      key: "references",
      title: tNav("references"),
      icon: Library,
      items: [
        { href: null, label: tNav("species"), icon: PawPrint },
        { href: null, label: tNav("breeds"), icon: Rabbit },
        { href: null, label: tNav("profileAttributes"), icon: UserRound },
      ],
    },
    {
      key: "system",
      title: tNav("system"),
      icon: Settings,
      items: [
        { href: "/styleguide" as Route, label: tNav("styleguide"), icon: Palette },
      ],
    },
    {
      key: "configuration",
      title: tNav("configuration"),
      icon: Wrench,
      items: [
        { href: "/configuration/search" as Route, label: tSearch("navLabel"), icon: Telescope, useIconWrapper: true },
        { href: "/configuration/algolia" as Route, label: t("navLabel"), icon: Search },
        { href: "/configuration/woocommerce" as Route, label: tNav("woocommerce"), icon: ShoppingBag },
        { href: "/configuration/ga4" as Route, label: tGa4("navLabel"), icon: LineChart, useIconWrapper: true },
        { href: null, label: tNav("storeSettings"), icon: Settings },
      ],
    },
  ];

  // Single active href across all NAV. Longest matching href wins so
  // parent rows (e.g. /prospects) don't light up alongside their
  // children (/prospects/rubric).
  const activeHref = computeActiveHref(NAV, pathname);

  // Which collapsible group owns the active item — used for the default
  // expanded state.
  const activeGroupKey =
    NAV.find((g) => !g.flat && g.items.some((it) => it.href === activeHref))
      ?.key ?? null;

  // Manual expand/collapse choices, persisted per browser tab. The server
  // snapshot is empty so SSR always uses route-derived defaults; the client
  // swaps in stored preferences after hydration without a mismatch.
  const openSections = useSyncExternalStore(
    subscribeSectionState,
    readSectionState,
    () => SERVER_SECTION_STATE,
  );

  const setSection = useCallback((key: string, open: boolean) => {
    writeSectionState({ ...readSectionState(), [key]: open });
  }, []);

  function renderItem(item: NavItem) {
    const ItemIcon = item.icon;
    const isActive = item.href !== null && item.href === activeHref;

    // Active items force the icon stroke yellow via the `color` prop
    // on Lucide. Lucide renders `<svg stroke={color}>`, so passing the
    // hex directly here bypasses every CSS cascade quirk that bit us
    // earlier — no !important wars, no Tailwind utility leakage, no
    // hydration races. Inactive items inherit currentColor (white)
    // from the parent .s-nav-item.
    const iconColor = isActive ? "#fae194" : undefined;
    const iconNode = item.useIconWrapper ? (
      <Icon
        icon={ItemIcon}
        className="s-nav-icon"
        size={14}
        strokeWidth={1.5}
        color={iconColor}
      />
    ) : (
      <ItemIcon
        className="s-nav-icon"
        size={14}
        strokeWidth={1.5}
        color={iconColor}
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
  }

  return (
    <nav className="s-nav">
      {/* Brand mark */}
      <div className="s-brand">
        <div className="s-brand-mark" />
        <div className="s-brand-stack">
          <span className="s-brand-name">GroLabs</span>
          <span className="s-brand-tagline">Recover lost revenue</span>
        </div>
      </div>

      {/* Instance switcher — moved here from the topbar so it sits as the
          first interactive element below the logo. Truncates the
          instance name when the sidebar can't fit it. */}
      <div className="s-sidebar-instance">
        <InstanceSwitcher
          instances={instances}
          currentInstanceId={currentInstanceId}
        />
      </div>

      {/* Nav groups */}
      {NAV.map((group) => {
        // Flat group (Dashboard): a single link, no header, no collapse.
        if (group.flat) {
          return (
            <div key={group.key} className="s-nav-flat-group">
              {group.items.map(renderItem)}
            </div>
          );
        }

        const GroupIcon = group.icon;
        const stored = openSections[group.key];
        // User's explicit choice wins; otherwise the section owning the
        // active route is expanded and all others collapsed.
        const isOpen =
          stored !== undefined ? stored : group.key === activeGroupKey;

        return (
          <Collapsible
            key={group.key}
            open={isOpen}
            onOpenChange={(o) => setSection(group.key, o)}
            className="s-nav-group"
          >
            <CollapsibleTrigger className="s-nav-section-trigger">
              {GroupIcon && (
                <Icon
                  icon={GroupIcon}
                  className="s-nav-icon"
                  size={14}
                  strokeWidth={1.5}
                />
              )}
              <span className="s-nav-section-label">{group.title}</span>
              <Icon
                icon={isOpen ? ChevronDown : ChevronRight}
                className="s-nav-chevron"
                size={14}
                strokeWidth={1.5}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="s-nav-collapsible">
              <div className="s-nav-collapsible-inner">
                {group.items.map(renderItem)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Version */}
      <div style={{ marginTop: "auto", padding: "12px 10px 8px" }}>
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
