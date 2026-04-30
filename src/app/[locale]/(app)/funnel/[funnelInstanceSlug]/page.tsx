import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getFunnelInstanceBySlug,
  getFunnelInstancesForUser,
} from "@/lib/funnel/queries";
import { FunnelTabs } from "@/components/funnel/FunnelTabs";
import { InstanceSelector } from "@/components/funnel/InstanceSelector";
import { DiagramTab } from "@/components/funnel/DiagramTab";

export const dynamic = "force-dynamic";

type RouteParams = { funnelInstanceSlug: string };

/**
 * /funnel/[funnelInstanceSlug] — main funnel screen.
 *
 * Pass 3 shape: live diagram canvas. Data structure + maintenance tabs
 * still placeholder until Pass 5 / Pass 6.
 */
export default async function FunnelInstancePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { funnelInstanceSlug } = await params;
  const t = await getTranslations("funnel");

  const [data, instances] = await Promise.all([
    getFunnelInstanceBySlug(funnelInstanceSlug),
    getFunnelInstancesForUser(),
  ]);

  if (!data) notFound();
  const { instance, stages, transitions, values } = data;

  return (
    <div className="s-content">
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-meta">{t("subtitle")}</p>
        </div>
        <InstanceSelector
          instances={instances}
          selectedSlug={instance.slug}
        />
      </header>

      <FunnelTabs
        diagram={
          <DiagramTab
            stages={stages}
            transitions={transitions}
            values={values}
          />
        }
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
