#!/usr/bin/env node
/**
 * B1 emulator — Phase 2 Meilisearch seed.
 *
 * Creates the test index `inst_99999` and loads a tiny synthetic catalog so the
 * emulator's searches return real hits + query_uids. Idempotent: deletes the
 * index first, recreates it, configures the minimal settings the route needs
 * (instance_id MUST be filterable — the proxy filters on it), and adds docs.
 *
 *   npm run emulate:seed        # create + load inst_99999
 *   npm run emulate:teardown    # delete inst_99999
 *
 * Requires MEILISEARCH_HOST + MEILISEARCH_MASTER_KEY (loaded via --env-file).
 * Only ever touches index inst_99999 — never a real tenant index.
 */
import { Meilisearch } from "meilisearch";
import { INDEX_UID, PRODUCTS } from "./scenario.phase2.mjs";

const teardown = process.argv.includes("--teardown");
const host = process.env.MEILISEARCH_HOST;
const apiKey = process.env.MEILISEARCH_MASTER_KEY;
if (!host || !apiKey) {
  // Teardown without creds is a no-op (nothing to drop) — let the emulate chain
  // continue. Seeding without creds is a hard error.
  if (teardown) {
    console.log("· teardown skipped (no Meili creds) — nothing to drop");
    process.exit(0);
  }
  console.error(
    "✗ Missing Meili env. Add MEILISEARCH_HOST + MEILISEARCH_MASTER_KEY to .env.local, then:\n" +
    "    npm run emulate:seed"
  );
  process.exit(1);
}

const client = new Meilisearch({ host, apiKey });

async function waitTask(enqueued) {
  const uid = enqueued?.taskUid ?? enqueued?.uid;
  if (uid == null) return;
  await client.tasks.waitForTask(uid); // v0.58: task helpers live under client.tasks
}

async function dropIndex() {
  try {
    await waitTask(await client.deleteIndex(INDEX_UID));
    console.log(`  dropped ${INDEX_UID}`);
  } catch {
    /* didn't exist — fine */
  }
}

async function main() {
  if (teardown) {
    await dropIndex();
    console.log(`✓ teardown: ${INDEX_UID} removed`);
    return;
  }

  await dropIndex(); // idempotent recreate
  await waitTask(await client.createIndex(INDEX_UID, { primaryKey: "id" }));

  const index = client.index(INDEX_UID);
  await waitTask(
    await index.updateSettings({
      // instance_id filterable is REQUIRED: the /api/v1/search proxy always
      // appends `instance_id = 99999`. category_ids supports the category filter.
      filterableAttributes: ["instance_id", "category_ids", "in_stock", "price"],
      searchableAttributes: ["name", "categories", "description"],
    })
  );
  await waitTask(await index.addDocuments(PRODUCTS));

  const count = await index.getDocuments({ limit: 0 }).then((r) => r.total ?? "?");
  console.log(`✓ seed: ${INDEX_UID} ready (${PRODUCTS.length} products; index reports total=${count})`);
}

main().catch((e) => {
  console.error("✗ seed failed:", e?.message || e);
  process.exit(1);
});
