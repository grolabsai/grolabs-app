"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { startDiagnostic } from "@/lib/diagnostic/runner";

export type ContactUpdate = {
  prospect_id: number;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_position?: string | null;
  contact_email?: string | null;
};

export async function updateProspectContact(input: ContactUpdate) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (input.contact_first_name !== undefined)
    patch.contact_first_name = input.contact_first_name?.trim() || null;
  if (input.contact_last_name !== undefined)
    patch.contact_last_name = input.contact_last_name?.trim() || null;
  if (input.contact_position !== undefined)
    patch.contact_position = input.contact_position?.trim() || null;
  if (input.contact_email !== undefined)
    patch.contact_email = input.contact_email?.trim() || null;
  const { error } = await supabase
    .from("prospect")
    .update(patch)
    .eq("prospect_id", input.prospect_id)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidatePath(`/prospects/${input.prospect_id}`, "page");
  revalidatePath("/prospects", "page");
  return { ok: true as const };
}

/**
 * Re-scan one page. Pulls the prospect + URL + page-type assignment
 * from the DB and triggers a diagnostic_run for that single page.
 *
 * Today the runner is run-centric — it always probes one homepage,
 * one PDP, optionally one category. For a per-page re-scan we pass
 * the page's URL into the right slot (pdpUrl/categoryUrl/url) based
 * on its `page_type` so the existing runner does the right thing.
 */
export async function rescanProspectPage(input: { prospectPageId: number }) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();

  const { data: page } = await supabase
    .from("prospect_page")
    .select("prospect_page_id, prospect_id, url, page_type")
    .eq("prospect_page_id", input.prospectPageId)
    .maybeSingle();
  if (!page) return { error: "PAGE_NOT_FOUND" };

  const { data: prospect } = await supabase
    .from("prospect")
    .select("prospect_id, url, display_name, vertical_id")
    .eq("prospect_id", page.prospect_id)
    .maybeSingle();
  if (!prospect) return { error: "PROSPECT_NOT_FOUND" };

  // Build a one-page diagnostic input. The runner still picks a
  // homepage + PDP + (optional) category internally; we route this
  // page's URL into the slot matching its type.
  const result = await startDiagnostic({
    url: prospect.url as string,
    pdpUrl: page.page_type === "pdp" ? (page.url as string) : null,
    categoryUrl: page.page_type === "category" ? (page.url as string) : null,
    prospectName: prospect.display_name as string | null,
    verticalId: prospect.vertical_id as number | null,
  });
  revalidatePath(`/prospects/${page.prospect_id}`, "page");
  revalidatePath(
    `/prospects/${page.prospect_id}/pages/${page.prospect_page_id}`,
    "page",
  );
  return result;
}

/**
 * Re-scan every active page on the prospect in a single diagnostic_run.
 * Walks the runner once with the full {homepage, pdp, category} URL
 * set sourced from prospect_page.
 */
export async function rescanAllProspectPages(input: { prospectId: number }) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();

  const { data: prospect } = await supabase
    .from("prospect")
    .select("prospect_id, url, display_name, vertical_id")
    .eq("prospect_id", input.prospectId)
    .maybeSingle();
  if (!prospect) return { error: "PROSPECT_NOT_FOUND" };

  const { data: pages } = await supabase
    .from("prospect_page")
    .select("prospect_page_id, url, page_type, is_active")
    .eq("prospect_id", input.prospectId)
    .eq("is_active", true);

  const pdpUrl =
    pages?.find((p) => p.page_type === "pdp")?.url ?? null;
  const categoryUrl =
    pages?.find((p) => p.page_type === "category")?.url ?? null;

  const result = await startDiagnostic({
    url: prospect.url as string,
    pdpUrl: pdpUrl as string | null,
    categoryUrl: categoryUrl as string | null,
    prospectName: prospect.display_name as string | null,
    verticalId: prospect.vertical_id as number | null,
  });
  revalidatePath(`/prospects/${input.prospectId}`, "page");
  return result;
}
