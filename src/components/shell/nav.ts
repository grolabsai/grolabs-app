import type { Route } from "next";
import {
  DEFAULT_SERVICES,
  type InstanceServices,
} from "@/lib/instance-services";
import {
  Package,
  LayoutList,
  LayoutDashboard,
  SlidersHorizontal,
  IdCard,
  Building2,
  Shapes,
  Tag,
  GitMerge,
  UserRound,
  Settings,
  Search,
  Telescope,
  Download,
  Palette,
  RefreshCw,
  ShoppingBag,
  CircleDollarSign,
  ClipboardList,
  ShieldCheck,
  Receipt,
  Truck,
  LineChart,
  Layers,
  DollarSign,
  Database,
  Wrench,
  Activity,
  ScrollText,
  FileText,
  Users,
  Building,
  PlugZap,
  type LucideIcon,
} from "lucide-react";

/**
 * Sidebar navigation config, extracted from Sidebar.tsx so the same Sidebar
 * component renders either the RRE nav (app.grolabs.ai) or the admin nav
 * (admin.grolabs.ai) from a passed config. See docs/policy/rre-admin-split.md
 * §3.4 / §6. The builders take a next-intl translator (full dotted keys) so
 * the (client) Sidebar resolves labels — icon components stay client-side and
 * never cross the server→client prop boundary.
 */

export type NavItem = {
  href: Route | null; // null = not yet implemented
  label: string;
  icon: LucideIcon;
  // When true, render through the shared <Icon> wrapper. New entries opt in;
  // legacy entries stay raw until the whole-file migration ships.
  useIconWrapper?: boolean;
};

export type NavGroup = {
  // Stable, locale-independent key used for active detection and persistence.
  key: string;
  title: string;
  // Section header icon. Omitted for the flat Dashboard group.
  icon?: LucideIcon;
  // Flat groups (Dashboard) render as a single link with no collapse behavior.
  flat?: boolean;
  items: NavItem[];
};

// next-intl translator with no bound namespace — pass full dotted keys.
type T = (key: string) => string;

export type { InstanceServices };

/**
 * RRE nav (app.grolabs.ai). The user-facing app surface. Excludes the moved
 * admin sections (Contenido, Prospectos) and the Sistema → Estilo style-guide
 * link — those live in the admin nav only.
 */
export function buildRreNav(
  t: T,
  opts?: { isTenantAdmin?: boolean; services?: InstanceServices },
): NavGroup[] {
  // The instance's service model decides what belongs in this nav. Defaults are
  // all-on, so a failed lookup shows the full menu rather than silently
  // collapsing it — see DEFAULT_SERVICES.
  const svc = opts?.services ?? DEFAULT_SERVICES;

  const configurationItems: NavItem[] = [
    { href: "/configuration/properties" as Route, label: t("configuration.properties.navLabel"), icon: IdCard, useIconWrapper: true },
    // Get Connected sits here, directly after Properties: it is the setup
    // guide for what Properties declares, so the two belong together.
    { href: "/get-connected" as Route, label: t("nav.getConnected"), icon: PlugZap, useIconWrapper: true },
    { href: "/configuration/analysis" as Route, label: t("configuration.analysis.navLabel"), icon: SlidersHorizontal, useIconWrapper: true },
  ];

  // ── Search — ONE item whose destination depends on the provider ───────────
  // Algolia and Meilisearch are two standing connection modes, not a
  // migration, so the user sees a single "Search" entry that opens whichever
  // screen matches this instance. Both pages guard against being reached
  // directly for the wrong provider.
  if (svc.search) {
    configurationItems.push(
      svc.searchProvider === "algolia"
        ? { href: "/configuration/algolia" as Route, label: t("configuration.search.navLabel"), icon: Search }
        : { href: "/configuration/search" as Route, label: t("configuration.search.navLabel"), icon: Telescope, useIconWrapper: true },
    );
  }

  // ── Platform-specific configuration ──────────────────────────────────────
  // WooCommerce is the only platform with a configuration screen in this app
  // today; Shopify and Medusa integrations live in their own repos. As those
  // gain screens, they slot in here on the same condition.
  if (svc.storePlatform === "woocommerce") {
    configurationItems.push({
      href: "/configuration/woocommerce" as Route,
      label: t("nav.woocommerce"),
      icon: ShoppingBag,
    });
  }

  if (svc.analytics) {
    configurationItems.push({
      href: "/configuration/ga4" as Route,
      label: t("configuration.ga4.navLabel"),
      icon: LineChart,
      useIconWrapper: true,
    });
  }

  configurationItems.push(
    { href: "/configuration/system-health" as Route, label: t("configuration.systemHealth.navLabel"), icon: Activity, useIconWrapper: true },
    { href: "/configuration/events" as Route, label: t("configuration.events.navLabel"), icon: ScrollText, useIconWrapper: true },
    { href: null, label: t("nav.storeSettings"), icon: Settings },
  );

  // The "Equipo" (team management) item is visible only to Tenant Admins —
  // the screen itself re-checks is_tenant_admin server-side. Per
  // docs/policy/user-management.md §4.
  if (opts?.isTenantAdmin) {
    configurationItems.push({
      href: "/configuration/equipo" as Route,
      label: t("nav.team"),
      icon: Users,
      useIconWrapper: true,
    });
  }

  const groups: (NavGroup | null)[] = [
    {
      key: "dashboard",
      title: t("nav.dashboard"),
      flat: true,
      items: [
        { href: "/dashboard" as Route, label: t("nav.dashboard"), icon: LayoutDashboard },
      ],
    },
    // Get Connected used to be a top-level group; it now lives inside
    // Configuration, directly after Properties.
    // Conversion (funnel) hidden per request 2026-06-12 — restore this block
    // when the funnel surface is ready to show.
    // {
    //   key: "conversion",
    //   title: t("nav.conversion"),
    //   icon: GitBranch,
    //   items: [
    //     { href: "/funnel" as Route, label: t("nav.funnel"), icon: Workflow, useIconWrapper: true },
    //   ],
    // },
    !svc.catalog ? null : {
      key: "catalog",
      title: t("nav.catalog"),
      icon: Layers,
      items: [
        { href: "/catalog/products", label: t("nav.products"), icon: Package },
        { href: "/catalog/categories" as Route, label: t("nav.categories"), icon: LayoutList },
        { href: "/catalog/attributes" as Route, label: t("nav.attributes"), icon: SlidersHorizontal },
        { href: "/catalog/brands" as Route, label: t("nav.brands"), icon: Building2 },
        { href: null, label: t("nav.productTypes"), icon: Shapes },
        { href: null, label: t("nav.tags"), icon: Tag },
        { href: null, label: t("nav.matchingRules"), icon: GitMerge },
      ],
    },
    !svc.pricing ? null : {
      key: "pricing",
      title: t("nav.pricing"),
      icon: DollarSign,
      items: [
        { href: "/pricing" as Route, label: t("nav.pricingOverview"), icon: CircleDollarSign, useIconWrapper: true },
        { href: "/pricing/policies" as Route, label: t("nav.pricingPolicies"), icon: ShieldCheck, useIconWrapper: true },
        { href: "/pricing/providers" as Route, label: t("nav.pricingProviders"), icon: Truck, useIconWrapper: true },
        { href: "/pricing/changes" as Route, label: t("nav.pricingChanges"), icon: ClipboardList, useIconWrapper: true },
        { href: "/pricing/violations" as Route, label: t("nav.pricingViolations"), icon: Receipt, useIconWrapper: true },
        { href: "/pricing/sync" as Route, label: t("nav.pricingSync"), icon: RefreshCw, useIconWrapper: true },
      ],
    },
    {
      key: "data",
      title: t("nav.data"),
      icon: Database,
      items: [
        { href: "/import" as Route, label: t("nav.import"), icon: Download },
        { href: "/sync" as Route, label: t("nav.sync"), icon: RefreshCw },
      ],
    },
    // References hidden per request 2026-06-12 — restore this block when the
    // references surface (species / breeds / profile attributes) is ready.
    // {
    //   key: "references",
    //   title: t("nav.references"),
    //   icon: Library,
    //   items: [
    //     { href: null, label: t("nav.species"), icon: PawPrint },
    //     { href: null, label: t("nav.breeds"), icon: Rabbit },
    //     { href: null, label: t("nav.profileAttributes"), icon: UserRound },
    //   ],
    // },
    {
      key: "configuration",
      title: t("nav.configuration"),
      icon: Wrench,
      items: configurationItems,
    },
  ];

  return groups.filter((g): g is NavGroup => g !== null);
}

/**
 * Admin nav (admin.grolabs.ai). The GroLabs-internal management surface:
 * Contenido → Blog (/content/posts), Prospectos (list, rubric, benchmarks),
 * and Sistema → Estilo pointing at the now-public /styleguide. The style-guide
 * link appears here only, never in the RRE nav.
 */
export function buildAdminNav(t: T): NavGroup[] {
  return [
    {
      key: "content",
      title: t("nav.content"),
      icon: FileText,
      items: [
        { href: "/content/posts" as Route, label: t("nav.blog"), icon: FileText },
      ],
    },
    {
      // Flat (level-one) link — clicking goes straight to /prospects, no
      // children to drill into. The rubric/benchmarks editors (the assessment
      // *structure* config) are intentionally not surfaced in the nav.
      key: "prospects",
      title: t("nav.prospects"),
      flat: true,
      items: [
        { href: "/prospects" as Route, label: t("nav.prospects"), icon: UserRound, useIconWrapper: true },
      ],
    },
    {
      key: "accounts",
      title: t("nav.accounts"),
      icon: Building,
      items: [
        { href: "/clientes" as Route, label: t("nav.clients"), icon: Users, useIconWrapper: true },
      ],
    },
    {
      key: "system",
      title: t("nav.system"),
      icon: Settings,
      items: [
        { href: "/styleguide" as Route, label: t("nav.styleguide"), icon: Palette },
      ],
    },
  ];
}
