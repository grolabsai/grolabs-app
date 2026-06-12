import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import {
  ensureIndex,
  getIndexSettings,
  updateIndexSettings,
  type UpdatableIndexSettings,
} from "@/lib/search/meilisearch-client";
import { recordBackendOperation } from "@/lib/observability/backend-operation";

export const runtime = "nodejs";

/**
 * External-platform (BYO) index settings.
 *
 *   GET   /api/v1/catalog/settings?instance_id=N
 *   PATCH /api/v1/catalog/settings   { instance_id, searchableAttributes?, ... }
 *
 * Write-key authenticated. Lets a merchant declare which mapped fields are
 * searchable / filterable / sortable (+ synonyms / stop words) so filtering and
 * facets work for their own catalog shape. Mirrors Meilisearch's
 * /indexes/{uid}/settings. Plan: P4.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateWriteKey(
    req,
    req.nextUrl.searchParams.get("instance_id"),
  );
  if (!auth.ok) return auth.response;

  try {
    await ensureIndex(auth.instanceId);
    const settings = await getIndexSettings(auth.instanceId);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: "settings_read_failed", message: String(err) },
      { status: 500 },
    );
  }
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as {
    instance_id?: unknown;
    searchableAttributes?: unknown;
    filterableAttributes?: unknown;
    sortableAttributes?: unknown;
    synonyms?: unknown;
    stopWords?: unknown;
  };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  const update: UpdatableIndexSettings = {};
  const searchable = strArray(b.searchableAttributes);
  if (searchable) update.searchableAttributes = searchable;
  const filterable = strArray(b.filterableAttributes);
  if (filterable) {
    // instance_id MUST stay filterable — every tenant token pins `instance_id = N`.
    update.filterableAttributes = Array.from(
      new Set(["instance_id", ...filterable]),
    );
  }
  const sortable = strArray(b.sortableAttributes);
  if (sortable) update.sortableAttributes = sortable;
  const stopWords = strArray(b.stopWords);
  if (stopWords) update.stopWords = stopWords;
  if (b.synonyms && typeof b.synonyms === "object" && !Array.isArray(b.synonyms)) {
    update.synonyms = b.synonyms as Record<string, string[]>;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no_settings_provided" }, { status: 400 });
  }

  const startedAtMs = Date.now();
  try {
    await ensureIndex(auth.instanceId);
    const { taskUid } = await updateIndexSettings(auth.instanceId, update);

    const { data } = await auth.sb
      .from("catalog_ingestion_task")
      .insert({
        instance_id: auth.instanceId,
        op: "settings",
        status: "processing",
        meilisearch_task_uid: taskUid >= 0 ? taskUid : null,
      })
      .select("task_id")
      .single();

    await recordBackendOperation({
      instanceId: auth.instanceId,
      operationType: "byo_settings_update",
      payloadSummary: { keys: Object.keys(update), meili_task: taskUid },
      status: "succeeded",
      startedAtMs,
    });

    return NextResponse.json(
      {
        task_id: (data as { task_id: string } | null)?.task_id ?? null,
        meilisearch_task_uid: taskUid >= 0 ? taskUid : null,
        applied: Object.keys(update),
      },
      { status: 202 },
    );
  } catch (err) {
    await recordBackendOperation({
      instanceId: auth.instanceId,
      operationType: "byo_settings_update",
      status: "failed",
      errorMessage: String(err),
      startedAtMs,
    });
    return NextResponse.json(
      { error: "settings_update_failed", message: String(err) },
      { status: 500 },
    );
  }
}
