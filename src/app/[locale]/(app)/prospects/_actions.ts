"use server";

import { revalidatePath } from "next/cache";
import {
  startDiagnostic as runStartDiagnostic,
  type StartDiagnosticInput,
} from "@/lib/diagnostic/runner";

export async function startDiagnostic(input: StartDiagnosticInput) {
  if (!input.url || !input.url.trim()) {
    return { error: "EMPTY_URL" };
  }
  const result = await runStartDiagnostic(input);
  revalidatePath("/prospects", "page");
  if ("ok" in result) {
    revalidatePath(`/prospects/runs/${result.runId}`, "page");
  }
  return result;
}
