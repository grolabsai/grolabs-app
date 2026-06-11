import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bearerFromHeader, verifyWriteKey } from "./write-key";

/**
 * Write-key authentication for the external-platform (BYO) catalog routes.
 *
 * Unlike search/events (origin-bound client-side tokens), ingestion + settings
 * are privileged server-to-server calls authenticated by the per-instance write
 * key in the `Authorization: Bearer …` header. No Origin check — the key is the
 * boundary. Plan: P1/P2.
 */

/** Parse an instance_id that may arrive as number or numeric string. 0 is valid. */
export function parseInstanceId(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.length > 0
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export type WriteKeyAuth =
  | { ok: true; instanceId: number; sb: SupabaseClient }
  | { ok: false; response: NextResponse };

export async function authenticateWriteKey(
  req: NextRequest,
  instanceIdRaw: unknown,
): Promise<WriteKeyAuth> {
  const instanceId = parseInstanceId(instanceIdRaw);
  if (instanceId === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_instance_id" }, { status: 400 }),
    };
  }

  const key = bearerFromHeader(req.headers.get("authorization"));
  if (!key) {
    return {
      ok: false,
      response: NextResponse.json({ error: "missing_write_key" }, { status: 401 }),
    };
  }

  const sb = createServiceRoleClient();
  const valid = await verifyWriteKey(sb, instanceId, key);
  if (!valid) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_write_key" }, { status: 401 }),
    };
  }

  return { ok: true, instanceId, sb };
}
