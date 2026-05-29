import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getBrandSystem } from "@/lib/blog/brand";

/**
 * Blog AI module — prompts come from the `prompt_template` table, not
 * code. The `key` argument to `loadPrompt()` matches the row's `key`
 * column. Resolution order: the writer's instance wins, instance 0
 * (GroLabs template) is the fallback. Edit prompts via Supabase Studio
 * — no deploy needed.
 *
 * See docs/policy/blog.md §AI and supabase/migrations/20260523000004_prompt_template.sql.
 */

// -----------------------------------------------------------------------
// Anthropic client (lazy, server-only)
// -----------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to Vercel env to enable AI features.",
      );
    }
    _client = new Anthropic();
  }
  return _client;
}

// -----------------------------------------------------------------------
// Prompt loading + rendering
// -----------------------------------------------------------------------

/**
 * Load a prompt row by key. Falls back from the writer's instance to
 * instance 0 (template) via `.in(...)` + ORDER BY DESC + LIMIT 1.
 * Throws if neither resolves — that means the seed is missing.
 */
async function loadPrompt(key: string): Promise<string> {
  const instanceId = await currentInstanceId();
  const supabase = await createClient();
  const ids = instanceId === null || instanceId === 0 ? [0] : [instanceId, 0];
  const { data, error } = await supabase
    .from("prompt_template")
    .select("template, instance_id")
    .in("instance_id", ids)
    .eq("key", key)
    .order("instance_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`prompt_template lookup failed for "${key}": ${error.message}`);
  if (!data) throw new Error(`prompt_template missing for "${key}". Re-run the seed migration.`);
  return data.template as string;
}

/**
 * Substitute `{{name}}` placeholders. Unknown placeholders render empty
 * (intentional — lets the caller pass a partial set without errors).
 */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Strip HTML tags for context delivery to the model. Tiptap content is
 * stored as HTML; the model doesn't need the markup, just the text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PostContext {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  contentFormat?: "markdown" | "html";
}

/**
 * Assemble the post context block injected into every prompt. Kept in
 * code (not in DB) because it has conditional logic — fields are
 * omitted when empty rather than rendered as "(none)".
 */
function contextBlock(ctx: PostContext): string {
  const lines: string[] = [];
  if (ctx.title) lines.push(`Title: ${ctx.title}`);
  if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
  if (ctx.content) {
    const text =
      ctx.contentFormat === "html" ? stripHtml(ctx.content) : ctx.content;
    lines.push(`Content:\n${text}`);
  }
  return lines.join("\n\n");
}

interface CompleteOpts {
  systemKey?: string;
  userPrompt: string;
  maxTokens: number;
}

/**
 * Resolve the voice guide for the current writer's instance.
 *   1. brand_system.voice_guide for that instance (if non-empty)
 *   2. brand_system.voice_guide for instance 0 (if non-empty)
 *   3. prompt_template `blog.voice_default` row (legacy fallback)
 * This is the place per-post writing_strategy.voice_guide will hook in
 * later (consulting agent PR).
 */
async function resolveVoice(): Promise<string> {
  const instanceId = await currentInstanceId();
  const brand = await getBrandSystem(instanceId);
  if (brand.voice_guide?.trim()) return brand.voice_guide;
  return loadPrompt("blog.voice_default");
}

async function buildSystem(systemKey: string): Promise<string> {
  const [systemTemplate, voice] = await Promise.all([
    loadPrompt(systemKey),
    resolveVoice(),
  ]);
  return render(systemTemplate, { voice_guide: voice });
}

/**
 * Server-side streaming wrapper. Uses `stream.finalMessage()` to avoid
 * SDK HTTP timeouts on longer outputs while still returning the full
 * text. Streaming benefit here is timeout resilience; client-side
 * streaming is a v2 concern.
 */
async function complete({
  systemKey = "blog.system_prompt",
  userPrompt,
  maxTokens,
}: CompleteOpts): Promise<string> {
  const system = await buildSystem(systemKey);
  const client = getClient();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  const finalMessage = await stream.finalMessage();
  const out: string[] = [];
  for (const block of finalMessage.content) {
    if (block.type === "text") out.push(block.text);
  }
  return out.join("").trim();
}

// -----------------------------------------------------------------------
// Public operations — each loads its prompt template from the DB
// -----------------------------------------------------------------------

export async function suggestTitles(ctx: PostContext): Promise<string[]> {
  if (!ctx.content?.trim()) {
    throw new Error("Cannot suggest a title for empty content");
  }
  const template = await loadPrompt("blog.suggest_titles");
  const text = await complete({
    maxTokens: 400,
    userPrompt: render(template, { post_context: contextBlock(ctx) }),
  });
  return text
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*[-•*\d.)]+\s*/, "")
        .replace(/^["'"]|["'"]$/g, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 3);
}

export async function generateSummary(ctx: PostContext): Promise<string> {
  if (!ctx.content?.trim()) {
    throw new Error("Cannot generate a summary for empty content");
  }
  const template = await loadPrompt("blog.generate_summary");
  return complete({
    maxTokens: 250,
    userPrompt: render(template, { post_context: contextBlock(ctx) }),
  });
}

export async function continueWriting(ctx: PostContext): Promise<string> {
  if (!ctx.content?.trim()) {
    throw new Error("Cannot continue empty content");
  }
  const template = await loadPrompt("blog.continue_writing");
  return complete({
    maxTokens: 800,
    userPrompt: render(template, { post_context: contextBlock(ctx) }),
  });
}

export type RewriteAction =
  | "shorter"
  | "longer"
  | "clearer"
  | "formal"
  | "casual"
  | "grammar";

export interface RewriteInput {
  selection: string;
  action: RewriteAction;
  context?: PostContext;
}

export async function rewriteSelection(input: RewriteInput): Promise<string> {
  if (!input.selection.trim()) {
    throw new Error("Cannot rewrite an empty selection");
  }
  const [template, instruction] = await Promise.all([
    loadPrompt("blog.rewrite.template"),
    loadPrompt(`blog.rewrite.instruction.${input.action}`),
  ]);

  const surrounding = input.context?.content
    ? `\n\nFor context, the surrounding post is:\n${
        input.context.contentFormat === "html"
          ? stripHtml(input.context.content)
          : input.context.content
      }`
    : "";

  return complete({
    maxTokens: Math.min(2000, Math.max(400, input.selection.length * 4)),
    userPrompt: render(template, {
      instruction,
      selection: input.selection,
      surrounding_context: surrounding,
    }),
  });
}
