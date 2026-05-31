import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { ChevronLeft } from "lucide-react";
import { currentInstanceId } from "@/lib/instance";
import {
  getProvider,
  listBrandsForPricing,
  listProviderBrands,
} from "@/lib/actions/pricing";
import { ProviderForm } from "@/components/pricing/ProviderForm";

export const dynamic = "force-dynamic";

export default async function EditProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("pricing.providerForm");

  const { id: idParam } = await params;
  const providerId = Number(idParam);
  if (!Number.isFinite(providerId)) notFound();

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const [providerRes, brandsRes, linkedBrandsRes] = await Promise.all([
    getProvider(providerId),
    listBrandsForPricing(),
    listProviderBrands(providerId),
  ]);

  if (!providerRes.ok) notFound();

  const brands = brandsRes.ok ? brandsRes.brands : [];
  const initialBrandIds = linkedBrandsRes.ok ? linkedBrandsRes.brandIds : [];

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
            color: "var(--gl-text-tertiary)",
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
            color: "var(--gl-text)",
            marginTop: 4,
          }}
        >
          {providerRes.provider.provider_name}
        </h1>
      </div>

      <ProviderForm
        initial={providerRes.provider}
        brands={brands}
        initialBrandIds={initialBrandIds}
      />
    </div>
  );
}
