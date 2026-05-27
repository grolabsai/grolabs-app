/**
 * System-health probes. Each function runs on the server, checks one
 * integration's configuration + reachability, and returns a typed
 * HealthCheck row. The /configuration/system-health page renders the
 * results.
 *
 * Probes are deliberately cheap — no quota-burning external calls
 * (e.g., we don't run a PSI lookup just to confirm the key works).
 * Presence of the env var + a single /health hit is enough to catch
 * 90% of misconfigurations.
 */

import { createClient } from "@/lib/supabase/server";

export type HealthStatus = "ok" | "warn" | "error" | "disabled";

export type HealthCheck = {
  id: string;
  name: string;
  status: HealthStatus;
  /** One-line user-facing summary, e.g. "Reachable in 142ms". */
  summary: string;
  /** Optional longer detail / next steps. */
  detail?: string;
  /** Env vars relevant to this check, with their set/unset state. Values are never returned. */
  envVars: Array<{ name: string; set: boolean; required: boolean }>;
  /** Optional latency for endpoint checks. */
  latencyMs?: number;
};

const FETCH_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeoutId);
  }
}

function envPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

// ── ASE ────────────────────────────────────────────────────────────────────

async function checkAse(): Promise<HealthCheck> {
  const envVars = [{ name: "ASE_API_URL", set: envPresent("ASE_API_URL"), required: true }];
  const url = process.env.ASE_API_URL;
  if (!url) {
    return {
      id: "ase",
      name: "ASE — Agentic Services Engine",
      status: "error",
      summary: "ASE_API_URL not set",
      detail:
        "Configure ASE_API_URL in Vercel env vars (Production + Preview). " +
        "Without it, every PDP/site-signals scorer returns ERROR.",
      envVars,
    };
  }
  const base = url.replace(/\/+$/, "");
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${base}/health`);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        id: "ase",
        name: "ASE — Agentic Services Engine",
        status: "error",
        summary: `${base}/health returned HTTP ${res.status}`,
        detail:
          "ASE is reachable but its health endpoint is failing. Check the Railway deploy " +
          "and confirm the service is running.",
        envVars,
        latencyMs,
      };
    }
    // Bonus: also confirm /tools endpoints exist (diagnostic needs them).
    let toolsOk = false;
    try {
      const oapi = await fetchWithTimeout(`${base}/openapi.json`);
      if (oapi.ok) {
        const json = (await oapi.json()) as { paths?: Record<string, unknown> };
        const paths = Object.keys(json.paths ?? {});
        toolsOk =
          paths.includes("/tools/pdp-signals") && paths.includes("/tools/site-signals");
      }
    } catch {
      // openapi probe is best-effort
    }
    return {
      id: "ase",
      name: "ASE — Agentic Services Engine",
      status: toolsOk ? "ok" : "warn",
      summary: toolsOk
        ? `Reachable, /tools endpoints present (${latencyMs}ms)`
        : `Reachable but /tools/pdp-signals or /tools/site-signals missing`,
      detail: toolsOk
        ? undefined
        : "The diagnostic runner needs /tools/pdp-signals and /tools/site-signals. " +
          "Railway is probably deploying an older commit — trigger a redeploy from main.",
      envVars,
      latencyMs,
    };
  } catch (e) {
    const latencyMs = Date.now() - start;
    return {
      id: "ase",
      name: "ASE — Agentic Services Engine",
      status: "error",
      summary: "Unreachable",
      detail: `Could not connect to ${base}/health: ${
        e instanceof Error ? e.message : String(e)
      }`,
      envVars,
      latencyMs,
    };
  }
}

// ── Google PageSpeed Insights ─────────────────────────────────────────────

function checkPsi(): HealthCheck {
  const envVars = [
    { name: "GOOGLE_PSI_API_KEY", set: envPresent("GOOGLE_PSI_API_KEY"), required: false },
    { name: "PROSPECTOS_PSI_ENABLED", set: envPresent("PROSPECTOS_PSI_ENABLED"), required: false },
  ];
  const enabled = process.env.PROSPECTOS_PSI_ENABLED !== "0";
  if (!enabled) {
    return {
      id: "psi",
      name: "Google PageSpeed Insights",
      status: "disabled",
      summary: "PROSPECTOS_PSI_ENABLED=0 — disabled by flag",
      detail: "Core Web Vitals check will return NA. Set PROSPECTOS_PSI_ENABLED=1 to enable.",
      envVars,
    };
  }
  if (!envPresent("GOOGLE_PSI_API_KEY")) {
    return {
      id: "psi",
      name: "Google PageSpeed Insights",
      status: "warn",
      summary: "GOOGLE_PSI_API_KEY not set",
      detail:
        "Core Web Vitals scorer will fail to fetch PSI data. Mint a free key at " +
        "console.cloud.google.com → Enable PageSpeed Insights API → Credentials → API key.",
      envVars,
    };
  }
  return {
    id: "psi",
    name: "Google PageSpeed Insights",
    status: "ok",
    summary: "API key configured",
    detail: "Key presence verified; we don't burn quota on a probe call.",
    envVars,
  };
}

// ── Browser probe (Playwright) ────────────────────────────────────────────

function checkBrowserProbe(): HealthCheck {
  const envVars = [
    {
      name: "PROSPECTOS_BROWSER_PROBE_ENABLED",
      set: envPresent("PROSPECTOS_BROWSER_PROBE_ENABLED"),
      required: false,
    },
  ];
  const enabled = process.env.PROSPECTOS_BROWSER_PROBE_ENABLED === "1";
  if (!enabled) {
    return {
      id: "browser-probe",
      name: "Browser probe (Playwright)",
      status: "disabled",
      summary: "Flag off — browser-driven scorers return NA",
      detail:
        "Empty-state, search-relevance, synonym, and typo-tolerance scorers need a real " +
        "browser. Vercel can't host Playwright; you'd need Browserless, Railway worker, " +
        "or @sparticuz/chromium. Enable by setting PROSPECTOS_BROWSER_PROBE_ENABLED=1 " +
        "*after* deploying that host.",
      envVars,
    };
  }
  return {
    id: "browser-probe",
    name: "Browser probe (Playwright)",
    status: "ok",
    summary: "Flag on",
    detail: "Browser-driven scorers will attempt to run. Failures will be reflected per-check.",
    envVars,
  };
}

// ── Anthropic (blog AI, vertical classifier) ──────────────────────────────

function checkAnthropic(): HealthCheck {
  const envVars = [
    { name: "ANTHROPIC_API_KEY", set: envPresent("ANTHROPIC_API_KEY"), required: false },
  ];
  if (!envPresent("ANTHROPIC_API_KEY")) {
    return {
      id: "anthropic",
      name: "Anthropic (Claude)",
      status: "warn",
      summary: "ANTHROPIC_API_KEY not set",
      detail:
        "Blog AI assist and vertical-classifier tie-breaker will degrade gracefully " +
        "(blog AI disabled; classifier falls back to keyword scoring only).",
      envVars,
    };
  }
  return {
    id: "anthropic",
    name: "Anthropic (Claude)",
    status: "ok",
    summary: "API key configured",
    envVars,
  };
}

// ── Replicate (blog AI image gen) ─────────────────────────────────────────

function checkReplicate(): HealthCheck {
  const envVars = [
    { name: "REPLICATE_API_TOKEN", set: envPresent("REPLICATE_API_TOKEN"), required: false },
  ];
  if (!envPresent("REPLICATE_API_TOKEN")) {
    return {
      id: "replicate",
      name: "Replicate (blog images)",
      status: "warn",
      summary: "REPLICATE_API_TOKEN not set",
      detail: "Blog AI image generation will be disabled. All other features continue normally.",
      envVars,
    };
  }
  return {
    id: "replicate",
    name: "Replicate (blog images)",
    status: "ok",
    summary: "API token configured",
    envVars,
  };
}

// ── Meilisearch ────────────────────────────────────────────────────────────

function checkMeilisearch(): HealthCheck {
  const envVars = [
    { name: "MEILISEARCH_HOST", set: envPresent("MEILISEARCH_HOST"), required: false },
    { name: "MEILISEARCH_MASTER_KEY", set: envPresent("MEILISEARCH_MASTER_KEY"), required: false },
  ];
  const hostSet = envPresent("MEILISEARCH_HOST");
  const keySet = envPresent("MEILISEARCH_MASTER_KEY");
  if (!hostSet && !keySet) {
    return {
      id: "meilisearch",
      name: "Meilisearch (search)",
      status: "warn",
      summary: "Not configured",
      detail:
        "Storefront search won't work. Set MEILISEARCH_HOST + MEILISEARCH_MASTER_KEY to enable.",
      envVars,
    };
  }
  if (!hostSet || !keySet) {
    return {
      id: "meilisearch",
      name: "Meilisearch (search)",
      status: "error",
      summary: "Partially configured",
      detail: "Both MEILISEARCH_HOST and MEILISEARCH_MASTER_KEY must be set together.",
      envVars,
    };
  }
  return {
    id: "meilisearch",
    name: "Meilisearch (search)",
    status: "ok",
    summary: "Host + key configured",
    envVars,
  };
}

// ── Supabase ───────────────────────────────────────────────────────────────

async function checkSupabase(): Promise<HealthCheck> {
  const envVars = [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      set: envPresent("NEXT_PUBLIC_SUPABASE_URL"),
      required: true,
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      set: envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      required: true,
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      set: envPresent("SUPABASE_SERVICE_ROLE_KEY"),
      required: true,
    },
  ];
  const start = Date.now();
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("vertical").select("vertical_id").limit(1);
    const latencyMs = Date.now() - start;
    if (error) {
      return {
        id: "supabase",
        name: "Supabase (Postgres + Auth)",
        status: "error",
        summary: `Query failed: ${error.message}`,
        envVars,
        latencyMs,
      };
    }
    return {
      id: "supabase",
      name: "Supabase (Postgres + Auth)",
      status: "ok",
      summary: `Reachable in ${latencyMs}ms`,
      envVars,
      latencyMs,
    };
  } catch (e) {
    return {
      id: "supabase",
      name: "Supabase (Postgres + Auth)",
      status: "error",
      summary: "Connection failed",
      detail: e instanceof Error ? e.message : String(e),
      envVars,
    };
  }
}

// ── Build info ─────────────────────────────────────────────────────────────

function checkBuild(): HealthCheck {
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";
  const date = process.env.NEXT_PUBLIC_BUILD_DATE ?? "unknown";
  return {
    id: "build",
    name: "Build",
    status: sha === "dev" ? "warn" : "ok",
    summary: `${sha} · ${date}`,
    detail:
      sha === "dev"
        ? "Running a local/dev build. SHA is set by Vercel from VERCEL_GIT_COMMIT_SHA."
        : undefined,
    envVars: [
      { name: "NEXT_PUBLIC_BUILD_SHA", set: envPresent("NEXT_PUBLIC_BUILD_SHA"), required: false },
      { name: "NEXT_PUBLIC_BUILD_DATE", set: envPresent("NEXT_PUBLIC_BUILD_DATE"), required: false },
    ],
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export async function runHealthChecks(): Promise<HealthCheck[]> {
  // Probes run in parallel — total wall-clock = slowest probe (capped at FETCH_TIMEOUT_MS).
  const [ase, supabase] = await Promise.all([checkAse(), checkSupabase()]);
  return [
    checkBuild(),
    ase,
    supabase,
    checkPsi(),
    checkBrowserProbe(),
    checkAnthropic(),
    checkReplicate(),
    checkMeilisearch(),
  ];
}
