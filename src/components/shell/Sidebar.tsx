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
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { InstanceSwitcher, type InstanceListItem } from "./InstanceSwitcher";
import { buildRreNav, buildAdminNav, type NavItem, type NavGroup } from "./nav";
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
 * The nav config lives in ./nav.ts and is selected by `variant`: the RRE
 * surface (app.grolabs.ai) and the admin surface (admin.grolabs.ai) render
 * the same Sidebar with different nav groups. See rre-admin-split.md §3.4.
 *
 * TODO (follow-up): swap plain next/link for @/i18n/routing Link once all
 * hrefs are migrated to locale-aware navigation.
 */

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
  variant = "rre",
  instanceName: _instanceName,
  instances,
  currentInstanceId,
  isTenantAdmin = false,
}: {
  variant?: "rre" | "admin";
  instanceName: string;
  instances: InstanceListItem[];
  currentInstanceId: number | null;
  // Tenant Admins see the RRE "Equipo" nav item (user-management.md §4).
  isTenantAdmin?: boolean;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  // Root translator (full dotted keys) so the nav builders can reach both the
  // `nav.*` and `configuration.*` namespaces.
  const t = useTranslations();

  const NAV: NavGroup[] =
    variant === "admin" ? buildAdminNav(t) : buildRreNav(t, { isTenantAdmin });

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
            color: "var(--gl-text-tertiary)",
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
            color: "var(--gl-text-tertiary)",
            fontFamily: "var(--gl-font-mono)",
          }}
        >
          {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_DATE}
        </div>
      </div>
    </nav>
  );
}
