import {
  Users,
  Search,
  Share2,
  DollarSign,
  Globe,
  Mail,
  Sparkles,
  Home,
  LayoutGrid,
  List,
  ListFilter,
  Package,
  ShoppingCart,
  CreditCard,
  CheckCircle2,
  ArrowDownToLine,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * Registry mapping the icon_key string stored on funnel_stage to its lucide
 * component. Keys are PascalCase lucide names matching the seed migration
 * (e.g. 'Users', 'ShoppingCart').
 *
 * Falls back to HelpCircle if the icon_key is missing or unknown — we log
 * once per unknown key so a typo in the DB surfaces in dev without breaking
 * the diagram render.
 */
const REGISTRY: Record<string, LucideIcon> = {
  Users,
  Search,
  Share2,
  DollarSign,
  Globe,
  Mail,
  Sparkles,
  Home,
  LayoutGrid,
  List,
  ListFilter,
  Package,
  ShoppingCart,
  CreditCard,
  CheckCircle2,
  ArrowDownToLine,
};

const warnedKeys = new Set<string>();

export function resolveStageIcon(iconKey: string | null | undefined): LucideIcon {
  if (!iconKey) return HelpCircle;
  const found = REGISTRY[iconKey];
  if (found) return found;
  if (!warnedKeys.has(iconKey)) {
    console.warn(
      `[funnel] unknown icon_key "${iconKey}" — falling back to HelpCircle`,
    );
    warnedKeys.add(iconKey);
  }
  return HelpCircle;
}
