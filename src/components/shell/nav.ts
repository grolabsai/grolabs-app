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
  Activity,
  FileText,
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

/**
 * RRE nav (app.grolabs.ai). The user-facing app surface. Excludes the moved
 * admin sections (Contenido, Prospectos) and the Sistema → Estilo style-guide
 * link — those live in the admin nav only.
 */
export function buildRreNav(t: T): NavGroup[] {
  return [
    {
      key: "dashboard",
      title: t("nav.dashboard"),
      flat: true,
      items: [
        { href: "/dashboard" as Route, label: t("nav.dashboard"), icon: LayoutDashboard },
      ],
    },
    {
      key: "conversion",
      title: t("nav.conversion"),
      icon: GitBranch,
      items: [
        { href: "/funnel" as Route, label: t("nav.funnel"), icon: Workflow, useIconWrapper: true },
      ],
    },
    {
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
    {
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
    {
      key: "references",
      title: t("nav.references"),
      icon: Library,
      items: [
        { href: null, label: t("nav.species"), icon: PawPrint },
        { href: null, label: t("nav.breeds"), icon: Rabbit },
        { href: null, label: t("nav.profileAttributes"), icon: UserRound },
      ],
    },
    {
      key: "configuration",
      title: t("nav.configuration"),
      icon: Wrench,
      items: [
        { href: "/configuration/search" as Route, label: t("configuration.search.navLabel"), icon: Telescope, useIconWrapper: true },
        { href: "/configuration/algolia" as Route, label: t("configuration.algolia.navLabel"), icon: Search },
        { href: "/configuration/woocommerce" as Route, label: t("nav.woocommerce"), icon: ShoppingBag },
        { href: "/configuration/ga4" as Route, label: t("configuration.ga4.navLabel"), icon: LineChart, useIconWrapper: true },
        { href: "/configuration/system-health" as Route, label: t("configuration.systemHealth.navLabel"), icon: Activity, useIconWrapper: true },
        { href: null, label: t("nav.storeSettings"), icon: Settings },
      ],
    },
  ];
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
      key: "system",
      title: t("nav.system"),
      icon: Settings,
      items: [
        { href: "/styleguide" as Route, label: t("nav.styleguide"), icon: Palette },
      ],
    },
  ];
}
