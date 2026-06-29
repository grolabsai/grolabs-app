/**
 * Shared service-role DB client for the emulator's reset/check steps.
 * Run the scripts that import this with env loaded, e.g.:
 *   node --env-file=.env.local scripts/emulator/check.mjs
 * (the package.json `emulate:*` scripts already do this).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "✗ Missing Supabase env. Run via the npm script (which passes --env-file=.env.local), e.g.\n" +
    "    npm run emulate:check\n" +
    "  or:  node --env-file=.env.local scripts/emulator/check.mjs"
  );
  process.exit(1);
}

export const db = createClient(url, key, { auth: { persistSession: false } });
export const INSTANCE_ID = 99999;
// The routes stamp created_at = now() (UTC), so the scenario is single-day.
export const TODAY = new Date().toISOString().slice(0, 10);
