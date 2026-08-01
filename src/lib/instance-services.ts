/**
 * The instance's service model — what platform it runs on, which search
 * backend it uses, and which GroLabs services it has.
 *
 * This is what shapes the left navigation: a menu item is present because the
 * instance is *modelled* as having that service, not because credentials
 * happen to exist. "Bought search but hasn't connected it yet" is a real
 * state and has to be representable.
 *
 * This module is deliberately PURE — types and constants only, no database
 * access. The nav builder is reached from a client component, so anything it
 * imports ends up in the client bundle; pulling in the Supabase server client
 * (which uses next/headers) breaks the build. The query lives in
 * instance-services.server.ts.
 *
 * Schema: migration 20260801170000.
 */

export type StorePlatform = "shopify" | "woocommerce" | "medusa" | "proprietary";
export type SearchProvider = "algolia" | "meilisearch";

export const STORE_PLATFORMS: StorePlatform[] = [
  "shopify",
  "woocommerce",
  "medusa",
  "proprietary",
];
export const SEARCH_PROVIDERS: SearchProvider[] = ["algolia", "meilisearch"];

export interface InstanceServices {
  storePlatform: StorePlatform;
  searchProvider: SearchProvider;
  catalog: boolean;
  analytics: boolean;
  search: boolean;
  pricing: boolean;
}

/**
 * Fallback when nothing can be resolved (signed out, no membership, query
 * error). Everything ON — the navigation should never silently collapse
 * because of an infrastructure hiccup. A menu item that shouldn't be there is
 * a cosmetic problem; a missing one looks like data loss.
 */
export const DEFAULT_SERVICES: InstanceServices = {
  storePlatform: "proprietary",
  searchProvider: "meilisearch",
  catalog: true,
  analytics: true,
  search: true,
  pricing: true,
};
