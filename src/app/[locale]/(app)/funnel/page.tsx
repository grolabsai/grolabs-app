import { getTranslations } from "next-intl/server";
import { FunnelTabs } from "@/components/funnel/FunnelTabs";

/**
 * Funnel index — Pass 0 smoke test.
 *
 * Hardcoded placeholder content while we validate that the tabs primitive
 * renders cleanly inside the (app) shell. Pass 1 replaces this with the
 * data-driven InstanceSelector + slug-keyed sub-route.
 */
export default async function FunnelIndexPage() {
  const t = await getTranslations("funnel");

  return (
    <div className="s-content">
      <header style={{ marginBottom: 16 }}>
        <h1 className="s-title">{t("title")}</h1>
        <p className="s-meta">{t("subtitle")}</p>
      </header>

      <FunnelTabs
        diagram={<TabPlaceholder label={t("placeholder")} />}
        dataStructure={<TabPlaceholder label={t("placeholder")} />}
        maintenance={<TabPlaceholder label={t("placeholder")} />}
      />
    </div>
  );
}

function TabPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        fontSize: 13,
        color: "var(--s-text-tertiary)",
      }}
    >
      {label}
    </div>
  );
}
