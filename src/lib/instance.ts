import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the current instance_id for the authenticated user.
 *
 * Per D26, every row in every table is scoped to an `instance_id`.
 * Customer instances (kind='customer') hold tenant data; template
 * instances (kind='template') are GroLabs-owned source data used only
 * during signup and ops flows.
 *
 * RLS now allows authenticated users to see ONLY rows in their own
 * instance — template rows are reachable only via service-role.
 * That means callers no longer need to add an explicit instance_id
 * filter in most cases, but it's still good practice for clarity
 * and for double-protection against bugs in RLS configuration.
 *
 * React's `cache()` dedupes calls within a single request so even if
 * multiple server components ask, we hit the DB once.
 */
export const currentInstanceId = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_instance_id");
  if (error) {
    console.error("[currentInstanceId] RPC failed:", error);
    return null;
  }
  if (typeof data === "number") return data;
  if (typeof data === "string") return Number(data);
  return null;
});
