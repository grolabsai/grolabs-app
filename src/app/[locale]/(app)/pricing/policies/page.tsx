import { redirect } from "next/navigation";
import { currentInstanceId } from "@/lib/instance";
import { getPricingConfig, listCharmRules } from "@/lib/actions/pricing";
import { CalculationModeCard } from "@/components/pricing/CalculationModeCard";
import { CharmRulesCard } from "@/components/pricing/CharmRulesCard";

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

  const [configRes, charmRulesRes] = await Promise.all([
    getPricingConfig(),
    listCharmRules(),
  ]);

  // Defensive defaults — if either call fails the page still renders so
  // the user can see and recover instead of facing a hard 500.
  const config = configRes.ok
    ? configRes.config
    : {
        calculation_mode: "margin" as const,
        default_target_pct: 40,
        default_min_pct: 20,
      };
  const charmRules = charmRulesRes.ok ? charmRulesRes.rules : [];

  return (
    <>
      <CalculationModeCard initial={config} />
      <CharmRulesCard initial={charmRules} />
    </>
  );
}
