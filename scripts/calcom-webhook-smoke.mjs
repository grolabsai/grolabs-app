#!/usr/bin/env node
/**
 * Live smoke test for the Cal.com → Klaviyo webhook receiver.
 *
 * Fires a correctly-signed delivery for EVERY booking-lifecycle trigger (plus a
 * PING and a tampered-signature negative case) at a deployed endpoint, prints
 * each HTTP response, and checks it against the expected status. This is the
 * "generate each event and watch the rows appear" tool — the automated,
 * pollution-free version lives in tests/unit/integrations/calcom-booking.test.ts.
 *
 * ┌─ SAFETY ──────────────────────────────────────────────────────────────────┐
 * │ Hitting a real deployment writes REAL events to GroLabs's corporate        │
 * │ Klaviyo account (one per mapped trigger). They use clearly-labeled test    │
 * │ emails (webhook-smoke+<trigger>@grolabs.test) so you can suppress/exclude  │
 * │ them, but they DO land. The script refuses any non-localhost URL unless    │
 * │ you pass --yes-prod, to prevent accidental CRM pollution.                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   CALCOM_WEBHOOK_SECRET=<secret> node scripts/calcom-webhook-smoke.mjs \
 *     [--url <endpoint>] [--yes-prod] [--only BOOKING_CREATED,BOOKING_CANCELLED]
 *
 * Examples:
 *   # against a local `npm run dev` (default URL, no Klaviyo unless key is set):
 *   CALCOM_WEBHOOK_SECRET=$SECRET node scripts/calcom-webhook-smoke.mjs
 *
 *   # against production (writes real Klaviyo test events — opt in explicitly):
 *   CALCOM_WEBHOOK_SECRET=$SECRET node scripts/calcom-webhook-smoke.mjs \
 *     --url https://app.grolabs.ai/api/v1/integrations/cal/booking --yes-prod
 *
 * After running, verify the durable rows in Supabase (project `scout`):
 *   select operation_type, status, error_message, payload_summary, target_id, started_at
 *   from backend_operation
 *   where started_at > now() - interval '15 minutes'
 *   order by started_at desc;
 */

import crypto from "node:crypto";

const DEFAULT_URL = "http://localhost:3030/api/v1/integrations/cal/booking";

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const url = opt("url", process.env.WEBHOOK_URL || DEFAULT_URL);
const secret = process.env.CALCOM_WEBHOOK_SECRET;
const onlyArg = opt("only", "");
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;

if (!secret) {
  console.error("✗ CALCOM_WEBHOOK_SECRET is required (must match the deployed env).");
  process.exit(2);
}

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url);
if (!isLocal && !flag("yes-prod")) {
  console.error(
    `✗ Refusing to hit a non-localhost URL without --yes-prod:\n    ${url}\n` +
      "  This writes REAL events to the corporate Klaviyo account. Re-run with --yes-prod if you mean it.",
  );
  process.exit(2);
}

// ── payloads ───────────────────────────────────────────────────────────────
function attendee(trigger) {
  return {
    email: `webhook-smoke+${trigger.toLowerCase()}@grolabs.test`,
    name: "Webhook Smoke",
    timeZone: "America/Mexico_City",
  };
}

function payloadFor(trigger) {
  const uid = `smoke_${trigger}_${process.pid}`;
  const base = {
    uid,
    type: "15min",
    title: "Assessment Call (smoke test)",
    startTime: "2026-06-05T10:00:00.000Z",
    endTime: "2026-06-05T10:15:00.000Z",
    attendees: [attendee(trigger)],
    status: "ACCEPTED",
  };
  if (trigger === "BOOKING_CANCELLED") base.cancellationReason = "smoke-test cancel";
  if (trigger === "BOOKING_REJECTED") base.rejectionReason = "smoke-test reject";
  if (trigger === "BOOKING_RESCHEDULED") base.rescheduleUid = `${uid}_prev`;
  return base;
}

// Each case: trigger, a body builder, whether to send a valid signature, and
// the HTTP status we expect from the receiver.
const CASES = [
  { name: "BOOKING_REQUESTED", expect: 200 },
  { name: "BOOKING_CREATED", expect: 200 },
  { name: "BOOKING_RESCHEDULED", expect: 200 },
  { name: "BOOKING_CANCELLED", expect: 200 },
  { name: "BOOKING_REJECTED", expect: 200 },
  { name: "PING", expect: 200, ignored: true }, // verified but unmapped → ignored_trigger row
  { name: "BAD_SIGNATURE", expect: 401, tamper: true }, // negative case
].filter((c) => !only || only.has(c.name));

function sign(rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

async function send(testCase) {
  const trigger = testCase.tamper ? "BOOKING_CREATED" : testCase.name;
  const body =
    testCase.name === "PING"
      ? { triggerEvent: "PING", createdAt: new Date().toISOString(), payload: {} }
      : {
          triggerEvent: trigger,
          createdAt: new Date().toISOString(),
          payload: payloadFor(trigger),
        };
  const raw = JSON.stringify(body);
  const signature = testCase.tamper ? "0".repeat(64) : sign(raw);

  let status = 0;
  let text = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cal-signature-256": signature,
      },
      body: raw,
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    return { ...testCase, ok: false, status: 0, text: `network error: ${String(err)}` };
  }
  return { ...testCase, ok: status === testCase.expect, status, text };
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`→ target: ${url}`);
console.log(`→ cases:  ${CASES.map((c) => c.name).join(", ")}\n`);

const results = [];
for (const c of CASES) {
  // Sequential on purpose: keeps the backend_operation timeline readable.
  const r = await send(c);
  results.push(r);
  const mark = r.ok ? "✓" : "✗";
  const note = c.ignored ? " (expected ignored_trigger row)" : c.tamper ? " (expected rejection)" : "";
  console.log(`${mark} ${c.name.padEnd(20)} HTTP ${r.status} (want ${c.expect})${note}`);
  if (!r.ok || process.env.VERBOSE) console.log(`    ${r.text}`);
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "✓ all" : `✗ ${failed.length}/${results.length}`} cases returned the expected status.`,
);
console.log(
  "\nNow confirm the durable rows (Supabase project `scout`):\n" +
    "  select operation_type, status, error_message, payload_summary, target_id, started_at\n" +
    "  from backend_operation\n" +
    "  where started_at > now() - interval '15 minutes'\n" +
    "  order by started_at desc;",
);

process.exit(failed.length === 0 ? 0 : 1);
