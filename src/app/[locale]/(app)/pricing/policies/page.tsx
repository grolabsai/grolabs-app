import { redirect } from "next/navigation";
import { currentInstanceId } from "@/lib/instance";
import {
  getPricingConfig,
  listCharmRules,
  listCategoryMargins,
} from "@/lib/actions/pricing";
import { CalculationModeCard } from "@/components/pricing/CalculationModeCard";
import { CharmRulesCard } from "@/components/pricing/CharmRulesCard";
import { CategoryMarginsCard } from "@/components/pricing/CategoryMarginsCard";
import { MaxPriceChangeCard } from "@/components/pricing/MaxPriceChangeCard";

/**
 * Pricing policies — configuration hub for the worksheet.
 *
 * Cards stack top-to-bottom in dependency order: the calculation mode is
 * the prerequisite for every percentage below it, so it sits first.
 * Charm rules sit second; per-category margins and global change limits
 * land in follow-up PRs as their own cards on this same page.
 */

export const dynamic = "force-dynamic";

export default async function PricingPoliciesPage() {
  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const [configRes, charmRulesRes, marginRowsRes] = await Promise.all([
    getPricingConfig(),
    listCharmRules(),
    listCategoryMargins(),
  ]);

  // Defensive defaults — if either call fails the page still renders so
  // the user can see and recover instead of facing a hard 500.
  const config = configRes.ok
    ? configRes.config
    : {
        calculation_mode: "margin" as const,
        default_target_pct: 40,
        default_min_pct: 20,
        max_price_change_enabled: false,
        max_price_change_pct: 5,
      };
  const charmRules = charmRulesRes.ok ? charmRulesRes.rules : [];
  const marginRows = marginRowsRes.ok ? marginRowsRes.rows : [];

  return (
    <>
      <CalculationModeCard initial={config} />
      <CategoryMarginsCard
        initial={marginRows}
        mode={config.calculation_mode}
      />
      <CharmRulesCard initial={charmRules} />
      <MaxPriceChangeCard initial={config} />
    </>
  );
}
