"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deriveSlug } from "@/lib/instanceSlug";
import { ensureIndex } from "@/lib/search/meilisearch-client";

/**
 * Server actions for multi-instance membership management.
 *
 * Per docs/policy/instance-management.md.
 */

export type SwitchResult =
  | { ok: true; instanceId: number }
  | { ok: false; error: "unauthorized" | "not_a_member" | "save_failed"; message?: string };

export type CreateResult =
  | {
      ok: true;
      instanceId: number;
      slug: string;
      copiedFrom?: string;
      copyWarning?: string;
    }
  | { ok: false; error: "unauthorized" | "invalid_name" | "save_failed"; message?: string };

export type CopyConfigResult =
  | { ok: true; copiedFields: string[]; secretWarnings?: string[] }
  | {
      ok: false;
      error: "unauthorized" | "not_a_member" | "source_not_found" | "save_failed";
      message?: string;
    };

/**
 * A candidate source instance for the "copy configuration" step of the
 * create-instance flow. Only instances the user belongs to that have a
 * non-empty integrations_config are eligible.
 *
 * Values (integration keys, locale, currency) are raw DB data; the dialog
 * maps them to display labels. Per CLAUDE.md §5 (DB is the source of truth).
 */
export type ConfigSource = {
  instanceId: number;
  name: string;
  integrationKeys: string[];
  storefrontDomainCount: number;
  primaryLocale: string;
  defaultCurrency: string;
};

const NAME_MAX_LEN = 80;

/**
 * Fields copied by copyInstanceConfig. Deliberately excludes plan,
 * billing_config, kind, is_active, slug, name, tenant_id, sku_config,
 * pricing_config — and never touches any catalog/audit table.
 */
const COPYABLE_CONFIG_FIELDS = [
  "integrations_config",
  "storefront_domains",
  "primary_locale",
  "supported_locales",
  "default_currency",
] as const;

/**
 * Atomically flip is_current to point at the target instance.
 *
 * Validates the user has an active membership on the target. Then in a single
 * transaction (via service-role to span the user's other rows safely):
 *   - clears is_current on all of the user's memberships
 *   - sets is_current=true on the target
 *
 * The partial unique index on instance_member (user_id) WHERE is_current = true
 * catches any double-set bug at the DB layer.
 *
 * Caller should `router.refresh()` after success so server components re-evaluate
 * their instance scope. We also revalidatePath here to invalidate the layout cache.
 */
export async function switchToInstance(instanceId: number): Promise<SwitchResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  // Membership check uses the user-session client — RLS confirms they can see
  // the row. Keeps is_active here (not is_current): a user can switch to any
  // instance they're an active member of, regardless of which one is current.
  const { data: membership, error: lookupErr } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (lookupErr) {
    return { ok: false, error: "save_failed", message: lookupErr.message };
  }
  if (!membership) return { ok: false, error: "not_a_member" };

  // Service-role for the cross-row update (clearing is_current on rows the user
  // could otherwise see via RLS, but using service role keeps the two updates
  // atomic and isolated from policy edge cases).
  const admin = createServiceRoleClient();

  const { error: clearErr } = await admin
    .from("instance_member")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .neq("instance_id", instanceId);
  if (clearErr) {
    return { ok: false, error: "save_failed", message: clearErr.message };
  }

  const { error: setErr } = await admin
    .from("instance_member")
    .update({ is_current: true, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("instance_id", instanceId);
  if (setErr) {
    return { ok: false, error: "save_failed", message: setErr.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, instanceId };
}

/**
 * Create a new instance. The caller becomes its owner and immediately switches
 * into it (is_current cleared on their other memberships, set on the new one).
 *
 * v1 starts the instance empty: no template seeding, defaults from the schema
 * (kind='customer', es-GT, GTQ, etc.). Per policy §10, template seeding is a
 * separate future feature.
 *
 * Slug uses deriveSlug; on collision a numeric suffix is appended (`-2`, `-3`).
 *
 * Optionally copies configuration from an existing instance the user
 * belongs to (options.copyFromInstanceId). A failed copy does NOT roll
 * back the created instance — it returns ok with a copyWarning instead.
 *
 * Caller should `router.refresh()` after success.
 */
export async function createInstance(
  name: string,
  options?: { copyFromInstanceId?: number },
): Promise<CreateResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LEN) {
    return { ok: false, error: "invalid_name" };
  }
  const baseSlug = deriveSlug(trimmed);
  if (baseSlug.length === 0) {
    return { ok: false, error: "invalid_name" };
  }

  const admin = createServiceRoleClient();

  // Resolve a unique slug. Pull every slug that starts with baseSlug and pick
  // the lowest free suffix. One round-trip; race losers retry inside the insert.
  const { data: collisions, error: collisionErr } = await admin
    .from("instance")
    .select("slug")
    .like("slug", `${baseSlug}%`);
  if (collisionErr) {
    return { ok: false, error: "save_failed", message: collisionErr.message };
  }
  const taken = new Set((collisions ?? []).map((r) => r.slug));
  let slug = baseSlug;
  let suffix = 2;
  while (taken.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  // Resolve the tenant this instance will belong to. instance.tenant_id is
  // NOT NULL (20260513000001) and instance_member inserts require an active
  // tenant_member row for (tenant, user) (trigger from 20260514000001).
  //
  // Policy: a new instance joins the user's existing tenant. If the user has
  // no tenant_member yet, create a customer tenant and make them its owner.
  const { data: existingMemberships, error: tmLookupErr } = await admin
    .from("tenant_member")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (tmLookupErr) {
    return { ok: false, error: "save_failed", message: tmLookupErr.message };
  }

  let tenantId: number;
  const ownerMembership = (existingMemberships ?? []).find(
    (m) => m.role === "owner",
  );
  const anyMembership = (existingMemberships ?? [])[0];
  const reuse = ownerMembership ?? anyMembership;

  if (reuse) {
    tenantId = reuse.tenant_id as number;
  } else {
    // No tenant yet — create one for this user and make them its owner.
    const tenantName = user.email ? user.email.split("@")[0] : trimmed;
    const tenantBaseSlug = deriveSlug(tenantName) || deriveSlug(trimmed) || "tenant";

    const { data: tenantSlugRows, error: tenantSlugErr } = await admin
      .from("tenant")
      .select("slug")
      .like("slug", `${tenantBaseSlug}%`);
    if (tenantSlugErr) {
      return { ok: false, error: "save_failed", message: tenantSlugErr.message };
    }
    const tenantTaken = new Set((tenantSlugRows ?? []).map((r) => r.slug));
    let tenantSlug = tenantBaseSlug;
    let tenantSuffix = 2;
    while (tenantTaken.has(tenantSlug)) {
      tenantSlug = `${tenantBaseSlug}-${tenantSuffix}`;
      tenantSuffix += 1;
    }

    const { data: newTenant, error: tenantInsertErr } = await admin
      .from("tenant")
      .insert({ name: tenantName, slug: tenantSlug, kind: "customer" })
      .select("tenant_id")
      .single();
    if (tenantInsertErr || !newTenant) {
      return {
        ok: false,
        error: "save_failed",
        message: tenantInsertErr?.message ?? "tenant insert returned no row",
      };
    }
    tenantId = newTenant.tenant_id as number;

    const { error: tmInsertErr } = await admin.from("tenant_member").insert({
      tenant_id: tenantId,
      user_id: user.id,
      role: "owner",
      is_active: true,
    });
    if (tmInsertErr) {
      return { ok: false, error: "save_failed", message: tmInsertErr.message };
    }
  }

  const { data: inserted, error: insertErr } = await admin
    .from("instance")
    .insert({ name: trimmed, slug, kind: "customer", tenant_id: tenantId })
    .select("instance_id")
    .single();
  if (insertErr || !inserted) {
    return {
      ok: false,
      error: "save_failed",
      message: insertErr?.message ?? "insert returned no row",
    };
  }
  const newInstanceId = inserted.instance_id as number;

  // Clear is_current on every other membership the user has, so the partial
  // unique index doesn't reject the membership insert below.
  const { error: clearErr } = await admin
    .from("instance_member")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (clearErr) {
    return { ok: false, error: "save_failed", message: clearErr.message };
  }

  const { error: memberErr } = await admin.from("instance_member").insert({
    instance_id: newInstanceId,
    user_id: user.id,
    role: "owner",
    is_active: true,
    is_current: true,
  });
  if (memberErr) {
    return { ok: false, error: "save_failed", message: memberErr.message };
  }

  // Eagerly provision the MeiliSearch index so search works immediately for
  // test instances. Best-effort: a MeiliSearch outage must not fail instance
  // creation — the index is lazily (re)created on first product sync anyway.
  try {
    await ensureIndex(newInstanceId);
  } catch (err) {
    console.warn(
      `[createInstance] ensureIndex(${newInstanceId}) failed; index will be created lazily on first sync:`,
      err,
    );
  }

  let copiedFrom: string | undefined;
  let copyWarning: string | undefined;

  if (options?.copyFromInstanceId != null) {
    const copy = await copyInstanceConfig(
      options.copyFromInstanceId,
      newInstanceId,
    );
    if (copy.ok) {
      const { data: src } = await admin
        .from("instance")
        .select("name")
        .eq("instance_id", options.copyFromInstanceId)
        .maybeSingle();
      copiedFrom = src?.name ?? undefined;
      if (copy.secretWarnings && copy.secretWarnings.length > 0) {
        copyWarning = `Partial secret copy: ${copy.secretWarnings.join(", ")}`;
        console.warn(
          `[createInstance] copyInstanceConfig(${options.copyFromInstanceId} → ${newInstanceId}) succeeded with secret warnings:`,
          copy.secretWarnings,
        );
      }
    } else {
      // Per spec: a failed copy must NOT roll back the created instance.
      copyWarning = copy.message ?? copy.error;
      console.warn(
        `[createInstance] copyInstanceConfig(${options.copyFromInstanceId} → ${newInstanceId}) failed:`,
        copy.error,
        copy.message,
      );
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, instanceId: newInstanceId, slug, copiedFrom, copyWarning };
}

/**
 * List instances the user can copy configuration from: every active
 * membership whose instance has a non-empty integrations_config. Used to
 * populate the source dropdown in the create-instance dialog.
 */
export async function listConfigSources(): Promise<
  { ok: true; sources: ConfigSource[] } | { ok: false; error: string }
> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: memberships, error: memErr } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (memErr) return { ok: false, error: memErr.message };

  const ids = (memberships ?? []).map((m) => m.instance_id as number);
  if (ids.length === 0) return { ok: true, sources: [] };

  const admin = createServiceRoleClient();
  const { data: rows, error: rowsErr } = await admin
    .from("instance")
    .select(
      "instance_id, name, integrations_config, storefront_domains, primary_locale, default_currency",
    )
    .in("instance_id", ids)
    .order("name");
  if (rowsErr) return { ok: false, error: rowsErr.message };

  const sources: ConfigSource[] = (rows ?? [])
    .map((r) => {
      const cfg = (r.integrations_config ?? {}) as Record<string, unknown>;
      const integrationKeys = Object.keys(cfg);
      return {
        instanceId: r.instance_id as number,
        name: (r.name as string) ?? "",
        integrationKeys,
        storefrontDomainCount: ((r.storefront_domains as string[]) ?? []).length,
        primaryLocale: (r.primary_locale as string) ?? "",
        defaultCurrency: (r.default_currency as string) ?? "",
      };
    })
    .filter((s) => s.integrationKeys.length > 0);

  return { ok: true, sources };
}

/**
 * Copy configuration (integrations, locale, currency, storefront domains)
 * from one instance to another. NEVER copies the product catalog, audit
 * data, billing/plan, identity (slug/name/tenant), or sku/pricing config.
 *
 * Authorization: the caller must hold an active membership on BOTH the
 * source and the target instance.
 */
export async function copyInstanceConfig(
  sourceInstanceId: number,
  targetInstanceId: number,
): Promise<CopyConfigResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  if (sourceInstanceId === targetInstanceId) {
    return { ok: false, error: "save_failed", message: "source equals target" };
  }

  const { data: memberRows, error: memErr } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .in("instance_id", [sourceInstanceId, targetInstanceId]);
  if (memErr) return { ok: false, error: "save_failed", message: memErr.message };
  const memberOf = new Set((memberRows ?? []).map((r) => r.instance_id as number));
  if (!memberOf.has(sourceInstanceId) || !memberOf.has(targetInstanceId)) {
    return { ok: false, error: "not_a_member" };
  }

  const admin = createServiceRoleClient();
  const { data: source, error: srcErr } = await admin
    .from("instance")
    .select(
      "integrations_config, storefront_domains, primary_locale, supported_locales, default_currency",
    )
    .eq("instance_id", sourceInstanceId)
    .maybeSingle();
  if (srcErr) return { ok: false, error: "save_failed", message: srcErr.message };
  if (!source) return { ok: false, error: "source_not_found" };

  const src = source as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of COPYABLE_CONFIG_FIELDS) patch[field] = src[field];

  const { error: updErr } = await admin
    .from("instance")
    .update(patch)
    .eq("instance_id", targetInstanceId);
  if (updErr) return { ok: false, error: "save_failed", message: updErr.message };

  // Per-integration Vault secrets are not part of integrations_config and must
  // be copied separately. The RPCs check auth.uid() membership on the target,
  // which exists by now (caller is an active member; createInstance inserts
  // the membership before invoking the copy). Failures here do NOT fail the
  // whole copy — the instance is already created and the JSONB config is
  // already in place; we just record a warning.
  const integrationsConfig = (src.integrations_config ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const secretWarnings: string[] = [];

  await copyWooCommerceSecret(
    sb,
    sourceInstanceId,
    targetInstanceId,
    integrationsConfig.woocommerce,
    secretWarnings,
  );
  await copyAlgoliaSecret(
    sb,
    admin,
    sourceInstanceId,
    targetInstanceId,
    integrationsConfig.algolia,
    secretWarnings,
  );
  await copyGa4Secret(
    sb,
    sourceInstanceId,
    targetInstanceId,
    integrationsConfig.ga4,
    secretWarnings,
  );

  return {
    ok: true,
    copiedFields: [...COPYABLE_CONFIG_FIELDS],
    secretWarnings: secretWarnings.length > 0 ? secretWarnings : undefined,
  };
}

type SbClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Copy the WooCommerce consumer secret from source's Vault entry to target's.
 * site_url and consumer_key live in integrations_config and are already
 * copied by the bulk JSONB copy; the save RPC merges (does not clobber) so
 * re-passing them here is safe.
 *
 * Skipped silently when source has no woocommerce sub-key or no Vault secret.
 * On failure, appends to warnings — never throws.
 */
async function copyWooCommerceSecret(
  sb: SbClient,
  sourceInstanceId: number,
  targetInstanceId: number,
  wcConfig: Record<string, unknown> | undefined,
  warnings: string[],
): Promise<void> {
  if (!wcConfig) return;
  const siteUrl = typeof wcConfig.site_url === "string" ? wcConfig.site_url : "";
  const consumerKey =
    typeof wcConfig.consumer_key === "string" ? wcConfig.consumer_key : "";
  if (!siteUrl || !consumerKey) return;

  try {
    const { data: secret, error: getErr } = await sb.rpc(
      "woocommerce_get_consumer_secret",
      { p_instance_id: sourceInstanceId },
    );
    if (getErr) {
      console.warn(
        `[copyInstanceConfig] woocommerce_get_consumer_secret(${sourceInstanceId}) failed:`,
        getErr.message,
      );
      warnings.push("woocommerce_secret_read_failed");
      return;
    }
    if (!secret) {
      // No secret on file for source — nothing to copy. Expected when WC was
      // configured without ever saving (or partially).
      return;
    }

    const { error: saveErr } = await sb.rpc("woocommerce_save_credentials", {
      p_instance_id: targetInstanceId,
      p_site_url: siteUrl,
      p_consumer_key: consumerKey,
      p_consumer_secret: String(secret),
    });
    if (saveErr) {
      console.warn(
        `[copyInstanceConfig] woocommerce_save_credentials(${targetInstanceId}) failed:`,
        saveErr.message,
      );
      warnings.push("woocommerce_secret_write_failed");
      return;
    }
    console.log(
      `[copyInstanceConfig] WooCommerce consumer secret copied to instance ${targetInstanceId}`,
    );
  } catch (err) {
    console.warn(
      `[copyInstanceConfig] WooCommerce secret copy threw for instance ${targetInstanceId}:`,
      err instanceof Error ? err.message : String(err),
    );
    warnings.push("woocommerce_secret_copy_failed");
  }
}

/**
 * Copy the Algolia admin key. Note that algolia_save_credentials replaces the
 * entire integrations_config.algolia sub-key with only the 4 credential fields
 * (no COALESCE merge in the migration), so after calling it we re-apply the
 * source's full algolia sub-key from the JSONB we already have in memory to
 * restore last_verified_at / last_http_status / last_verified_latency_ms.
 */
async function copyAlgoliaSecret(
  sb: SbClient,
  admin: AdminClient,
  sourceInstanceId: number,
  targetInstanceId: number,
  algoliaConfig: Record<string, unknown> | undefined,
  warnings: string[],
): Promise<void> {
  if (!algoliaConfig) return;
  const appId = typeof algoliaConfig.app_id === "string" ? algoliaConfig.app_id : "";
  const region = typeof algoliaConfig.region === "string" ? algoliaConfig.region : "";
  const searchKey =
    typeof algoliaConfig.search_api_key === "string"
      ? algoliaConfig.search_api_key
      : "";
  const primaryIndex =
    typeof algoliaConfig.primary_index === "string"
      ? algoliaConfig.primary_index
      : "";
  if (!appId || !region) return;

  try {
    const { data: adminKey, error: getErr } = await sb.rpc(
      "algolia_get_admin_key",
      { p_instance_id: sourceInstanceId },
    );
    if (getErr) {
      console.warn(
        `[copyInstanceConfig] algolia_get_admin_key(${sourceInstanceId}) failed:`,
        getErr.message,
      );
      warnings.push("algolia_secret_read_failed");
      return;
    }
    if (!adminKey) return;

    const { error: saveErr } = await sb.rpc("algolia_save_credentials", {
      p_instance_id: targetInstanceId,
      p_app_id: appId,
      p_region: region,
      p_search_key: searchKey,
      p_admin_key: String(adminKey),
      p_index: primaryIndex,
    });
    if (saveErr) {
      console.warn(
        `[copyInstanceConfig] algolia_save_credentials(${targetInstanceId}) failed:`,
        saveErr.message,
      );
      warnings.push("algolia_secret_write_failed");
      return;
    }

    // Restore the full algolia sub-key from source — save clobbers everything
    // except the 4 credential fields it was passed.
    const { data: targetRow, error: readErr } = await admin
      .from("instance")
      .select("integrations_config")
      .eq("instance_id", targetInstanceId)
      .maybeSingle();
    if (!readErr && targetRow) {
      const merged = {
        ...((targetRow.integrations_config ?? {}) as Record<string, unknown>),
        algolia: {
          ...algoliaConfig,
        },
      };
      await admin
        .from("instance")
        .update({ integrations_config: merged })
        .eq("instance_id", targetInstanceId);
    }
    console.log(
      `[copyInstanceConfig] Algolia admin key copied to instance ${targetInstanceId}`,
    );
  } catch (err) {
    console.warn(
      `[copyInstanceConfig] Algolia secret copy threw for instance ${targetInstanceId}:`,
      err instanceof Error ? err.message : String(err),
    );
    warnings.push("algolia_secret_copy_failed");
  }
}

/**
 * Copy the GA4 OAuth refresh token. Note that this shares the OAuth grant
 * across the source and target instance — revoking it from Google will affect
 * both. Acceptable for "copy configuration" semantics; users disconnect and
 * reconnect per instance when they want isolation.
 */
async function copyGa4Secret(
  sb: SbClient,
  sourceInstanceId: number,
  targetInstanceId: number,
  ga4Config: Record<string, unknown> | undefined,
  warnings: string[],
): Promise<void> {
  if (!ga4Config) return;
  const propertyId =
    typeof ga4Config.property_id === "string" ? ga4Config.property_id : "";
  const email =
    typeof ga4Config.oauth_account_email === "string"
      ? ga4Config.oauth_account_email
      : "";
  if (!propertyId || !email) return;

  try {
    const { data: refreshToken, error: getErr } = await sb.rpc(
      "ga4_get_refresh_token",
      { p_instance_id: sourceInstanceId },
    );
    if (getErr) {
      console.warn(
        `[copyInstanceConfig] ga4_get_refresh_token(${sourceInstanceId}) failed:`,
        getErr.message,
      );
      warnings.push("ga4_secret_read_failed");
      return;
    }
    if (!refreshToken) return;

    const { error: saveErr } = await sb.rpc("ga4_save_credentials", {
      p_instance_id: targetInstanceId,
      p_property_id: propertyId,
      p_oauth_account_email: email,
      p_refresh_token: String(refreshToken),
    });
    if (saveErr) {
      console.warn(
        `[copyInstanceConfig] ga4_save_credentials(${targetInstanceId}) failed:`,
        saveErr.message,
      );
      warnings.push("ga4_secret_write_failed");
      return;
    }
    console.log(
      `[copyInstanceConfig] GA4 refresh token copied to instance ${targetInstanceId}`,
    );
  } catch (err) {
    console.warn(
      `[copyInstanceConfig] GA4 secret copy threw for instance ${targetInstanceId}:`,
      err instanceof Error ? err.message : String(err),
    );
    warnings.push("ga4_secret_copy_failed");
  }
}
