import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { Package, AlertTriangle, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { formatRelative } from "@/lib/format";
import { ImportListButton } from "@/components/pricing/ImportListButton";

export const dynamic = "force-dynamic";

/**
 * Pricing Overview — module dashboard.
 *
 * Maps onto docs/design/pricing/Pricing Overview.html. Stats and tables come
 * from real queries against the new pricing schema (provider, price_batch,
 * price_batch_item …). Where data isn't yet wired up — average margin, last
 * WooCommerce sync timestamp — we show the noData em-dash; those plug in as
 * the worksheet and sync screens land in follow-up PRs.
 */
export default async function PricingOverviewPage() {
  const tStats = await getTranslations("pricing.stats");
  const tBatches = await getTranslations("pricing.batches");
  const tActivity = await getTranslations("pricing.activity");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const supabase = await createClient();

  // ---- Stats ---------------------------------------------------------------
  // Active product variants — proxy for "products with a price assigned".
  // RLS scopes to the current instance; the explicit .eq is defensive only.
  const { count: activeProducts } = await supabase
    .from("product_variant")
    .select("variant_id", { count: "exact", head: true })
    .eq("is_active", true);

  // Pending authorizations = price_batch_item rows in 'critical' status whose
  // batch is still in draft/ready. A dedicated view will replace this query
  // when /pricing/violations ships.
  const { count: pendingAuth } = await supabase
    .from("price_batch_item")
    .select("price_batch_item_id", { count: "exact", head: true })
    .eq("status", "critical");

  // ---- Active batches ------------------------------------------------------
  const { data: batchRows } = await supabase
    .from("price_batch")
    .select(
      "price_batch_id, batch_name, status, updated_at, price_batch_item(price_batch_item_id, status)",
    )
    .in("status", ["draft", "ready"])
    .order("updated_at", { ascending: false })
    .limit(6);

  type BatchSummary = {
    id: number;
    name: string;
    status: "draft" | "ready" | "synced";
    productCount: number;
    violationCount: number;
    updatedAt: string | null;
  };

  const batches: BatchSummary[] =
    batchRows?.map((b) => {
      const items = (b.price_batch_item ?? []) as Array<{
        price_batch_item_id: number;
        status: "neutral" | "warning" | "critical";
      }>;
      return {
        id: b.price_batch_id,
        name: b.batch_name,
        status: b.status as BatchSummary["status"],
        productCount: items.length,
        violationCount: items.filter(
          (it) => it.status === "warning" || it.status === "critical",
        ).length,
        updatedAt: b.updated_at,
      };
    }) ?? [];

  return (
    <>
      {/* Header action sits inside the section because the layout already
          rendered the title bar. The "Importar lista" button opens the
          import wizard dialog (upload + column mapping). */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
          marginTop: -56, /* tuck up beside the layout title */
        }}
      >
        <ImportListButton />
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label={tStats("activeProducts")}
          value={activeProducts?.toLocaleString("es-GT") ?? tStats("noData")}
          hint={tStats("activeProductsHint")}
        />
        <StatCard
          label={tStats("avgMargin")}
          value={tStats("noData")}
          hint={tStats("avgMarginHint")}
        />
        <StatCard
          label={tStats("pendingAuth")}
          value={pendingAuth?.toString() ?? "0"}
          hint={tStats("pendingAuthHint")}
        />
        <StatCard
          label={tStats("lastSync")}
          value={tStats("noData")}
          hint={tStats("lastSyncHint")}
        />
      </div>

      {/* Active batches */}
      <section className="pricing-section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--gl-text)",
            }}
          >
            {tBatches("sectionTitle")}
          </h2>
        </div>

        {batches.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {batches.map((batch) => (
              <article key={batch.id} className="pricing-batch-card">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--gl-text)",
                    }}
                  >
                    {batch.name}
                  </div>
                  <span
                    className={`pricing-status-pill ${batch.status}`}
                  >
                    {tBatches(`status.${batch.status}`)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    fontSize: 13,
                    color: "var(--gl-text-tertiary)",
                    marginBottom: 12,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Icon icon={Package} size={14} strokeWidth={2} />
                    {tBatches("products", { n: batch.productCount })}
                  </span>
                  {batch.violationCount > 0 && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: "var(--gl-danger)",
                      }}
                    >
                      <Icon icon={AlertTriangle} size={14} strokeWidth={2} />
                      {tBatches("violations", { n: batch.violationCount })}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    paddingTop: 12,
                    borderTop: "1px solid var(--gl-border)",
                    fontSize: 12,
                    color: "var(--gl-text-muted)",
                  }}
                >
                  <Icon icon={User} size={14} strokeWidth={2} />
                  <span>{formatRelative(batch.updatedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBatches
            title={tBatches("empty.title")}
            text={tBatches("empty.text")}
          />
        )}
      </section>

      {/* Recent activity — populated once import + sync logs exist */}
      <section className="pricing-section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--gl-text)",
            }}
          >
            {tActivity("sectionTitle")}
          </h2>
        </div>
        <p
          style={{
            fontSize: 14,
            color: "var(--gl-text-tertiary)",
            padding: "32px 0",
            textAlign: "center",
          }}
        >
          {tActivity("empty")}
        </p>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="pricing-stat-card">
      <div className="pricing-stat-label">{label}</div>
      <div className="pricing-stat-value">{value}</div>
      <div className="pricing-stat-hint">{hint}</div>
    </div>
  );
}

function EmptyBatches({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--gl-text)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 14,
          color: "var(--gl-text-tertiary)",
          marginBottom: 20,
        }}
      >
        {text}
      </div>
      <ImportListButton />
    </div>
  );
}
