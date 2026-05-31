import { getTranslations } from "next-intl/server";

/**
 * Placeholder body for pricing routes that aren't built yet. Keeps the nav
 * navigable without 404s and gives the user something coherent to land on
 * while individual screens are implemented in follow-up PRs.
 */
export async function PricingStub({ heading }: { heading: string }) {
  const t = await getTranslations("pricing.stub");

  return (
    <div
      style={{
        background: "var(--gl-surface)",
        border: "1px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-lg)",
        padding: 48,
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontSize: 12,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--gl-text-tertiary)",
          marginBottom: 8,
        }}
      >
        {t("comingSoon")}
      </p>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--gl-text)",
          marginBottom: 8,
        }}
      >
        {heading}
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "var(--gl-text-tertiary)",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        {t("comingSoonText")}
      </p>
    </div>
  );
}
