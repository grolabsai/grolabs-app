import { getTranslations } from "next-intl/server";
import { PricingStub } from "@/components/pricing/PricingStub";

export default async function PricingSyncPage() {
  const t = await getTranslations("pricing.tabs");
  return <PricingStub heading={t("sync")} />;
}
