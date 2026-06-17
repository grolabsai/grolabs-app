import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { decideSuggestions, DECISIONS, type Decision } from "@/lib/byo/suggestions";

export const runtime = "nodejs";

/**
 * Accept / reject / edit catalog_suggestion proposals — the confirm action.
 *
 *   POST /api/v1/catalog/suggestions/decision
 *     { instance_id, suggestion_ids:[…], decision:"accepted"|"rejected"|"edited", editor_notes? }
 *
 * Sets status + reviewed_at. Write-key authenticated. (Accepted proposals are
 * what the promote step will write to the live catalog.)
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as {
    instance_id?: unknown;
    suggestion_ids?: unknown;
    decision?: unknown;
    editor_notes?: unknown;
  };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  if (
    !Array.isArray(b.suggestion_ids) ||
    b.suggestion_ids.length === 0 ||
    !b.suggestion_ids.every((n) => Number.isInteger(n))
  ) {
    return NextResponse.json({ error: "suggestion_ids_required" }, { status: 400 });
  }
  if (typeof b.decision !== "string" || !(DECISIONS as readonly string[]).includes(b.decision)) {
    return NextResponse.json(
      { error: "invalid_decision", message: `one of: ${DECISIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const result = await decideSuggestions(
    auth.sb,
    auth.instanceId,
    b.suggestion_ids as number[],
    b.decision as Decision,
    typeof b.editor_notes === "string" ? b.editor_notes : null,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: "decision_failed", message: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json({ updated: result.updated, decision: b.decision });
}
