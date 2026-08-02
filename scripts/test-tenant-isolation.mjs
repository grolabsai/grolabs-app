/**
 * Tenant/instance isolation test — turns the #1 MVP go-live gate from
 * "assumed" to "proven" (see docs/go-live.md → M1 P0).
 *
 * What it does:
 *   1. Provisions TWO independent worlds (A and B), each mirroring the real
 *      createInstance() recipe in src/lib/actions/instance.ts:
 *        auth user → tenant → tenant_member → instance → instance_member
 *        → one seeded `category` row.
 *   2. Signs in as each user with the ANON key (so RLS + the JWT apply, exactly
 *      like the app).
 *   3. Asserts the isolation guarantees:
 *        - a user reads ONLY their own instance's rows (positive control)
 *        - a user CANNOT read the other instance's category / instance rows
 *        - a user CANNOT write a row into the other instance (WITH CHECK)
 *   4. Cleans up everything it created (always, even on failure).
 *
 * Isolation mechanism under test (from the migrations):
 *   RLS policies use `instance_id = current_instance_id()`, where
 *   current_instance_id() = the user's instance_member row WHERE is_current.
 *
 * Run:
 *   cd grolabs-app
 *   node scripts/test-tenant-isolation.mjs --yes
 *
 * Requires in .env.local (or the environment):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety: creates clearly-tagged throwaway data and deletes it afterward. It
 * still writes to whatever project the URL points at — pass --yes to confirm,
 * and check the printed target URL before running against production.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

loadEnv({ path: ".env.local" });
loadEnv(); // fall back to process env / .env

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TAG = `isotest-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

// ── tiny assertion harness ────────────────────────────────────────────────
const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${mark}] ${name}${detail ? `  — ${detail}` : ""}`);
}

function preflight() {
  const missing = [];
  if (!URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!ANON) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!SERVICE) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`\nMissing env vars: ${missing.join(", ")}`);
    console.error("Fill them in grolabs-app/.env.local and re-run.\n");
    process.exit(2);
  }
  if (!process.argv.includes("--yes")) {
    console.error(`\nThis will create + delete throwaway data in:\n  ${URL}\n`);
    console.error("Re-run with --yes to confirm.\n");
    process.exit(2);
  }
}

function anonClient() {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── provisioning (mirrors src/lib/actions/instance.ts createInstance) ──────
async function provisionWorld(admin, label) {
  const email = `${TAG}-${label}@example.com`;
  const password = `Pw-${randomUUID()}`;

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`[${label}] createUser: ${userErr.message}`);
  const userId = created.user.id;

  const { data: tenant, error: tErr } = await admin
    .from("tenant")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}`, kind: "customer" })
    .select("tenant_id")
    .single();
  if (tErr) throw new Error(`[${label}] tenant insert: ${tErr.message}`);

  const { error: tmErr } = await admin
    .from("tenant_member")
    .insert({ tenant_id: tenant.tenant_id, user_id: userId, role: "owner", is_active: true });
  if (tmErr) throw new Error(`[${label}] tenant_member insert: ${tmErr.message}`);

  const { data: instance, error: iErr } = await admin
    .from("instance")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}`, kind: "customer", tenant_id: tenant.tenant_id })
    .select("instance_id")
    .single();
  if (iErr) throw new Error(`[${label}] instance insert: ${iErr.message}`);

  const { error: imErr } = await admin
    .from("instance_member")
    .insert({ instance_id: instance.instance_id, user_id: userId, role: "owner", is_active: true, is_current: true });
  if (imErr) throw new Error(`[${label}] instance_member insert: ${imErr.message}`);

  const { data: category, error: cErr } = await admin
    .from("category")
    .insert({
      instance_id: instance.instance_id,
      category_name: `${TAG} cat ${label}`,
      slug: `${TAG}-cat-${label}`,
      level: 1,
      is_active: true,
    })
    .select("category_id")
    .single();
  if (cErr) throw new Error(`[${label}] category insert: ${cErr.message}`);

  console.log(
    `  provisioned ${label}: user=${userId} tenant=${tenant.tenant_id} instance=${instance.instance_id} category=${category.category_id}`,
  );
  return {
    label,
    email,
    password,
    userId,
    tenantId: tenant.tenant_id,
    instanceId: instance.instance_id,
    categoryId: category.category_id,
  };
}

// ── the isolation assertions ───────────────────────────────────────────────
async function assertIsolation(self, other) {
  const sb = anonClient();
  const { data: signIn, error: signErr } = await sb.auth.signInWithPassword({
    email: self.email,
    password: self.password,
  });
  check(`${self.label}: can sign in`, !signErr && !!signIn?.session, signErr?.message);
  if (signErr) return;

  // current_instance_id() should resolve to this user's instance.
  const { data: cur } = await sb.rpc("current_instance_id");
  check(
    `${self.label}: current_instance_id() = own instance`,
    Number(cur) === Number(self.instanceId),
    `got ${cur}, expected ${self.instanceId}`,
  );

  // Positive control: the user CAN see their own category (RLS isn't just
  // blocking everything, which would make the negative tests meaningless).
  const ownRead = await sb.from("category").select("category_id").eq("category_id", self.categoryId);
  check(
    `${self.label}: can read OWN category (positive control)`,
    !ownRead.error && (ownRead.data?.length ?? 0) === 1,
    ownRead.error?.message,
  );

  // Negative: targeted read of the OTHER tenant's category → must be empty.
  const crossRead = await sb.from("category").select("category_id").eq("category_id", other.categoryId);
  check(
    `${self.label}: CANNOT read other tenant's category`,
    !crossRead.error && (crossRead.data?.length ?? 0) === 0,
    crossRead.error ? `error: ${crossRead.error.message}` : `rows: ${crossRead.data?.length}`,
  );

  // Negative: unscoped list must not contain the other tenant's row.
  const listAll = await sb.from("category").select("category_id, instance_id");
  const leaked = (listAll.data ?? []).filter((r) => Number(r.instance_id) === Number(other.instanceId));
  check(
    `${self.label}: unscoped category list excludes other tenant`,
    !listAll.error && leaked.length === 0,
    leaked.length ? `LEAKED ${leaked.length} row(s) from instance ${other.instanceId}` : "",
  );

  // Negative: cannot read the other tenant's `instance` row.
  const instRead = await sb.from("instance").select("instance_id").eq("instance_id", other.instanceId);
  check(
    `${self.label}: CANNOT read other tenant's instance row`,
    !instRead.error && (instRead.data?.length ?? 0) === 0,
    instRead.error ? `error: ${instRead.error.message}` : `rows: ${instRead.data?.length}`,
  );

  // Negative (write): inserting into the other tenant's instance must be
  // rejected by the WITH CHECK clause. A success here is a CRITICAL leak.
  const crossWrite = await sb.from("category").insert({
    instance_id: other.instanceId,
    category_name: `${TAG} INTRUSION ${self.label}`,
    slug: `${TAG}-intrusion-${self.label}`,
    level: 1,
    is_active: true,
  }).select("category_id");
  const writeBlocked = !!crossWrite.error || (crossWrite.data?.length ?? 0) === 0;
  check(
    `${self.label}: CANNOT write into other tenant (WITH CHECK)`,
    writeBlocked,
    crossWrite.error ? `blocked: ${crossWrite.error.message}` : "INSERT SUCCEEDED — CRITICAL",
  );
  // If the intrusion somehow inserted, record its id so cleanup removes it.
  if (!crossWrite.error && crossWrite.data?.[0]?.category_id) {
    intrusions.push(crossWrite.data[0].category_id);
  }

  await sb.auth.signOut();
}

// ── cleanup ────────────────────────────────────────────────────────────────
const intrusions = [];
async function cleanup(admin, worlds) {
  console.log("\nCleaning up…");
  // categories (incl. any intrusion rows) → instance_member → instance →
  // tenant_member → tenant → auth users. Order respects FKs.
  const catIds = [...worlds.map((w) => w?.categoryId).filter(Boolean), ...intrusions];
  if (catIds.length) await admin.from("category").delete().in("category_id", catIds);
  for (const w of worlds) {
    if (!w) continue;
    await admin.from("instance_member").delete().eq("instance_id", w.instanceId);
    await admin.from("instance").delete().eq("instance_id", w.instanceId);
    await admin.from("tenant_member").delete().eq("tenant_id", w.tenantId);
    await admin.from("tenant").delete().eq("tenant_id", w.tenantId);
    if (w.userId) {
      const { error } = await admin.auth.admin.deleteUser(w.userId);
      if (error) console.warn(`  warn: could not delete user ${w.userId}: ${error.message}`);
    }
  }
  console.log("Cleanup done.");
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  preflight();
  console.log(`\nTenant isolation test  (target: ${URL})`);
  console.log(`Run tag: ${TAG}\n`);

  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const worlds = [];
  try {
    console.log("Provisioning two isolated worlds…");
    worlds.push(await provisionWorld(admin, "a"));
    worlds.push(await provisionWorld(admin, "b"));
    const [a, b] = worlds;

    console.log("\nAsserting isolation (A against B):");
    await assertIsolation(a, b);
    console.log("\nAsserting isolation (B against A):");
    await assertIsolation(b, a);
  } catch (err) {
    console.error(`\nProvisioning/test error: ${err.message}`);
    check("provisioning completed without throwing", false, err.message);
  } finally {
    await cleanup(admin, worlds);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("\x1b[31mISOLATION TEST FAILED\x1b[0m — do NOT onboard real clients until these pass:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("\x1b[32mAll isolation checks passed.\x1b[0m");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
