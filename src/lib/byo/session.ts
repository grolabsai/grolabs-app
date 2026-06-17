import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Multi-part intake sessions for the external-platform (BYO) catalog.
 *
 * Reuses the existing `import_job` (the session) + `import_staging` (raw rows)
 * tables that already back the UI import wizard — there is ONE definition of an
 * import. An API session is just an `import_job` with a platform `source_type`
 * and the `collecting` status:
 *
 *   open    → insert import_job (status 'collecting')
 *   parts   → insert import_staging rows (raw_data verbatim, tagged part_role)
 *   complete→ flip status to 'review'; interpretation (P5) + the confirm loop
 *             (P6) consume review-state API jobs (not yet built)
 *
 * Writes use the service-role client (RLS-bypassing) per CLAUDE.md §2 — bulk
 * import is an allowed service-role flow — so instance_id is always set
 * explicitly. Plan: P3 (intake API), P4 (stitch consumes part_role).
 */

export const MAX_PART_RECORDS = 1000;

/** Platform / SDK source types added by migration 20260617000001. */
export const PLATFORM_SOURCES = ["api", "shopify", "woocommerce", "custom"] as const;

export type SessionRow = {
  job_id: number;
  instance_id: number;
  source_type: string;
  status: string;
  row_count: number | null;
  data_dictionary: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type SessionSummary = {
  job_id: number;
  total_rows: number;
  /** Row count per part_role; rows with no role are bucketed under "_unlabeled". */
  parts: Record<string, number>;
};

type LibError = { ok: false; error: string; status?: number };

/** Parse a session id (import_job.job_id, a positive integer). */
export function parseSessionId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function openSession(
  sb: SupabaseClient,
  instanceId: number,
  opts: { sourceType?: string; dataDictionary?: unknown; filename?: string | null },
): Promise<{ ok: true; session: SessionRow } | LibError> {
  const sourceType =
    typeof opts.sourceType === "string" &&
    (PLATFORM_SOURCES as readonly string[]).includes(opts.sourceType)
      ? opts.sourceType
      : "api";

  const { data, error } = await sb
    .from("import_job")
    .insert({
      instance_id: instanceId,
      source_type: sourceType,
      status: "collecting",
      row_count: 0,
      data_dictionary: opts.dataDictionary ?? null,
      filename: opts.filename ?? null,
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, session: data as SessionRow };
}

export async function addParts(
  sb: SupabaseClient,
  instanceId: number,
  jobId: number,
  partRole: string | null,
  records: Record<string, unknown>[],
): Promise<{ ok: true; accepted: number; totalRows: number } | LibError> {
  const { data: job, error: jobErr } = await sb
    .from("import_job")
    .select("job_id, status, row_count")
    .eq("instance_id", instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobErr) return { ok: false, error: jobErr.message };
  if (!job) return { ok: false, error: "session_not_found", status: 404 };
  if ((job as { status: string }).status !== "collecting")
    return { ok: false, error: "session_not_collecting", status: 409 };

  const base = (job as { row_count: number | null }).row_count ?? 0;
  const rows = records.map((raw, i) => ({
    instance_id: instanceId,
    job_id: jobId,
    row_number: base + i,
    raw_data: raw,
    part_role: partRole,
  }));

  const { error: insErr } = await sb.from("import_staging").insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  const totalRows = base + rows.length;
  await sb
    .from("import_job")
    .update({ row_count: totalRows })
    .eq("instance_id", instanceId)
    .eq("job_id", jobId);

  return { ok: true, accepted: rows.length, totalRows };
}

async function summarize(
  sb: SupabaseClient,
  instanceId: number,
  jobId: number,
): Promise<SessionSummary> {
  const { data } = await sb
    .from("import_staging")
    .select("part_role")
    .eq("instance_id", instanceId)
    .eq("job_id", jobId);

  const parts: Record<string, number> = {};
  let total = 0;
  for (const r of (data ?? []) as { part_role: string | null }[]) {
    total++;
    const key = r.part_role ?? "_unlabeled";
    parts[key] = (parts[key] ?? 0) + 1;
  }
  return { job_id: jobId, total_rows: total, parts };
}

export async function completeSession(
  sb: SupabaseClient,
  instanceId: number,
  jobId: number,
): Promise<{ ok: true; summary: SessionSummary } | LibError> {
  const { data: job, error: jobErr } = await sb
    .from("import_job")
    .select("job_id, status")
    .eq("instance_id", instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobErr) return { ok: false, error: jobErr.message };
  if (!job) return { ok: false, error: "session_not_found", status: 404 };

  const summary = await summarize(sb, instanceId, jobId);
  // collecting → review: all parts received. Interpretation (P5) + the confirm
  // loop (P6) will consume review-state API jobs once built.
  await sb
    .from("import_job")
    .update({ status: "review" })
    .eq("instance_id", instanceId)
    .eq("job_id", jobId);

  return { ok: true, summary };
}

export async function getSession(
  sb: SupabaseClient,
  instanceId: number,
  jobId: number,
): Promise<{ ok: true; session: Record<string, unknown>; summary: SessionSummary } | LibError> {
  const { data: job, error } = await sb
    .from("import_job")
    .select("job_id, source_type, status, row_count, created_at, updated_at, completed_at")
    .eq("instance_id", instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!job) return { ok: false, error: "session_not_found", status: 404 };

  const summary = await summarize(sb, instanceId, jobId);
  return { ok: true, session: job as Record<string, unknown>, summary };
}
