"use server";

import { createClient } from "@/lib/supabase/server";

export type SynonymResult = {
  ok: boolean;
  objectId?: string;
  taskId?: number;
  error?: string;
};

export async function addSynonym(
  query: string,
  synonym: string
): Promise<SynonymResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "Not authorized" };

  const instanceId: number = membership.instance_id;

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("id", instanceId)
    .maybeSingle();

  type AlgoliaConfig = { app_id?: string; primary_index?: string };
  const algolia: AlgoliaConfig =
    (instanceRow?.integrations_config as { algolia?: AlgoliaConfig })
      ?.algolia ?? {};

  if (!algolia.app_id || !algolia.primary_index) {
    return { ok: false, error: "Algolia not configured" };
  }

  const { data: adminKey } = await supabase.rpc("algolia_get_admin_key", {
    p_instance_id: instanceId,
  });
  if (!adminKey) return { ok: false, error: "Admin key not found" };

  const objectID = `scout_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const url = `https://${algolia.app_id}.algolia.net/1/indexes/${encodeURIComponent(algolia.primary_index)}/synonyms/${objectID}?forwardToReplicas=true`;

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "x-algolia-application-id": algolia.app_id,
        "x-algolia-api-key": adminKey as string,
        "accept": "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        objectID,
        type: "synonym",
        synonyms: [query, synonym],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return { ok: true, objectId: objectID, taskId: data.taskID };
    } else {
      const errData = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: (errData as { message?: string }).message ?? `Algolia error: ${res.status}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}
