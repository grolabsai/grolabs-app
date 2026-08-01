import "server-only";

/**
 * Server-side resolution of the instance service model.
 *
 * Split from instance-services.ts because that module is reached from the
 * client bundle via the nav builder, and this one imports the Supabase server
 * client (next/headers). Keeping them apart is what lets the sidebar be a
 * client component while the data stays server-resolved.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SERVICES, type InstanceServices, type SearchProvider, type StorePlatform } from "./instance-services";

/**
 * Resolve the current instance's service model.
 *
 * `cache()` dedupes within a request — the layout asks once even though the
 * nav and individual screens may all want it.
 */
export const getCurrentInstanceServices = cache(
  async (instanceId: number | null): Promise<InstanceServices> => {
    if (instanceId == null) return DEFAULT_SERVICES;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("instance")
      .select(
        "store_platform, search_provider, service_catalog, service_analytics, service_search, service_pricing",
      )
      .eq("instance_id", instanceId)
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.error("[instance-services] lookup failed:", error.message);
      }
      return DEFAULT_SERVICES;
    }

    return {
      storePlatform: (data.store_platform as StorePlatform) ?? "proprietary",
      searchProvider: (data.search_provider as SearchProvider) ?? "meilisearch",
      catalog: data.service_catalog !== false,
      analytics: data.service_analytics !== false,
      search: data.service_search !== false,
      pricing: data.service_pricing !== false,
    };
  },
);
