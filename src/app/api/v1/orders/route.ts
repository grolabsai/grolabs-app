import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * POST /api/v1/orders
 *
 * Order ingestion — the canonical revenue entity. Idempotent UPSERT on
 * (instance_id, order_id): re-receiving the same order can never double-count.
 * Source-agnostic — the WooCommerce plugin (server-side, on payment_complete)
 * and the BYO SDK both post the same shape.
 *
 * Trust model identical to /api/v1/events: instance_id is public, the Origin is
 * validated against instance.storefront_domains, no auth header from the caller.
 */
export const runtime = "nodejs";

function corsify(res: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function deny(origin: string | null, status = 403): NextResponse {
  return corsify(NextResponse.json({ error: "instance_not_found_or_origin_not_authorized" }, { status }), origin);
}
function originToHost(origin: string | null): string | null {
  if (!origin) return null;
  try { return new URL(origin).hostname; } catch { return null; }
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}

type OrderBody = {
  instance_id?: unknown;
  orderId?: unknown;
  amount?: unknown;
  currency?: unknown;
  itemCount?: unknown;
  totalQuantity?: unknown;
  userId?: unknown;
  accountId?: unknown;
  cartId?: unknown;
  source?: unknown;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const host = originToHost(origin);

  let body: unknown;
  try { body = await req.json(); } catch { return deny(origin, 400); }
  if (!body || typeof body !== "object") return deny(origin, 400);
  const b = body as OrderBody;

  const rawInstanceId = b.instance_id;
  const instanceId =
    typeof rawInstanceId === "number" ? rawInstanceId
    : typeof rawInstanceId === "string" && rawInstanceId.length > 0 ? Number(rawInstanceId)
    : Number.NaN;
  if (!Number.isFinite(instanceId) || !Number.isInteger(instanceId) || instanceId < 0) return deny(origin, 400);
  if (!host) return deny(origin);

  const orderId = typeof b.orderId === "string" ? b.orderId.slice(0, 128) : (b.orderId == null ? "" : String(b.orderId).slice(0, 128));
  if (!orderId) return deny(origin, 400);

  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
    return Number.isFinite(n) ? n : null;
  };
  const amount = num(b.amount) ?? 0;
  const itemCount = (() => { const n = num(b.itemCount); return n == null ? null : Math.max(0, Math.round(n)); })();
  const totalQuantity = (() => { const n = num(b.totalQuantity); return n == null ? null : Math.max(0, Math.round(n)); })();
  const currency = typeof b.currency === "string" && b.currency.trim() !== "" ? b.currency.slice(0, 8) : "USD";
  const userId = typeof b.userId === "string" ? b.userId.slice(0, 128) : null;
  const accountId = typeof b.accountId === "string" ? b.accountId.slice(0, 128) : null;
  const cartId = typeof b.cartId === "string" ? b.cartId.slice(0, 128) : null;
  const source = typeof b.source === "string" && b.source.trim() !== "" ? b.source.slice(0, 32) : "woocommerce";

  const sb = createServiceRoleClient();
  const { data: row, error } = await sb
    .from("instance")
    .select("instance_id, is_active, storefront_domains")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (error) { console.error("[orders] instance lookup failed:", error.message); return deny(origin); }
  if (!row || !row.is_active) return deny(origin);
  const domains: string[] = Array.isArray(row.storefront_domains) ? row.storefront_domains : [];
  if (!domains.includes(host)) return deny(origin);

  // Idempotent: upsert on the (instance_id, order_id) primary key.
  const { error: upErr } = await sb.from("sales_order").upsert(
    {
      instance_id: instanceId, order_id: orderId, amount, currency,
      item_count: itemCount, total_quantity: totalQuantity,
      user_id: userId, account_id: accountId, cart_id: cartId, source,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "instance_id,order_id" },
  );
  if (upErr) {
    console.error("[orders] upsert failed:", upErr.message);
    return corsify(NextResponse.json({ error: "order_recording_failed" }, { status: 500 }), origin);
  }
  return corsify(NextResponse.json({ ok: true }, { status: 200 }), origin);
}
