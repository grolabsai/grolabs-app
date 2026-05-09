import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentInstanceId } from "@/lib/instance";
import {
  listMapRules,
  listActiveProvidersBrief,
  listBrandsForPricing,
} from "@/lib/actions/pricing";
import { MapRulesCard } from "@/components/pricing/MapRulesCard";

/**
 * `/pricing/violations` — combined MAP rules config + (eventually) the
 * authorisation queue once worksheets exist. For v1 the queue half is a
 * placeholder card, since a violation can't exist without a price_batch.
 */

export const dynamic = "force-dynamic";

export default async function PricingViolationsPage() {
  const t = await getTranslations("pricing.violationsPage");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const [rulesRes, brandsRes, providersRes] = await Promise.all([
    listMapRules(),
    listBrandsForPricing(),
    listActiveProvidersBrief(),
  ]);

  const rules = rulesRes.ok ? rulesRes.rules : [];
  const brands = brandsRes.ok ? brandsRes.brands : [];
  const providers = providersRes.ok ? providersRes.providers : [];

  return (
    <>
      <MapRulesCard initial={rules} brands={brands} providers={providers} />

      {/* Placeholder for the violations queue — populated once /pricing/changes
          ships and price_batch_item rows can carry status_reasons. */}
      <section className="pricing-section">
        <header style={{ marginBottom: 8 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--s-text)",
            }}
          >
            {t("queueTitle")}
          </h2>
          <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
            {t("queueSubtitle")}
          </p>
        </header>
        <p
          style={{
            padding: "32px 0",
            textAlign: "center",
            fontSize: 13,
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("queueEmpty")}
        </p>
      </section>
    </>
  );
}
