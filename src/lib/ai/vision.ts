import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to Vercel env to enable AI alt text.",
      );
    }
    _client = new Anthropic();
  }
  return _client;
}

/**
 * Suggest alt text for an image by asking Claude vision to describe it
 * in one sentence, accessibility-style. Returns the trimmed text only —
 * no preamble, no "this image shows…", just the description.
 *
 * The prompt is intentionally hardcoded here (short, generic, won't
 * need per-tenant tuning). If that changes, move to prompt_template
 * (`blog.image.alt_prompt`) like other agent inputs.
 */
export async function suggestAltText(imageUrl: string): Promise<string> {
  if (!imageUrl) throw new Error("Empty image URL");

  const client = getClient();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 200,
    system:
      "You write alt text for blog images. One sentence, 8-15 words, describing what is visually present. No commentary, no preamble, no quotes — just the alt text. Match the language of the surrounding post (auto-detect from context; default to English if unclear).",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: imageUrl },
          },
          {
            type: "text",
            text: "Write alt text for this image.",
          },
        ],
      },
    ],
  });

  const finalMessage = await stream.finalMessage();
  const out: string[] = [];
  for (const block of finalMessage.content) {
    if (block.type === "text") out.push(block.text);
  }
  return out
    .join("")
    .trim()
    .replace(/^["'"]|["'"]$/g, "")
    .replace(/\.$/, "");
}
