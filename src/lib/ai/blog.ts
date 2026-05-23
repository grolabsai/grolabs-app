import Anthropic from "@anthropic-ai/sdk";

/**
 * Single Anthropic client per process. Server-only — never import from a
 * client component. ANTHROPIC_API_KEY is read from the environment.
 */
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

/**
 * House voice for the blog. v1 is a single static string; v2 (per the
 * blog policy doc §6.2) will read this from `instance.brand_system.voice_guide`
 * so each tenant gets their own voice.
 */
const DEFAULT_VOICE = `Tone: clear, direct, no fluff. Sentence-level concrete.
Avoid: marketing-speak, hedging ("perhaps", "might be worth"), filler intros ("In today's fast-paced…").
Prefer: concrete examples over abstractions; short paragraphs; second-person ("you") over first-person plural ("we").`;

function systemPrompt(voice: string = DEFAULT_VOICE): string {
  return `You are an editor helping a writer publish posts on their blog. ${voice}

Output exactly what the user asked for and nothing else. No preamble like "Here's…" or "Here are some options:". No closing meta-commentary. Match the language of the post (Spanish/English) automatically from context.`;
}

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

interface CompleteOpts {
  prompt: string;
  maxTokens: number;
  voice?: string;
}

/**
 * Server-side streaming wrapper. Uses `stream.finalMessage()` to avoid SDK
 * HTTP timeouts on longer outputs while still returning the full text to
 * the caller. The streaming benefit here is timeout resilience, not
 * incremental UI updates — client-side streaming is a v2 concern.
 */
async function complete({ prompt, maxTokens, voice }: CompleteOpts): Promise<string> {
  const client = getClient();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: maxTokens,
    system: systemPrompt(voice),
    messages: [{ role: "user", content: prompt }],
  });

  const finalMessage = await stream.finalMessage();
  const out: string[] = [];
  for (const block of finalMessage.content) {
    if (block.type === "text") out.push(block.text);
  }
  return out.join("").trim();
}

// -----------------------------------------------------------------------
// Public operations
// -----------------------------------------------------------------------

export interface PostContext {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  contentFormat?: "markdown" | "html";
}

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

/**
 * Suggest 3 title options for the current post. Returns one per line.
 */
export async function suggestTitles(ctx: PostContext): Promise<string[]> {
  if (!ctx.content?.trim()) {
    throw new Error("Cannot suggest a title for empty content");
  }
  const text = await complete({
    maxTokens: 400,
    prompt: `Suggest 3 candidate titles for the post below. Output exactly 3 lines, one title per line. No numbering, no quotes, no commentary.

${contextBlock(ctx)}`,
  });
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").replace(/^["'"]|["'"]$/g, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Generate a single SEO summary (1–2 sentences, ~155 chars) for the post.
 */
export async function generateSummary(ctx: PostContext): Promise<string> {
  if (!ctx.content?.trim()) {
    throw new Error("Cannot generate a summary for empty content");
  }
  return complete({
    maxTokens: 250,
    prompt: `Write a single SEO meta description for the post below. 1–2 sentences, aim for ~155 characters, never exceed 200. State what the reader learns and why it matters. Output only the description.

${contextBlock(ctx)}`,
  });
}

/**
 * Continue writing from the end of the current content. Returns ~1–2
 * paragraphs that pick up where the post leaves off.
 */
export async function continueWriting(ctx: PostContext): Promise<string> {
  if (!ctx.content?.trim()) {
    throw new Error("Cannot continue empty content");
  }
  return complete({
    maxTokens: 800,
    prompt: `Continue the post below from where it ends. Write 1–2 paragraphs (~120 words) that extend the line of thought naturally. Do not summarize what was already said. Do not start with a transitional phrase like "Furthermore" or "Additionally". Just keep writing.

${contextBlock(ctx)}`,
  });
}

export type RewriteAction =
  | "shorter"
  | "longer"
  | "clearer"
  | "formal"
  | "casual"
  | "grammar";

const REWRITE_INSTRUCTIONS: Record<RewriteAction, string> = {
  shorter: "Make it shorter and tighter without losing meaning. Cut filler.",
  longer: "Expand it with one concrete example or specific detail. Don't pad.",
  clearer:
    "Rewrite for maximum clarity. Replace abstractions with concrete language. Keep the same meaning.",
  formal: "Rewrite in a more formal, professional register.",
  casual: "Rewrite in a more conversational, casual register.",
  grammar:
    "Fix grammar, spelling, and punctuation. Keep the voice and structure intact. Don't rewrite for style.",
};

export interface RewriteInput {
  selection: string;
  action: RewriteAction;
  context?: PostContext;
}

/**
 * Rewrite a selection. Returns only the rewritten text (no quotes, no
 * preamble), so the editor can drop it back where the selection was.
 */
export async function rewriteSelection(input: RewriteInput): Promise<string> {
  if (!input.selection.trim()) {
    throw new Error("Cannot rewrite an empty selection");
  }
  const surrounding = input.context?.content
    ? `\n\nFor context, the surrounding post is:\n${
        input.context.contentFormat === "html"
          ? stripHtml(input.context.content)
          : input.context.content
      }`
    : "";

  return complete({
    maxTokens: Math.min(2000, Math.max(400, input.selection.length * 4)),
    prompt: `Rewrite the SELECTION below. ${REWRITE_INSTRUCTIONS[input.action]}

Output only the rewritten text — no quotes, no preamble, no commentary. Match the original language.

SELECTION:
${input.selection}${surrounding}`,
  });
}
