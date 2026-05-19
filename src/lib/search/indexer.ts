/**
 * Push pipeline: GroLabs catalog tables → Meilisearch.
 *
 * Per docs/policy/search-foundations.md §9. Read flow:
 *   product + brand → product_variant + product_pricing → product_category_link → product_media
 *
 * We use the service-role Supabase client because indexing runs from server
 * actions and (eventually) cron — both contexts where the user JWT is either
 * absent or scoped to a single instance, while we need to read the full
 * product row even when called from an unauthenticated trigger.
 *
 * Failure handling per §9: schema-validation/build failures land in
 * `failed_indexing` and we don't throw to the caller. Meilisearch upsert
 * failures DO throw (the manual reindex action surfaces them).
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ensureIndex,
  upsertDocuments,
  deleteDocument,
  waitForTaskCompletion,
} from "./meilisearch-client";
import {
  buildScoutSearchDocument,
  NotIndexableError,
  type SourceProductRow,
  type SourceVariantRow,
  type SourceCategoryLink,
  type SourceMediaRow,
  type SourceVariantAttribute,
} from "./document-builder";
import { indexUidFor, type ScoutSearchDocument } from "./types";
import {
  startBackendOperation,
  completeBackendOperation,
  recordBackendOperation,
  noteBackendOperationPending,
} from "@/lib/observability/backend-operation";

/**
 * How long to wait for a Meilisearch indexing task to actually complete
 * before giving up and leaving the operation `pending`. Tunable via env;
 * defaults to 10s per the observability spec.
 */
const TASK_WAIT_TIMEOUT_MS = Number(
  process.env.MEILISEARCH_TASK_WAIT_MS ?? 10_000,
);

const OP_INDEX = "meilisearch_index";
const OP_INDEX_SKIPPED = "meilisearch_index_skipped";
const OP_INDEX_BULK = "meilisearch_index_bulk";

// ── Source row fetcher ───────────────────────────────────────────────────

/** Load everything the document builder needs for a set of products in
 * one round trip per relation. Pure read — no writes. Returns rows in
 * arbitrary order; the builder filters per product_id internally. */
async function fetchSources(instanceId: number, productIds: number[]): Promise<{
  products: SourceProductRow[];
  variants: SourceVariantRow[];
  variantAttributes: SourceVariantAttribute[];
  categoryLinks: SourceCategoryLink[];
  media: SourceMediaRow[];
}> {
  const sb = createServiceRoleClient();

  const productsP = sb
    .from("product")
    .select(
      `product_id, instance_id, product_name, slug, short_description, long_description,
       is_active, image_url, woocommerce_id, wc_raw, sku, price, sale_price, stock_quantity,
       created_at, updated_at,
       brand:brand ( brand_name )`
    )
    .eq("instance_id", instanceId)
    .in("product_id", productIds);

  const variantsP = sb
    .from("product_variant")
    .select(
      `variant_id, product_id, variant_name, sku, weight_grams, is_active, image_url, woocommerce_id,
       product_pricing:product_pricing ( list_price, sale_price, cost_price, channel, currency )`
    )
    .eq("instance_id", instanceId)
    .in("product_id", productIds);

  const linksP = sb
    .from("product_category_link")
    .select(
      `product_id, is_primary,
       category:category ( category_id, category_name, woocommerce_id )`
    )
    .eq("instance_id", instanceId)
    .in("product_id", productIds);

  const mediaP = sb
    .from("product_media")
    .select(`product_id, variant_id, image_url, is_primary, sort_order`)
    .eq("instance_id", instanceId)
    .in("product_id", productIds);

  const [products, variants, links, media] = await Promise.all([
    productsP,
    variantsP,
    linksP,
    mediaP,
  ]);

  if (products.error) throw new Error(`load product rows failed: ${products.error.message}`);
  if (variants.error) throw new Error(`load variant rows failed: ${variants.error.message}`);
  if (links.error) throw new Error(`load category links failed: ${links.error.message}`);
  if (media.error) throw new Error(`load media rows failed: ${media.error.message}`);

  // Variant axis values are a separate, joined query — Supabase nesting on
  // product_variant_attribute would require nested aliases per data_type.
  // Plain join is simpler and fast at our scale.
  const variantIds = (variants.data ?? [])
    .map((v) => v.variant_id as number)
    .filter((id): id is number => typeof id === "number");
  let variantAttributes: SourceVariantAttribute[] = [];
  if (variantIds.length > 0) {
    const va = await sb
      .from("product_variant_attribute")
      .select(
        `variant_id, value_text, value_number, unit_id, value_id,
         product_attribute:product_attribute!inner ( attribute_code, data_type ),
         unit_of_measure:unit_of_measure ( code ),
         option:product_attribute_option ( value )`
      )
      .eq("instance_id", instanceId)
      .in("variant_id", variantIds);
    if (va.error) throw new Error(`load variant attribute rows failed: ${va.error.message}`);
    variantAttributes = (va.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const pa = row.product_attribute as { attribute_code?: string; data_type?: string } | null;
      const uom = row.unit_of_measure as { code?: string } | null;
      const opt = row.option as { value?: string } | null;
      return {
        variant_id: row.variant_id as number,
        attribute_code: pa?.attribute_code ?? "",
        data_type: pa?.data_type ?? "text",
        value_text: (row.value_text as string | null) ?? null,
        value_number: (row.value_number as number | string | null) ?? null,
        unit_code: uom?.code ?? null,
        option_value: opt?.value ?? null,
      };
    }).filter((r) => r.attribute_code);
  }

  return {
    products: (products.data ?? []) as unknown as SourceProductRow[],
    variants: (variants.data ?? []) as unknown as SourceVariantRow[],
    variantAttributes,
    categoryLinks: (links.data ?? []) as unknown as SourceCategoryLink[],
    media: (media.data ?? []) as unknown as SourceMediaRow[],
  };
}

// ── sync_status writes ───────────────────────────────────────────────────

const PLATFORM = "meilisearch";

async function recordSyncSuccess(
  instanceId: number,
  productId: number,
  taskUid: number
): Promise<void> {
  const sb = createServiceRoleClient();
  const now = new Date().toISOString();
  await sb.from("product_sync_status").upsert(
    {
      instance_id: instanceId,
      product_id: productId,
      platform: PLATFORM,
      last_synced_at: now,
      last_status: "success",
      last_error: null,
      external_id: String(productId),
      // We persist the most recent task uid in last_payload_hash for now —
      // it's the closest field and lets the admin panel surface "task X queued".
      last_payload_hash: String(taskUid),
    },
    { onConflict: "instance_id,product_id,platform" }
  );
}

async function recordSyncError(
  instanceId: number,
  productId: number,
  message: string
): Promise<void> {
  const sb = createServiceRoleClient();
  await sb.from("product_sync_status").upsert(
    {
      instance_id: instanceId,
      product_id: productId,
      platform: PLATFORM,
      last_status: "error",
      last_error: message.slice(0, 1000),
    },
    { onConflict: "instance_id,product_id,platform" }
  );
  await sb.from("failed_indexing").insert({
    instance_id: instanceId,
    product_id: productId,
    reason: message.slice(0, 1000),
  });
}

// ── Public API ───────────────────────────────────────────────────────────

export type IndexResult = {
  ok: boolean;
  taskUid?: number;
  error?: string;
  /** The product was intentionally NOT indexed (no parent WC id, no
   * variants with a WC id, or product missing). `ok` is still true — this
   * is not an error — but the product did NOT land in the index, so
   * callers that report sync outcomes must surface it as "skipped", never
   * as "synced". */
  skipped?: boolean;
  skipReason?: string;
};

/**
 * Index (or re-index) one product. Idempotent. Safe to call from any server
 * action right after the DB write completes.
 *
 * Returns a result rather than throwing for the success/build-failure path,
 * so callers can soft-fail without unwinding the user's mutation. Meilisearch
 * connection errors DO throw — those usually indicate a misconfiguration the
 * user needs to see immediately.
 */
export async function indexProduct(
  instanceId: number,
  productId: number
): Promise<IndexResult> {
  const startedAtMs = Date.now();
  let product: SourceProductRow | undefined;
  let docs: ScoutSearchDocument[];
  try {
    const sources = await fetchSources(instanceId, [productId]);
    product = sources.products[0];
    if (!product) {
      // Product not found — treat as a delete. (The mutation might have
      // been a soft-delete or moved to another instance.) This is a
      // legitimate no-op, not a failure, but it IS a reason a product
      // never lands in the index — record it so it's queryable.
      await removeProduct(instanceId, productId);
      await recordBackendOperation({
        instanceId,
        operationType: OP_INDEX_SKIPPED,
        targetId: String(productId),
        payloadSummary: { product_id: productId, reason: "product-not-found" },
        status: "succeeded",
        startedAtMs,
      });
      return { ok: true, skipped: true, skipReason: "product-not-found" };
    }
    docs = [
      buildScoutSearchDocument({
        product,
        variants: sources.variants.filter((v) => v.product_id === productId),
        variantAttributes: sources.variantAttributes,
        categoryLinks: sources.categoryLinks,
        media: sources.media,
      }),
    ];
  } catch (err) {
    if (err instanceof NotIndexableError) {
      // Not yet round-tripped to WC (no parent woocommerce_id, or no
      // variants with a wc id). Expected for fresh GroLabs products, but
      // also the single most common reason "some products don't land" —
      // record the reason so the audit table tells the real story.
      await removeProduct(instanceId, productId);
      await recordBackendOperation({
        instanceId,
        operationType: OP_INDEX_SKIPPED,
        targetId: String(productId),
        payloadSummary: {
          product_id: productId,
          reason: `not-indexable: ${err.message}`,
        },
        status: "succeeded",
        startedAtMs,
      });
      return {
        ok: true,
        skipped: true,
        skipReason: `not-indexable: ${err.message}`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    await recordSyncError(instanceId, productId, `build: ${message}`);
    await recordBackendOperation({
      instanceId,
      operationType: OP_INDEX,
      targetId: String(productId),
      payloadSummary: { product_id: productId, phase: "build" },
      status: "failed",
      errorMessage: `build: ${message}`,
      startedAtMs,
    });
    return { ok: false, error: message };
  }

  const targetId =
    product.woocommerce_id != null
      ? String(product.woocommerce_id)
      : String(productId);
  const opId = await startBackendOperation({
    instanceId,
    operationType: OP_INDEX,
    targetId,
    payloadSummary: {
      index_name: indexUidFor(instanceId),
      doc_count: docs.length,
      product_id: productId,
    },
  });

  let taskUid: number;
  try {
    await ensureIndex(instanceId);
    const task = await upsertDocuments(instanceId, docs);
    taskUid = task.taskUid;
  } catch (err) {
    // Connection/config failure — nothing was enqueued.
    const message = err instanceof Error ? err.message : String(err);
    await recordSyncError(instanceId, productId, `upsert: ${message}`);
    await completeBackendOperation(opId, {
      status: "failed",
      errorMessage: `upsert: ${message}`,
      responsePayload: { error: message },
      startedAtMs,
    });
    return { ok: false, error: message };
  }

  // The real outcome: poll the task to a terminal state. Enqueue is NOT
  // success.
  const outcome = await waitForTaskCompletion(taskUid, TASK_WAIT_TIMEOUT_MS);

  if (outcome.outcome === "succeeded") {
    await recordSyncSuccess(instanceId, productId, taskUid);
    await completeBackendOperation(opId, {
      status: "succeeded",
      responsePayload: outcome.task,
      startedAtMs,
    });
    return { ok: true, taskUid };
  }

  if (outcome.outcome === "failed") {
    const msg = outcome.error.message ?? "meilisearch task failed";
    const code = outcome.error.code ? `${outcome.error.code}: ` : "";
    await recordSyncError(instanceId, productId, `task ${taskUid}: ${code}${msg}`);
    await completeBackendOperation(opId, {
      status: "failed",
      responsePayload: outcome.task,
      errorMessage: `${code}${msg}`,
      startedAtMs,
    });
    return { ok: false, error: `${code}${msg}` };
  }

  // Timed out: the task is still being processed by the cluster. Do NOT
  // mark the product synced and do NOT claim success. Leave the operation
  // row pending (completed_at NULL) with the task uid so a later sync or a
  // future background poller can resolve it.
  await noteBackendOperationPending(opId, {
    task_uid: taskUid,
    note: `not confirmed: still processing after ${TASK_WAIT_TIMEOUT_MS}ms`,
  });
  return {
    ok: false,
    error: `meilisearch task ${taskUid} still processing after ${TASK_WAIT_TIMEOUT_MS}ms — not confirmed`,
  };
}

/** Drop a product from the index. Used when a product is deleted in GroLabs. */
export async function removeProduct(
  instanceId: number,
  productId: number
): Promise<IndexResult> {
  const task = await deleteDocument(instanceId, productId);
  const sb = createServiceRoleClient();
  await sb
    .from("product_sync_status")
    .delete()
    .eq("instance_id", instanceId)
    .eq("product_id", productId)
    .eq("platform", PLATFORM);
  return { ok: true, taskUid: task.taskUid };
}

export type BackfillResult = {
  ok: boolean;
  indexed: number;
  failed: number;
  syncLogId?: number;
  error?: string;
};

/**
 * Full re-index of every active product for an instance. Per §9:
 * paginated 100 per batch, append a sync_log row with running totals,
 * update instance.last_search_sync_at on success.
 */
export async function indexAllForInstance(
  instanceId: number,
  triggeredBy?: string | null
): Promise<BackfillResult> {
  const sb = createServiceRoleClient();
  const startedAt = new Date().toISOString();

  // sync_log row created up front so the UI can show "running…".
  const { data: logRow, error: logErr } = await sb
    .from("sync_log")
    .insert({
      instance_id: instanceId,
      platform: PLATFORM,
      started_at: startedAt,
      status: "running",
      triggered_by: triggeredBy ?? null,
    })
    .select("id")
    .single();
  if (logErr || !logRow) {
    return { ok: false, indexed: 0, failed: 0, error: logErr?.message ?? "log insert failed" };
  }
  const syncLogId: number = logRow.id;

  await ensureIndex(instanceId);

  const PAGE = 100;
  let indexed = 0;
  let failed = 0;
  let from = 0;
  let total = 0;

  // Paginate by product_id ascending so we get a stable ordering.
  for (;;) {
    const { data: page, error } = await sb
      .from("product")
      .select("product_id")
      .eq("instance_id", instanceId)
      .eq("is_active", true)
      .order("product_id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      await sb
        .from("sync_log")
        .update({
          ended_at: new Date().toISOString(),
          status: "error",
          error_message: error.message,
          products_count: total,
          succeeded_count: indexed,
          failed_count: failed,
        })
        .eq("id", syncLogId);
      return { ok: false, indexed, failed, syncLogId, error: error.message };
    }
    if (!page || page.length === 0) break;
    total += page.length;

    const ids = page.map((p) => p.product_id as number);
    let sources;
    try {
      sources = await fetchSources(instanceId, ids);
    } catch (err) {
      // Whole batch failed to load. Mark each as failed and continue.
      const msg = err instanceof Error ? err.message : String(err);
      for (const id of ids) await recordSyncError(instanceId, id, `batch-load: ${msg}`);
      failed += ids.length;
      from += PAGE;
      continue;
    }

    const docs: ScoutSearchDocument[] = [];
    const builtIds: number[] = [];
    for (const product of sources.products) {
      try {
        const doc = buildScoutSearchDocument({
          product,
          variants: sources.variants.filter((v) => v.product_id === product.product_id),
          variantAttributes: sources.variantAttributes,
          categoryLinks: sources.categoryLinks,
          media: sources.media,
        });
        docs.push(doc);
        builtIds.push(product.product_id);
      } catch (err) {
        if (err instanceof NotIndexableError) {
          // Strip any prior doc and treat the product as up-to-date.
          await removeProduct(instanceId, product.product_id);
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await recordSyncError(instanceId, product.product_id, `build: ${msg}`);
        failed += 1;
      }
    }

    if (docs.length > 0) {
      const batchStartedMs = Date.now();
      const opId = await startBackendOperation({
        instanceId,
        operationType: OP_INDEX_BULK,
        targetId: null,
        payloadSummary: {
          index_name: indexUidFor(instanceId),
          doc_count: docs.length,
          product_ids: builtIds,
        },
      });
      let taskUid: number | null = null;
      try {
        const task = await upsertDocuments(instanceId, docs);
        taskUid = task.taskUid;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const id of builtIds) await recordSyncError(instanceId, id, `upsert: ${msg}`);
        await completeBackendOperation(opId, {
          status: "failed",
          errorMessage: `upsert: ${msg}`,
          responsePayload: { error: msg },
          startedAtMs: batchStartedMs,
        });
        failed += docs.length;
      }

      if (taskUid !== null) {
        const outcome = await waitForTaskCompletion(
          taskUid,
          TASK_WAIT_TIMEOUT_MS,
        );
        if (outcome.outcome === "succeeded") {
          for (const id of builtIds) await recordSyncSuccess(instanceId, id, taskUid);
          await completeBackendOperation(opId, {
            status: "succeeded",
            responsePayload: outcome.task,
            startedAtMs: batchStartedMs,
          });
          indexed += docs.length;
        } else if (outcome.outcome === "failed") {
          const msg = outcome.error.message ?? "meilisearch task failed";
          const code = outcome.error.code ? `${outcome.error.code}: ` : "";
          for (const id of builtIds) {
            await recordSyncError(instanceId, id, `task ${taskUid}: ${code}${msg}`);
          }
          await completeBackendOperation(opId, {
            status: "failed",
            responsePayload: outcome.task,
            errorMessage: `${code}${msg}`,
            startedAtMs: batchStartedMs,
          });
          failed += docs.length;
        } else {
          // Timed out — not confirmed. Don't mark these synced; leave the
          // op pending for a later run to resolve.
          await noteBackendOperationPending(opId, {
            task_uid: taskUid,
            note: `not confirmed: still processing after ${TASK_WAIT_TIMEOUT_MS}ms`,
          });
          failed += docs.length;
        }
      }
    }

    if (page.length < PAGE) break;
    from += PAGE;
  }

  const finalStatus = failed === 0 ? "success" : indexed === 0 ? "error" : "partial";
  await sb
    .from("sync_log")
    .update({
      ended_at: new Date().toISOString(),
      status: finalStatus,
      products_count: total,
      succeeded_count: indexed,
      failed_count: failed,
    })
    .eq("id", syncLogId);

  if (finalStatus !== "error") {
    await sb
      .from("instance")
      .update({ last_search_sync_at: new Date().toISOString() })
      .eq("instance_id", instanceId);
  }

  return { ok: finalStatus !== "error", indexed, failed, syncLogId };
}
