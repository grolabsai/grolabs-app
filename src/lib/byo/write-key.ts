import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * External-platform (BYO) write key — the per-instance SECRET used for the
 * privileged surfaces of the integration (catalog ingestion + index settings).
 *
 * We only ever store a SHA-256 hash of the key. The plaintext is shown to the
 * merchant exactly once at issuance; verification hashes the presented Bearer
 * token and compares it (constant-time) against the stored hash. There is no
 * way to recover the plaintext — rotation issues a new one.
 *
 * Persistence + rotation go through the `byo_issue_write_key` RPC (migration
 * 20260605000001). Route verification uses the service-role client because the
 * public ingestion routes carry no user session.
 *
 * Plan: docs/design/byo-integration-meilisearch-parity.md (P1).
 */

const KEY_BYTES = 24; // 192 bits of entropy
const KEY_LABEL = "glw_live_"; // GroLabs write key, live
const DISPLAY_PREFIX_LEN = KEY_LABEL.length + 6;

export type GeneratedWriteKey = {
  /** Shown to the merchant exactly once — never persisted in plaintext. */
  plaintext: string;
  /** SHA-256 hex — what we persist via byo_issue_write_key. */
  hash: string;
  /** Display prefix, e.g. "glw_live_a1b2c3" — safe to show in the UI. */
  prefix: string;
};

/** Mint a fresh write key (plaintext + hash + display prefix). */
export function generateWriteKey(): GeneratedWriteKey {
  const plaintext = KEY_LABEL + randomBytes(KEY_BYTES).toString("hex");
  return {
    plaintext,
    hash: hashWriteKey(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LEN),
  };
}

/** SHA-256 hex of a key's plaintext. */
export function hashWriteKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Extract a Bearer token from an Authorization header value. */
export function bearerFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : null;
}

/**
 * Verify a presented write key against the stored hash for an instance.
 *
 * Pass a SERVICE-ROLE client (RLS-bypassing) — the public ingestion routes
 * have no user session. Constant-time comparison; best-effort `last_used_at`
 * touch. Returns true iff the key matches that instance's stored key.
 */
export async function verifyWriteKey(
  sb: SupabaseClient,
  instanceId: number,
  presentedKey: string | null | undefined,
): Promise<boolean> {
  if (!presentedKey) return false;

  const { data, error } = await sb
    .from("byo_write_key")
    .select("key_hash")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (error || !data?.key_hash) return false;

  const presented = Buffer.from(hashWriteKey(presentedKey), "hex");
  const stored = Buffer.from(String(data.key_hash), "hex");
  if (presented.length !== stored.length) return false;
  if (!timingSafeEqual(presented, stored)) return false;

  // best-effort usage timestamp; never blocks the request
  void sb
    .from("byo_write_key")
    .update({ last_used_at: new Date().toISOString() })
    .eq("instance_id", instanceId);

  return true;
}
