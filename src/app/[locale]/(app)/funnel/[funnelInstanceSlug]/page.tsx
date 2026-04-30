import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getFunnelInstanceBySlug,
  getFunnelInstancesForUser,
} from "@/lib/funnel/queries";
import { FunnelTabs } from "@/components/funnel/FunnelTabs";
import { InstanceSelector } from "@/components/funnel/InstanceSelector";
import { DiagramTab } from "@/components/funnel/DiagramTab";
import { DataStructureTab } from "@/components/funnel/DataStructureTab";
import { MaintenanceTab } from "@/components/funnel/MaintenanceTab";

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
  const {
    instance,
    flow,
    dataset,
    stages,
    transitions,
    values,
    frictionPoints,
    frictionFindings,
  } = data;

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
            instance={instance}
            dataset={dataset}
            stages={stages}
            transitions={transitions}
            values={values}
            frictionPoints={frictionPoints}
            frictionFindings={frictionFindings}
          />
        }
        dataStructure={
          <DataStructureTab
            instance={instance}
            flow={flow}
            dataset={dataset}
            stages={stages}
            transitions={transitions}
            values={values}
            frictionPoints={frictionPoints}
            frictionFindings={frictionFindings}
          />
        }
        maintenance={
          <MaintenanceTab
            flow={flow}
            stages={stages}
            transitions={transitions}
          />
        }
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
