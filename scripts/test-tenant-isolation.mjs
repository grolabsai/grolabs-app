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
 *   3. Asserts the isolation guarantees, in three tiers:
 *
 *      TIER 1 — READ/WRITE isolation on a known table (`category`)
 *        - a user reads ONLY their own instance's rows (positive control)
 *        - a user CANNOT read the other instance's category / instance rows
 *        - a user CANNOT write a row into the other instance (WITH CHECK)
 *
 *      TIER 2 — PRIVILEGE ESCALATION via the membership pivot  ← the big one
 *        Isolation hinges ENTIRELY on `instance_member.is_current`: RLS calls
 *        current_instance_id(), which returns
 *            select instance_id from instance_member
 *            where user_id = auth.uid() and is_current = true
 *        So if a user can repoint that row — UPDATE their own row's
 *        instance_id, or INSERT a fresh membership row for someone else's
 *        instance — then EVERY table's RLS opens at once, and Tier 1 passing
 *        means nothing. Tier 2 attacks that pivot directly. This is the gap
 *        the original version of this script did not cover.
 *
 *      TIER 3 — BLANKET SWEEP across every instance-scoped table
 *        A freshly-provisioned user owns exactly one row (their category).
 *        So: enumerate every table PostgREST exposes that has an `instance_id`
 *        column (read live from the OpenAPI spec, so new tables are picked up
 *        automatically), and as that user, read each one. ANY row belonging to
 *        an instance that isn't theirs is a leak — including rows from the
 *        REAL instances in this database. Template-instance (0) rows are
 *        reported separately, since template fallthrough is deliberate for
 *        some tables (CLAUDE.md §17).
 *
 *   4. Cleans up everything it created (always, even on failure).
 *
 * Run:
 *   cd grolabs-app
 *   npm run test:isolation -- --yes
 *
 * Requires in .env / .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * NOTE on env precedence: `.env.local` is loaded FIRST and dotenv never
 * overwrites an already-set var, so a leftover `<paste …>` placeholder in
 * `.env.local` silently shadows a real key in `.env`. Preflight rejects
 * placeholder-looking values for exactly that reason.
 *
 * Safety: creates clearly-tagged throwaway data (`isotest-*`) and deletes it
 * afterward. Escalation attempts only ever TARGET the other throwaway world —
 * never a real instance. It still writes to whatever project the URL points
 * at — pass --yes to confirm, and check the printed target URL first.
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
const TEMPLATE_INSTANCE_ID = 0;

// ── tiny assertion harness ────────────────────────────────────────────────
const results = [];
function check(name, pass, detail = "", severity = "normal") {
  results.push({ name, pass, detail, severity });
  const mark = pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${mark}] ${name}${detail ? `  — ${detail}` : ""}`);
}

function looksLikePlaceholder(v) {
  return !v || /^<|paste |your |replace|xxxx|TODO/i.test(v);
}

function preflight() {
  const missing = [];
  if (!URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (looksLikePlaceholder(ANON)) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (looksLikePlaceholder(SERVICE)) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`\nMissing or placeholder env vars: ${missing.join(", ")}`);
    console.error("Remember: .env.local shadows .env — a `<paste …>` line there wins.\n");
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

async function signedInAs(world) {
  const sb = anonClient();
  const { data, error } = await sb.auth.signInWithPassword({
    email: world.email,
    password: world.password,
  });
  if (error || !data?.session) throw new Error(`sign-in failed for ${world.label}: ${error?.message}`);
  return sb;
}

// ── provisioning (mirrors src/lib/actions/instance.ts createInstance) ──────
//
// The world object is pushed onto `worlds` BEFORE it is populated, so a
// mid-way failure still leaves the partial rows visible to cleanup. (The
// earlier version returned the object only on success, orphaning auth users
// and tenants whenever provisioning threw halfway through.)
async function provisionWorld(admin, label, worlds) {
  const world = { label, email: `${TAG}-${label}@example.com`, password: `Pw-${randomUUID()}` };
  worlds.push(world);

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: world.email,
    password: world.password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`[${label}] createUser: ${userErr.message}`);
  world.userId = created.user.id;

  const { data: tenant, error: tErr } = await admin
    .from("tenant")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}`, kind: "customer" })
    .select("tenant_id")
    .single();
  if (tErr) throw new Error(`[${label}] tenant insert: ${tErr.message}`);
  world.tenantId = tenant.tenant_id;

  const { error: tmErr } = await admin
    .from("tenant_member")
    .insert({ tenant_id: world.tenantId, user_id: world.userId, role: "owner", is_active: true });
  if (tmErr) throw new Error(`[${label}] tenant_member insert: ${tmErr.message}`);

  const { data: instance, error: iErr } = await admin
    .from("instance")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}`, kind: "customer", tenant_id: world.tenantId })
    .select("instance_id")
    .single();
  if (iErr) throw new Error(`[${label}] instance insert: ${iErr.message}`);
  world.instanceId = instance.instance_id;

  const { error: imErr } = await admin
    .from("instance_member")
    .insert({ instance_id: world.instanceId, user_id: world.userId, role: "owner", is_active: true, is_current: true });
  if (imErr) throw new Error(`[${label}] instance_member insert: ${imErr.message}`);

  const { data: category, error: cErr } = await admin
    .from("category")
    .insert({
      instance_id: world.instanceId,
      category_name: `${TAG} cat ${label}`,
      slug: `${TAG}-cat-${label}`,
      level: 1,
      is_active: true,
    })
    .select("category_id")
    .single();
  if (cErr) throw new Error(`[${label}] category insert: ${cErr.message}`);
  world.categoryId = category.category_id;

  console.log(
    `  provisioned ${label}: user=${world.userId} tenant=${world.tenantId} instance=${world.instanceId} category=${world.categoryId}`,
  );
  return world;
}

// ── TIER 1: read/write isolation ──────────────────────────────────────────
async function assertIsolation(self, other) {
  const sb = await signedInAs(self);
  check(`${self.label}: can sign in`, true);

  const { data: cur } = await sb.rpc("current_instance_id");
  check(
    `${self.label}: current_instance_id() = own instance`,
    Number(cur) === Number(self.instanceId),
    `got ${cur}, expected ${self.instanceId}`,
  );

  // Positive control: RLS isn't just blocking everything (which would make the
  // negative tests meaningless).
  const ownRead = await sb.from("category").select("category_id").eq("category_id", self.categoryId);
  check(
    `${self.label}: can read OWN category (positive control)`,
    !ownRead.error && (ownRead.data?.length ?? 0) === 1,
    ownRead.error?.message,
  );

  const crossRead = await sb.from("category").select("category_id").eq("category_id", other.categoryId);
  check(
    `${self.label}: CANNOT read other tenant's category`,
    !crossRead.error && (crossRead.data?.length ?? 0) === 0,
    crossRead.error ? `error: ${crossRead.error.message}` : `rows: ${crossRead.data?.length}`,
  );

  const listAll = await sb.from("category").select("category_id, instance_id");
  const leaked = (listAll.data ?? []).filter((r) => Number(r.instance_id) === Number(other.instanceId));
  check(
    `${self.label}: unscoped category list excludes other tenant`,
    !listAll.error && leaked.length === 0,
    leaked.length ? `LEAKED ${leaked.length} row(s) from instance ${other.instanceId}` : "",
  );

  const instRead = await sb.from("instance").select("instance_id").eq("instance_id", other.instanceId);
  check(
    `${self.label}: CANNOT read other tenant's instance row`,
    !instRead.error && (instRead.data?.length ?? 0) === 0,
    instRead.error ? `error: ${instRead.error.message}` : `rows: ${instRead.data?.length}`,
  );

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
  if (!crossWrite.error && crossWrite.data?.[0]?.category_id) {
    intrusions.push(crossWrite.data[0].category_id);
  }

  await sb.auth.signOut();
}

// ── TIER 2: privilege escalation via the membership pivot ─────────────────
//
// current_instance_id() = instance_member.instance_id WHERE user_id = auth.uid()
// AND is_current. Every isolation policy in the DB funnels through that one
// value. If a user can move it, they inherit the target instance wholesale.
async function assertNoEscalation(self, other) {
  const sb = await signedInAs(self);

  // Attack 1 — repoint the existing membership row at the other instance.
  const repoint = await sb
    .from("instance_member")
    .update({ instance_id: other.instanceId })
    .eq("user_id", self.userId)
    .select("member_id, instance_id");
  const repointRows = repoint.data?.length ?? 0;
  check(
    `${self.label}: CANNOT repoint own instance_member at other instance`,
    !!repoint.error || repointRows === 0,
    repoint.error
      ? `blocked with error: ${repoint.error.message}`
      : repointRows === 0
        ? "blocked silently — RLS matched 0 rows"
        : `UPDATE AFFECTED ${repointRows} ROW(S) — CRITICAL ESCALATION`,
    "critical",
  );

  // Attack 2 — grant self a brand-new membership on the other instance.
  const grant = await sb
    .from("instance_member")
    .insert({
      instance_id: other.instanceId,
      user_id: self.userId,
      role: "owner",
      is_active: true,
      is_current: true,
    })
    .select("member_id");
  const grantRows = grant.data?.length ?? 0;
  check(
    `${self.label}: CANNOT self-grant instance_member on other instance`,
    !!grant.error || grantRows === 0,
    grant.error
      ? `blocked with error: ${grant.error.message}`
      : grantRows === 0
        ? "blocked silently — RLS matched 0 rows"
        : `INSERT CREATED ${grantRows} ROW(S) — CRITICAL ESCALATION`,
    "critical",
  );
  if (!grant.error && grant.data?.[0]?.member_id) {
    grantedMemberships.push(grant.data[0].member_id);
  }

  // Attack 3 — join the other tenant at the tenant layer.
  const tGrant = await sb
    .from("tenant_member")
    .insert({ tenant_id: other.tenantId, user_id: self.userId, role: "owner", is_active: true })
    .select("tenant_member_id");
  const tGrantRows = tGrant.data?.length ?? 0;
  check(
    `${self.label}: CANNOT self-grant tenant_member on other tenant`,
    !!tGrant.error || tGrantRows === 0,
    tGrant.error
      ? `blocked with error: ${tGrant.error.message}`
      : tGrantRows === 0
        ? "blocked silently — RLS matched 0 rows"
        : `INSERT CREATED ${tGrantRows} ROW(S) — CRITICAL ESCALATION`,
    "critical",
  );
  if (!tGrant.error && tGrant.data?.[0]?.tenant_member_id) {
    grantedTenantMemberships.push(tGrant.data[0].tenant_member_id);
  }

  // Attack 4 — escalate own role in place (member → owner semantics).
  const roleBump = await sb
    .from("instance_member")
    .update({ role: "owner", is_active: true })
    .eq("user_id", self.userId)
    .neq("instance_id", self.instanceId)
    .select("member_id");
  check(
    `${self.label}: role bump on a foreign membership finds nothing`,
    !!roleBump.error || (roleBump.data?.length ?? 0) === 0,
    roleBump.error ? `blocked: ${roleBump.error.message}` : `rows touched: ${roleBump.data?.length}`,
  );

  // Post-conditions: after all of the above, isolation must still hold.
  const { data: curAfter } = await sb.rpc("current_instance_id");
  check(
    `${self.label}: current_instance_id() UNCHANGED after escalation attempts`,
    Number(curAfter) === Number(self.instanceId),
    `got ${curAfter}, expected ${self.instanceId}`,
    "critical",
  );

  const stillBlind = await sb.from("category").select("category_id").eq("category_id", other.categoryId);
  check(
    `${self.label}: STILL cannot read other tenant's category after attempts`,
    !stillBlind.error && (stillBlind.data?.length ?? 0) === 0,
    stillBlind.error ? `error: ${stillBlind.error.message}` : `rows: ${stillBlind.data?.length}`,
    "critical",
  );

  await sb.auth.signOut();
}

// ── TIER 3: blanket sweep over every instance-scoped table ────────────────
async function discoverInstanceScopedTables() {
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const spec = await res.json();
  const defs = spec.definitions || spec.components?.schemas || {};
  return Object.entries(defs)
    .filter(([, d]) => Object.keys(d.properties || {}).includes("instance_id"))
    .map(([name]) => name)
    .sort();
}

async function sweepAllTables(self, tables) {
  const sb = await signedInAs(self);
  const foreign = [];   // rows from a real/other instance — leaks
  const template = [];  // rows from instance 0 — deliberate fallthrough on some tables
  const unreadable = [];

  for (const table of tables) {
    const r = await sb.from(table).select("instance_id").limit(1000);
    if (r.error) { unreadable.push(`${table} (${r.error.code || "err"})`); continue; }
    // Collect EVERY distinct foreign instance this table exposes — not just
    // the first. Breaking early hides how far a leak actually reaches (e.g.
    // whether the real customer's instance is among them).
    const foreignIds = new Set();
    let sawTemplate = false;
    for (const row of r.data ?? []) {
      const id = Number(row.instance_id);
      if (id === Number(self.instanceId)) continue;
      if (id === TEMPLATE_INSTANCE_ID) { sawTemplate = true; continue; }
      foreignIds.add(id);
    }
    if (sawTemplate) template.push(table);
    if (foreignIds.size) {
      foreign.push({ table, instanceIds: [...foreignIds].sort((x, y) => x - y), rows: r.data.length });
    }
  }

  await sb.auth.signOut();

  const uniqTemplate = [...new Set(template)];
  check(
    `${self.label}: sweep — no foreign-instance rows visible across ${tables.length} tables`,
    foreign.length === 0,
    foreign.length
      ? `LEAKS in ${foreign.length} object(s): ` +
        foreign.map((f) => `${f.table}→instances [${f.instanceIds.join(",")}] (${f.rows} rows)`).join("; ")
      : `clean (${uniqTemplate.length} table(s) expose template instance 0; ${unreadable.length} not readable)`,
    "critical",
  );

  if (uniqTemplate.length) {
    console.log(`      template-instance (0) rows visible in: ${uniqTemplate.join(", ")}`);
  }
  if (unreadable.length) {
    console.log(`      not readable as this user (expected for service-role-only tables): ${unreadable.length}`);
  }
  return { foreign, template: uniqTemplate, unreadable };
}

// ── cleanup ────────────────────────────────────────────────────────────────
const intrusions = [];
const grantedMemberships = [];
const grantedTenantMemberships = [];

async function cleanup(admin, worlds) {
  console.log("\nCleaning up…");
  const catIds = [...worlds.map((w) => w?.categoryId).filter(Boolean), ...intrusions];
  if (catIds.length) await admin.from("category").delete().in("category_id", catIds);

  // Anything an escalation attempt managed to create.
  if (grantedMemberships.length) {
    await admin.from("instance_member").delete().in("member_id", grantedMemberships);
  }
  if (grantedTenantMemberships.length) {
    await admin.from("tenant_member").delete().in("tenant_member_id", grantedTenantMemberships);
  }

  for (const w of worlds) {
    if (!w) continue;
    // Delete memberships by user too, in case an attack created rows elsewhere.
    if (w.userId) {
      await admin.from("instance_member").delete().eq("user_id", w.userId);
      await admin.from("tenant_member").delete().eq("user_id", w.userId);
    }
    if (w.instanceId != null) {
      await admin.from("instance_member").delete().eq("instance_id", w.instanceId);
      await admin.from("instance").delete().eq("instance_id", w.instanceId);
    }
    if (w.tenantId != null) {
      await admin.from("tenant_member").delete().eq("tenant_id", w.tenantId);
      await admin.from("tenant").delete().eq("tenant_id", w.tenantId);
    }
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
  let sweepSummary = null;
  try {
    console.log("Provisioning two isolated worlds…");
    const a = await provisionWorld(admin, "a", worlds);
    const b = await provisionWorld(admin, "b", worlds);

    console.log("\nTIER 1 — read/write isolation (A against B):");
    await assertIsolation(a, b);
    console.log("\nTIER 1 — read/write isolation (B against A):");
    await assertIsolation(b, a);

    console.log("\nTIER 2 — privilege escalation via instance_member (A against B):");
    await assertNoEscalation(a, b);
    console.log("\nTIER 2 — privilege escalation via instance_member (B against A):");
    await assertNoEscalation(b, a);

    console.log("\nTIER 3 — blanket sweep over every instance-scoped table:");
    const tables = await discoverInstanceScopedTables();
    console.log(`  discovered ${tables.length} tables with an instance_id column`);
    sweepSummary = await sweepAllTables(a, tables);
  } catch (err) {
    console.error(`\nProvisioning/test error: ${err.message}`);
    check("provisioning completed without throwing", false, err.message);
  } finally {
    await cleanup(admin, worlds);
  }

  const failed = results.filter((r) => !r.pass);
  const criticalFailed = failed.filter((r) => r.severity === "critical");
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (sweepSummary) {
    console.log(
      `Sweep: ${sweepSummary.foreign.length} leak(s), ` +
      `${sweepSummary.template.length} template-exposing table(s), ` +
      `${sweepSummary.unreadable.length} unreadable.`,
    );
  }
  if (failed.length) {
    console.log(
      `\x1b[31mISOLATION TEST FAILED\x1b[0m${criticalFailed.length ? ` (${criticalFailed.length} CRITICAL)` : ""}` +
      ` — do NOT onboard real clients until these pass:`,
    );
    for (const f of failed) {
      console.log(`  - ${f.severity === "critical" ? "[CRITICAL] " : ""}${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    }
    process.exit(1);
  }
  console.log("\x1b[32mAll isolation checks passed.\x1b[0m");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
