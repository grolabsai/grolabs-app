import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { ChevronLeft } from "lucide-react";
import { currentInstanceId } from "@/lib/instance";
import { listBrandsForPricing } from "@/lib/actions/pricing";
import { ProviderForm } from "@/components/pricing/ProviderForm";

export const dynamic = "force-dynamic";

export default async function NewProviderPage() {
  const t = await getTranslations("pricing.providerForm");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const brandsRes = await listBrandsForPricing();
  const brands = brandsRes.ok ? brandsRes.brands : [];

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginTop: -56, marginBottom: 16 }}>
        <Link
          href="/pricing/providers"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: "var(--s-text-tertiary)",
            textDecoration: "none",
          }}
        >
          <Icon icon={ChevronLeft} size={14} strokeWidth={2} />
          {t("backToList")}
        </Link>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--s-text)",
            marginTop: 4,
          }}
        >
          {t("titleNew")}
        </h1>
      </div>

      <ProviderForm initial={null} brands={brands} initialBrandIds={[]} />
    </div>
  );
}
