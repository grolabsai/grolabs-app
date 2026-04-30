import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getFunnelInstanceBySlug,
  getFunnelInstancesForUser,
} from "@/lib/funnel/queries";
import { FunnelTabs } from "@/components/funnel/FunnelTabs";
import { InstanceSelector } from "@/components/funnel/InstanceSelector";

export const dynamic = "force-dynamic";

type RouteParams = { funnelInstanceSlug: string };

/**
 * /funnel/[funnelInstanceSlug] — main funnel screen.
 *
 * Pass 1 shape: title + InstanceSelector + tabs container with placeholder
 * panels. Pass 3 onwards drops the diagram canvas, inspector, data tables,
 * and maintenance forms into the tab slots.
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
  const { instance, flow, stages, transitions, dataset, values } = data;

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
          <DiagramPlaceholder
            instance={instance}
            stagesCount={stages.length}
            transitionsCount={transitions.length}
            datasetName={dataset?.name ?? null}
            valuesCount={values.length}
          />
        }
        dataStructure={<TabPlaceholder label={t("placeholder")} />}
        maintenance={<TabPlaceholder label={t("placeholder")} />}
      />

      {/* Surfaced for the smoke test only — confirms the flow row loaded. */}
      <p
        style={{
          marginTop: 24,
          fontSize: 11,
          color: "var(--s-text-tertiary)",
          fontFamily: "var(--s-font-mono)",
        }}
      >
        flow: {flow.slug}
      </p>
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

async function DiagramPlaceholder({
  instance,
  stagesCount,
  transitionsCount,
  datasetName,
  valuesCount,
}: {
  instance: { name: string; industry: string | null; funnel_instance_type: string; monthly_traffic: number; average_order_value: number; average_cart_skus: number };
  stagesCount: number;
  transitionsCount: number;
  datasetName: string | null;
  valuesCount: number;
}) {
  const t = await getTranslations("funnel");
  const tType = await getTranslations("funnel.instanceTypes");
  const tMeta = await getTranslations("funnel.instanceMeta");

  // Pass 1 stub: shows that the data layer wired up correctly. The
  // ReactFlow canvas + DiagramInspector replace this in Pass 3 / Pass 4.
  return (
    <div style={{ padding: "16px 0" }}>
      <div
        style={{
          padding: "16px 20px",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          background: "var(--s-surface)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{instance.name}</div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--s-text-tertiary)",
          }}
        >
          {tType(instance.funnel_instance_type as "template" | "customer" | "scenario")}
          {instance.industry ? ` · ${instance.industry}` : ""}
        </div>

        <dl
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "12px 24px",
            fontSize: 12,
          }}
        >
          <MetaRow label={tMeta("monthlyTraffic")} value={instance.monthly_traffic.toLocaleString()} />
          <MetaRow label={tMeta("averageOrderValue")} value={instance.average_order_value.toLocaleString()} />
          <MetaRow label={tMeta("averageCartSkus")} value={instance.average_cart_skus.toString()} />
          <MetaRow label={tMeta("stages")} value={stagesCount.toString()} />
          <MetaRow label={tMeta("transitions")} value={transitionsCount.toString()} />
          <MetaRow
            label={tMeta("datasetValues")}
            value={datasetName ? `${valuesCount} (${datasetName})` : "—"}
          />
        </dl>

        <p
          style={{
            marginTop: 20,
            fontSize: 12,
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("placeholder")} — ReactFlow canvas
        </p>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--s-text-tertiary)",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          marginTop: 2,
          fontSize: 13,
          color: "var(--s-text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </dd>
    </div>
  );
}
