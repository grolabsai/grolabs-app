"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SEARCH_PROVIDERS, STORE_PLATFORMS } from "@/lib/instance-services";

/**
 * Instance property edits.
 *
 * DELIBERATELY NARROW. Only fields that are descriptive and carry no
 * referential meaning are writable here:
 *
 *   name, primary_locale, default_currency, timezone
 *
 * Everything else is read-only on this screen, each for a reason:
 *   - domain / storefront_domains → identity + routing keys. instance.domain
 *     drives blog host routing and tenant.domain is the Article-3 identity key
 *     used to restrict SSO sign-in. These must not change casually from a
 *     settings form; they need a deliberate migration-or-runbook change with
 *     the downstream effects considered.
 *   - kind → derived from tenant.kind by a database trigger, so writing it
 *     here would be silently reverted.
 *   - slug, plan, is_active, tenant_id → structural or billing state with
 *     references elsewhere.
 *   - the *_config JSONB columns → each owned by its own configuration screen
 *     (GA4, Algolia, analysis…), which is where they stay editable.
 *
 * No service-role client: writes go through the caller's session so the
 * existing `tenant_self_update` RLS policy (owner/admin members only) is the
 * single enforcement point. A non-admin's update simply affects zero rows.
 */

export type UpdateInstanceResult =
  | { ok: true }
  | { ok: false; error: string };

const TIMEZONE_RE = /^[A-Za-z]+\/[A-Za-z_+-]+$|^UTC$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export async function updateInstanceProperties(args: {
  instanceId: number;
  name: string;
  primaryLocale: string;
  defaultCurrency: string;
  timezone: string;
  storePlatform: string;
  searchProvider: string;
  serviceCatalog: boolean;
  serviceAnalytics: boolean;
  serviceSearch: boolean;
  servicePricing: boolean;
}): Promise<UpdateInstanceResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const name = args.name.trim();
  if (name.length === 0) return { ok: false, error: "name_required" };
  if (name.length > 120) return { ok: false, error: "name_too_long" };

  const timezone = args.timezone.trim();
  if (!TIMEZONE_RE.test(timezone)) return { ok: false, error: "invalid_timezone" };

  const primaryLocale = args.primaryLocale.trim();
  if (!LOCALE_RE.test(primaryLocale)) return { ok: false, error: "invalid_locale" };

  const defaultCurrency = args.defaultCurrency.trim().toUpperCase();
  if (!CURRENCY_RE.test(defaultCurrency)) {
    return { ok: false, error: "invalid_currency" };
  }

  // Validate against the same lists the DB CHECK constraints enforce, so a bad
  // value fails with a readable message instead of a Postgres constraint error.
  if (!(STORE_PLATFORMS as readonly string[]).includes(args.storePlatform)) {
    return { ok: false, error: "invalid_store_platform" };
  }
  if (!(SEARCH_PROVIDERS as readonly string[]).includes(args.searchProvider)) {
    return { ok: false, error: "invalid_search_provider" };
  }

  // `select()` so we can tell "RLS refused" (zero rows) apart from success.
  // Without it a forbidden update looks identical to a successful one.
  const { data, error } = await supabase
    .from("instance")
    .update({
      name,
      primary_locale: primaryLocale,
      default_currency: defaultCurrency,
      timezone,
      store_platform: args.storePlatform,
      search_provider: args.searchProvider,
      service_catalog: args.serviceCatalog,
      service_analytics: args.serviceAnalytics,
      service_search: args.serviceSearch,
      service_pricing: args.servicePricing,
      updated_at: new Date().toISOString(),
    })
    .eq("instance_id", args.instanceId)
    .select("instance_id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "not_permitted" };

  // Revalidate the LAYOUT, not just this page: the service flags and platform
  // decide which items the sidebar renders, and the sidebar lives in the (app)
  // layout. Revalidating only the page would save the change but leave the
  // navigation stale until a hard reload.
  revalidatePath("/", "layout");
  return { ok: true };
}
