"use server";

import { currentInstanceId } from "@/lib/instance";
import {
  suggestTitles,
  generateSummary,
  continueWriting,
  rewriteSelection,
  type PostContext,
  type RewriteAction,
} from "@/lib/ai/blog";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function gate(): Promise<{ ok: true } | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "No instance" };
  return { ok: true };
}

function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn().then(
    (data) => ({ ok: true as const, data }),
    (err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "AI request failed",
    }),
  );
}

export async function aiSuggestTitles(ctx: PostContext): Promise<Result<string[]>> {
  const g = await gate();
  if (!g.ok) return g;
  return wrap(() => suggestTitles(ctx));
}

export async function aiGenerateSummary(ctx: PostContext): Promise<Result<string>> {
  const g = await gate();
  if (!g.ok) return g;
  return wrap(() => generateSummary(ctx));
}

export async function aiContinueWriting(ctx: PostContext): Promise<Result<string>> {
  const g = await gate();
  if (!g.ok) return g;
  return wrap(() => continueWriting(ctx));
}

export async function aiRewriteSelection(input: {
  selection: string;
  action: RewriteAction;
  context?: PostContext;
}): Promise<Result<string>> {
  const g = await gate();
  if (!g.ok) return g;
  return wrap(() => rewriteSelection(input));
}
