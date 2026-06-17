import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { validateDocuments, MAX_VALIDATE_BATCH } from "@/lib/byo/validate";

export const runtime = "nodejs";

/**
 * Dry-run validation — checks a batch of product documents against the canonical
 * ProductObject shape and returns precise, per-document errors. Writes NOTHING.
 *
 *   POST /api/v1/catalog/validate  { instance_id, documents[] }
 *
 * Lets a client's dev (or their AI agent) self-correct before sending real data,
 * killing the back-and-forth. Write-key authenticated. Plan: P13.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as { instance_id?: unknown; documents?: unknown };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  if (!Array.isArray(b.documents)) {
    return NextResponse.json({ error: "documents_required" }, { status: 400 });
  }
  if (b.documents.length === 0) {
    return NextResponse.json({ error: "documents_empty" }, { status: 400 });
  }
  if (b.documents.length > MAX_VALIDATE_BATCH) {
    return NextResponse.json(
      { error: "batch_too_large", message: `max ${MAX_VALIDATE_BATCH} documents per request` },
      { status: 400 },
    );
  }

  const report = validateDocuments(b.documents);
  return NextResponse.json(report, { status: 200 });
}
