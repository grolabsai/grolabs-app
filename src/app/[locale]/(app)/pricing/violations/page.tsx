import { redirect } from "next/navigation";
import { currentInstanceId } from "@/lib/instance";
import {
  listMapRules,
  listActiveProvidersBrief,
  listBrandsForPricing,
  listOpenViolations,
} from "@/lib/actions/pricing";
import { MapRulesCard } from "@/components/pricing/MapRulesCard";
import { AuthQueueCard } from "@/components/pricing/AuthQueueCard";

/**
 * `/pricing/violations` — MAP rules config (top) + cross-batch
 * authorisation queue (bottom). The queue surfaces every warning +
 * critical row from non-synced batches so the operator can sweep them
 * without opening each batch individually. Synced batches are excluded
 * (immutable) — the worksheet is the right surface for everything else.
 */

export const dynamic = "force-dynamic";

export default async function PricingViolationsPage() {
  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const [rulesRes, brandsRes, providersRes, violationsRes] = await Promise.all([
    listMapRules(),
    listBrandsForPricing(),
    listActiveProvidersBrief(),
    listOpenViolations(),
  ]);

  const rules = rulesRes.ok ? rulesRes.rules : [];
  const brands = brandsRes.ok ? brandsRes.brands : [];
  const providers = providersRes.ok ? providersRes.providers : [];
  const violations = violationsRes.ok ? violationsRes.rows : [];

  return (
    <>
      <MapRulesCard initial={rules} brands={brands} providers={providers} />
      <AuthQueueCard initial={violations} />
    </>
  );
}
