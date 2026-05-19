"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { currentInstanceId } from "@/lib/instance";
import { loadWooClient } from "@/lib/import/woocommerce/client";
import { pullCategories } from "@/lib/import/woocommerce/pull-categories";
import { pullProducts } from "@/lib/import/woocommerce/pull-products";
import type {
  DebugReport,
  ImportProgress,
  ImportSummary,
  RunResult,
} from "@/lib/import/woocommerce/types";

/**
 * Server actions for the /import/woocommerce admin page.
 * Spec: docs/policy/wc-import.md §6.
 *
 * Each run uses the service-role supabase client because:
 *   1. The category second-pass UPDATE on level/parent must complete
 *      reliably even if RLS doesn't permit cross-row updates for the
 *      caller (it does today, but the import is an admin op by intent).
 *   2. We write an import_job row (instance_id-scoped) for audit.
 * The instance_id is resolved from the user's JWT via currentInstanceId
 * — there is no way for one tenant to operate on another's data.
 */

type StartResult =
  | { ok: true; jobId: number }
  | { ok: false; error: string };

export async function runWooCommerceImport(
  phase: "categories" | "products",
): Promise<StartResult> {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "Sin instancia activa." };

  // Credentials must be read with the user's client — the
  // woocommerce_get_consumer_secret RPC enforces instance_member via
  // auth.uid(), which is null under service-role.
  const wcResult = await loadWooClient(userClient, instanceId);
  if (!wcResult.ok) return { ok: false, error: wcResult.reason };

  // Subsequent bulk writes use service-role to avoid RLS friction on
  // the cross-row level/parent UPDATE in the categories pass.
  const admin = createServiceRoleClient();

  const sourceLabel = `WooCommerce: ${wcResult.client.siteUrl}`;

  const { data: jobRow, error: jobErr } = await admin
    .from("import_job")
    .insert({
      instance_id: instanceId,
      source_type: phase === "categories" ? "woocommerce_categories" : "woocommerce_products",
      filename: sourceLabel,
      status: "in_progress",
      created_by: user.id,
    })
    .select("job_id")
    .single();

  if (jobErr || !jobRow) {
    return { ok: false, error: jobErr?.message ?? "Could not create import_job row" };
  }
  const jobId = Number(jobRow.job_id);

  const onProgress = async (p: ImportProgress) => {
    await admin
      .from("instance")
      .update({
        integrations_config: await mergeProgressIntoConfig(admin, instanceId, {
          import_progress: { jobId, ...p },
        }),
      })
      .eq("instance_id", instanceId);
  };

  // Run inline. WC has at most a few hundred products in the wild for
  // the kind of merchant GroLabs targets in v1; sub-30s typical. If this
  // grows to multi-thousand catalogs, move to a queued job model.
  let summary: ImportSummary;
  try {
    summary =
      phase === "categories"
        ? await pullCategories(admin, wcResult.client, instanceId, onProgress)
        : await pullProducts(admin, wcResult.client, instanceId, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from("import_job")
      .update({
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      })
      .eq("job_id", jobId);
    return { ok: false, error: msg };
  }

  await admin
    .from("import_job")
    .update({
      status: summary.failed > 0 && summary.upserted === 0 ? "failed" : "completed",
      row_count: summary.total,
      error_message: summary.errors.length > 0 ? truncateErrors(summary.errors) : null,
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId);

  await admin
    .from("instance")
    .update({
      integrations_config: await mergeProgressIntoConfig(admin, instanceId, {
        last_import_at: new Date().toISOString(),
        last_import_summary: {
          phase,
          jobId,
          total: summary.total,
          upserted: summary.upserted,
          failed: summary.failed,
          durationMs: summary.durationMs,
          renamedSlugs: summary.renamedSlugs.length,
        },
        // Verbose debug log of everything the import did — surfaced on the
        // right-side debug pane. Cleared at the start of the next run.
        last_import_debug: summary.debug ?? null,
        // Clear progress now that the run is complete.
        import_progress: null,
      }),
    })
    .eq("instance_id", instanceId);

  revalidatePath("/import/woocommerce");
  revalidatePath("/import");
  return { ok: true, jobId };
}

export type ImportStatus = {
  progress: (ImportProgress & { jobId: number }) | null;
  lastImportAt: string | null;
  lastSummary: {
    phase: string;
    jobId: number;
    total: number;
    upserted: number;
    failed: number;
    durationMs: number;
    renamedSlugs: number;
  } | null;
  lastJob: {
    jobId: number;
    status: string;
    rowCount: number | null;
    errorMessage: string | null;
    completedAt: string | null;
  } | null;
  lastDebug: DebugReport | null;
};

export async function getImportStatus(): Promise<ImportStatus> {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();
  if (instanceId === null) {
    return {
      progress: null,
      lastImportAt: null,
      lastSummary: null,
      lastJob: null,
      lastDebug: null,
    };
  }

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  type WC = {
    import_progress?: ImportProgress & { jobId: number };
    last_import_at?: string;
    last_import_summary?: {
      phase: string;
      jobId: number;
      total: number;
      upserted: number;
      failed: number;
      durationMs: number;
      renamedSlugs: number;
    };
    last_import_debug?: DebugReport;
  };
  const wc: WC =
    (instanceRow?.integrations_config as { woocommerce?: WC })?.woocommerce ?? {};

  const { data: lastJobs } = await supabase
    .from("import_job")
    .select("job_id, status, row_count, error_message, completed_at")
    .eq("instance_id", instanceId)
    .in("source_type", ["woocommerce_categories", "woocommerce_products"])
    .order("job_id", { ascending: false })
    .limit(1);

  const lastJob =
    lastJobs && lastJobs.length > 0
      ? {
          jobId: Number(lastJobs[0].job_id),
          status: String(lastJobs[0].status),
          rowCount: lastJobs[0].row_count as number | null,
          errorMessage: lastJobs[0].error_message as string | null,
          completedAt: lastJobs[0].completed_at as string | null,
        }
      : null;

  return {
    progress: wc.import_progress ?? null,
    lastImportAt: wc.last_import_at ?? null,
    lastSummary: wc.last_import_summary ?? null,
    lastJob,
    lastDebug: wc.last_import_debug ?? null,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function mergeProgressIntoConfig(
  supabase: ReturnType<typeof createServiceRoleClient>,
  instanceId: number,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data: row } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  const current =
    (row?.integrations_config as Record<string, unknown> | null) ?? {};
  const wc = ((current.woocommerce as Record<string, unknown>) ?? {});

  // Drop keys explicitly set to null, otherwise merge.
  const next: Record<string, unknown> = { ...wc };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }

  return { ...current, woocommerce: next };
}

function truncateErrors(
  errors: ImportSummary["errors"],
): string {
  const first = errors.slice(0, 10);
  const more = errors.length - first.length;
  const parts = first.map(
    (e) =>
      `${e.woocommerceId ? `[${e.woocommerceId}] ` : ""}${e.identifier ? `${e.identifier}: ` : ""}${e.message}`,
  );
  if (more > 0) parts.push(`(+${more} more)`);
  return parts.join("\n").slice(0, 4000);
}

export type { RunResult };
