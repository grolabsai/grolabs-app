import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Plus, Truck } from "lucide-react";
import { currentInstanceId } from "@/lib/instance";
import { listProviders } from "@/lib/actions/pricing";

/**
 * Provider grid — every active and inactive provider on the instance.
 *
 * Design reference: docs/design/pricing/Providers.html. Each card surfaces
 * the fields most useful when picking a provider during a price-list
 * import: name, contact, payment terms, brand list. Inactive providers are
 * dimmed but still visible so the user can reactivate them.
 */

export const dynamic = "force-dynamic";

export default async function PricingProvidersPage() {
  const t = await getTranslations("pricing.providersList");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const res = await listProviders();
  const providers = res.ok ? res.providers : [];

  return (
    <>
      {/* Header action — sits beside the layout title */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
          marginTop: -56,
        }}
      >
        <Button asChild>
          <Link href="/pricing/providers/new">
            <Icon icon={Plus} size={16} strokeWidth={2} />
            <span style={{ marginLeft: 8 }}>{t("add")}</span>
          </Link>
        </Button>
      </div>

      {providers.length === 0 ? (
        <div
          style={{
            background: "var(--gl-surface)",
            border: "1px solid var(--gl-border)",
            borderRadius: "var(--gl-radius-lg)",
            padding: 60,
            textAlign: "center",
          }}
        >
          <Icon icon={Truck} size={32} strokeWidth={1.5} />
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--gl-text)",
              marginTop: 12,
              marginBottom: 8,
            }}
          >
            {t("empty.title")}
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "var(--gl-text-tertiary)",
              maxWidth: 460,
              margin: "0 auto 20px",
            }}
          >
            {t("empty.text")}
          </p>
          <Button asChild>
            <Link href="/pricing/providers/new">
              <Icon icon={Plus} size={16} strokeWidth={2} />
              <span style={{ marginLeft: 8 }}>{t("add")}</span>
            </Link>
          </Button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {providers.map((p) => (
            <Link
              key={p.provider_id}
              href={`/pricing/providers/${p.provider_id}`}
              className="pricing-provider-card"
              data-inactive={!p.is_active}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--gl-text)",
                    lineHeight: 1.2,
                  }}
                >
                  {p.provider_name}
                </h3>
                {!p.is_active ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--gl-surface-alt)",
                      color: "var(--gl-text-tertiary)",
                      fontWeight: 500,
                    }}
                  >
                    {t("inactiveBadge")}
                  </span>
                ) : null}
              </div>
              {p.legal_name ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--gl-text-tertiary)",
                  }}
                >
                  {p.legal_name}
                </div>
              ) : null}
              {p.contact_name || p.email || p.phone ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--gl-text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {p.contact_name ? <div>{p.contact_name}</div> : null}
                  {p.email ? <div>{p.email}</div> : null}
                  {p.phone ? <div>{p.phone}</div> : null}
                </div>
              ) : null}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                {p.payment_terms ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "var(--gl-surface-alt)",
                      color: "var(--gl-text-secondary)",
                    }}
                  >
                    {p.payment_terms}
                  </span>
                ) : null}
                {p.consignment ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "var(--gl-accent-50)",
                      color: "var(--gl-accent-800)",
                      fontWeight: 500,
                    }}
                  >
                    {t("consignmentTag")}
                  </span>
                ) : null}
              </div>
              {p.brand_names.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: "1px solid var(--gl-border)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--gl-text-tertiary)",
                      width: "100%",
                      marginBottom: 2,
                    }}
                  >
                    {t("brandsLabel")}
                  </span>
                  {p.brand_names.map((name) => (
                    <span
                      key={name}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "var(--gl-surface-alt)",
                        color: "var(--gl-text-secondary)",
                      }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
