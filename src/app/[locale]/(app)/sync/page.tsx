import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { SyncManager, type ProductRow, type SyncLogEntry } from "@/components/sync/SyncManager";
import { effectiveUpdatedAt, deriveStatus } from "@/lib/sync/sync-status";

/**
 * Sync Manager — push products to Algolia (search) and WooCommerce (storefront).
 * Per-product status icons live on /catalog/products too; this page is the
 * dedicated bulk-action surface with filtering + history.
 */

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  await getTranslations("sync"); // ensures the namespace is available
  const supabase = await createClient();
  const instanceId = await currentInstanceId();

  if (instanceId === null) {
    redirect("/login");
  }

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch products + minimal join for status derivation
  type ProductRowDb = {
    product_id: number;
    product_name: string;
    slug: string;
    is_active: boolean;
    updated_at: string;
    product_variant: Array<{
      sku: string | null;
      updated_at: string;
      product_pricing: Array<{ updated_at: string }>;
    }>;
  };

  const { data: products } = await supabase
    .from("product")
    .select(
      `product_id, product_name, slug, is_active, updated_at,
       product_variant ( sku, updated_at, product_pricing ( updated_at ) )`,
    )
    .eq("instance_id", instanceId)
    .order("updated_at", { ascending: false })
    .returns<ProductRowDb[]>();

  // Fetch the per-product sync status for both platforms
  const productIds = (products ?? []).map((p) => p.product_id);
  type StatusRow = {
    product_id: number;
    platform: "algolia" | "woocommerce";
    last_synced_at: string | null;
  };
  const { data: statuses } = productIds.length
    ? await supabase
        .from("product_sync_status")
        .select("product_id, platform, last_synced_at")
        .eq("instance_id", instanceId)
        .in("product_id", productIds)
        .returns<StatusRow[]>()
    : { data: [] as StatusRow[] };
  const statusByPair = new Map<string, string | null>();
  for (const s of statuses ?? []) {
    statusByPair.set(`${s.product_id}:${s.platform}`, s.last_synced_at);
  }

  // Project to ProductRow shape used by the client
  const rows: ProductRow[] = (products ?? []).map((p) => {
    const eff = effectiveUpdatedAt({
      productUpdatedAt: p.updated_at,
      variantUpdatedAts: (p.product_variant ?? []).map((v) => v.updated_at),
      pricingUpdatedAts: (p.product_variant ?? []).flatMap((v) =>
        (v.product_pricing ?? []).map((pr) => pr.updated_at),
      ),
    });
    const algoliaLast = statusByPair.get(`${p.product_id}:algolia`) ?? null;
    const wooLast = statusByPair.get(`${p.product_id}:woocommerce`) ?? null;
    return {
      productId: p.product_id,
      productName: p.product_name,
      slug: p.slug,
      isActive: p.is_active,
      effectiveUpdatedAt: eff?.toISOString() ?? p.updated_at,
      variantSkuCount: (p.product_variant ?? []).filter((v) => v.sku && v.sku.trim()).length,
      algolia: {
        status: deriveStatus({ effectiveUpdatedAt: eff, lastSyncedAt: algoliaLast }),
        lastSyncedAt: algoliaLast,
      },
      woocommerce: {
        status: deriveStatus({ effectiveUpdatedAt: eff, lastSyncedAt: wooLast }),
        lastSyncedAt: wooLast,
      },
    };
  });

  // Sync log (last 25)
  type LogRowDb = {
    id: number;
    platform: "algolia" | "woocommerce";
    started_at: string;
    ended_at: string | null;
    products_count: number;
    succeeded_count: number;
    failed_count: number;
    status: string;
    error_message: string | null;
  };
  const { data: logRows } = await supabase
    .from("sync_log")
    .select(
      "id, platform, started_at, ended_at, products_count, succeeded_count, failed_count, status, error_message",
    )
    .eq("instance_id", instanceId)
    .order("started_at", { ascending: false })
    .limit(25)
    .returns<LogRowDb[]>();
  const logEntries: SyncLogEntry[] = (logRows ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    productsCount: r.products_count,
    succeededCount: r.succeeded_count,
    failedCount: r.failed_count,
    status: r.status as SyncLogEntry["status"],
    errorMessage: r.error_message,
  }));

  // Configuration check — drives whether the action buttons are enabled
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  type AlgoliaCfg = { app_id?: string; primary_index?: string };
  type WooCfg = { site_url?: string; consumer_key?: string };
  const cfg = (instanceRow?.integrations_config ?? {}) as {
    algolia?: AlgoliaCfg;
    woocommerce?: WooCfg;
  };
  const algoliaConfigured = !!(cfg.algolia?.app_id && cfg.algolia?.primary_index);
  const woocommerceConfigured = !!(cfg.woocommerce?.site_url && cfg.woocommerce?.consumer_key);

  return (
    <SyncManager
      rows={rows}
      logEntries={logEntries}
      algoliaConfigured={algoliaConfigured}
      woocommerceConfigured={woocommerceConfigured}
    />
  );
}
