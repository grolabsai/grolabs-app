/**
 * Load .env / .env.local into process.env for tests. The Next runtime does
 * this for `next dev` / `next build`, but Vitest doesn't go through Next, so
 * we wire it explicitly. Files are looked up relative to the repo root.
 *
 * Variables already set in the shell win over .env values, so CI can inject
 * test-specific secrets without editing files.
 */
import { config as dotenvConfig } from "dotenv";
import path from "path";

const root = path.resolve(__dirname, "..");
dotenvConfig({ path: path.join(root, ".env.local"), override: false });
dotenvConfig({ path: path.join(root, ".env"),       override: false });
