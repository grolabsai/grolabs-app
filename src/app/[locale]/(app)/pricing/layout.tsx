import { getTranslations } from "next-intl/server";
import { PricingTabs } from "@/components/pricing/PricingTabs";

/**
 * Shared layout for the pricing module.
 *
 * Renders the section header (title + subtitle) and the tab subnav. Each
 * `/pricing/*` route renders inside `{children}` and supplies its own content
 * — stats grid, tables, agent panel etc. The layout deliberately leaves the
 * right gutter empty so the future agent panel can dock there (see CLAUDE.md
 * §14 — agent-oriented design).
 */
export default async function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("pricing");

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "32px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 32,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: "var(--s-text)",
              marginBottom: 4,
            }}
          >
            {t("title")}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("subtitle")}
          </p>
        </div>
      </header>

      <PricingTabs />

      {children}
    </div>
  );
}
