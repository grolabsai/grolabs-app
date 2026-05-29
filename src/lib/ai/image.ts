import Replicate from "replicate";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getBrandSystem } from "@/lib/blog/brand";
import { currentInstanceId } from "@/lib/instance";

/**
 * AI image generation — Replicate-backed.
 *
 * Default model is Black Forest Labs' `flux-schnell` (fast + cheap,
 * ~$0.003/image, ~1-2s). The model + prompt template both live in
 * prompt_template so they can be swapped or tuned via Supabase Studio
 * without a deploy.
 *
 * Generated images are uploaded to the `blog-images` bucket alongside
 * cover/inline uploads — same instance-scoped folder convention so RLS
 * and Storage cleanup tooling cover them identically.
 */

let _replicate: Replicate | null = null;
function getReplicate(): Replicate {
  if (!_replicate) {
    if (!process.env.REPLICATE_API_TOKEN) {
      throw new Error(
        "REPLICATE_API_TOKEN is not set. Add it to Vercel env to enable AI image generation.",
      );
    }
    _replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  }
  return _replicate;
}

async function loadPromptTemplate(key: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const instanceId = await currentInstanceId();
  const ids = instanceId === null || instanceId === 0 ? [0] : [instanceId, 0];
  const { data } = await supabase
    .from("prompt_template")
    .select("template, instance_id")
    .in("instance_id", ids)
    .eq("key", key)
    .order("instance_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.template as string | undefined) ?? null;
}

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
}

export interface GenerateImageInput {
  prompt: string;
  postId?: number;
}

export interface GenerateImageResult {
  url: string;
  enhanced_prompt: string;
}

/**
 * Build the brand-aware Replicate prompt. Reads
 * `blog.image.prompt_template` from prompt_template (DB-editable);
 * interpolates the user's intent + the brand palette + illustration
 * style. Falls back to a sane built-in template when the row is
 * missing (e.g. first run before the seed migration).
 */
async function buildEnhancedPrompt(userPrompt: string): Promise<string> {
  const instanceId = await currentInstanceId();
  const brand = await getBrandSystem(instanceId);
  const template =
    (await loadPromptTemplate("blog.image.prompt_template")) ??
    "{{user_prompt}}. Style: {{illustration_style}}. Color palette: primary {{primary_color}}, background {{background_color}}, accent {{accent_color}}. Clean composition, no text, no watermarks.";

  return render(template, {
    user_prompt: userPrompt,
    illustration_style: brand.illustration_style,
    primary_color: brand.primary_color,
    background_color: brand.background_color,
    accent_color: brand.accent_color,
    text_color: brand.text_color,
    body_font: brand.body_font,
    heading_font: brand.heading_font,
    display_name: brand.display_name,
  });
}

/**
 * Run a Replicate model. Model identifier lives in
 * prompt_template `blog.image.model` so it can be swapped (Flux
 * Schnell → Flux Dev → SDXL etc.) without a deploy.
 */
export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  if (!input.prompt.trim()) throw new Error("Empty prompt");

  const enhanced = await buildEnhancedPrompt(input.prompt);
  const model =
    (await loadPromptTemplate("blog.image.model")) ?? "black-forest-labs/flux-schnell";

  const replicate = getReplicate();
  const output = await replicate.run(model as `${string}/${string}`, {
    input: {
      prompt: enhanced,
      aspect_ratio: "16:9",
      output_format: "webp",
      output_quality: 90,
      num_inference_steps: 4,
    },
  });

  // Replicate's output for image models is either a URL string, an
  // array of URL strings, or — for some models — a ReadableStream.
  const url = await normalizeOutputToUrl(output);
  if (!url) throw new Error("Replicate returned no usable output");

  const saved = await uploadFromUrl(url, input.postId);
  return { url: saved, enhanced_prompt: enhanced };
}

async function normalizeOutputToUrl(output: unknown): Promise<string | null> {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof (first as { url?: () => URL }).url === "function") {
      return (first as { url: () => URL }).url().toString();
    }
  }
  if (output && typeof (output as { url?: () => URL }).url === "function") {
    return (output as { url: () => URL }).url().toString();
  }
  return null;
}

async function uploadFromUrl(
  remoteUrl: string,
  postId: number | undefined,
  subfolder: "generated" | "transform" = "generated",
): Promise<string> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) throw new Error("No instance");

  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Failed to fetch generated image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const supabase = createServiceRoleClient();
  const path = `${instanceId}/${subfolder}/${postId ?? "draft"}/${Date.now()}.webp`;
  const { error } = await supabase.storage
    .from("blog-images")
    .upload(path, buf, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from("blog-images").getPublicUrl(path);
  return data.publicUrl;
}

// -----------------------------------------------------------------------
// Image-to-image transforms
// -----------------------------------------------------------------------

export type TransformKind = "restyle" | "recolor" | "conceptualize";

const TRANSFORM_STRENGTH: Record<TransformKind, number> = {
  recolor: 0.35,
  restyle: 0.6,
  conceptualize: 0.75,
};

export interface TransformImageInput {
  sourceUrl: string;
  kind: TransformKind;
  postId?: number;
}

export interface TransformImageResult {
  url: string;
  enhanced_prompt: string;
  kind: TransformKind;
}

async function buildTransformPrompt(kind: TransformKind): Promise<string> {
  const instanceId = await currentInstanceId();
  const brand = await getBrandSystem(instanceId);
  const tpl =
    (await loadPromptTemplate(`blog.image.transform.${kind}`)) ??
    `Transform this image in {{illustration_style}} style. Palette: primary {{primary_color}}, accent {{accent_color}}, background {{background_color}}. No text, no watermarks.`;
  return render(tpl, {
    illustration_style: brand.illustration_style,
    primary_color: brand.primary_color,
    background_color: brand.background_color,
    accent_color: brand.accent_color,
    text_color: brand.text_color,
  });
}

/**
 * Restyle / recolor / conceptualize an uploaded image into the
 * brand's palette + illustration style. Originals stay where they
 * are; the transform is saved to {instance_id}/transform/{post|draft}/.
 * Model + prompt template + strength all swappable via Supabase Studio
 * (`blog.image.transform.model`, `blog.image.transform.{kind}`).
 */
export async function transformImage(
  input: TransformImageInput,
): Promise<TransformImageResult> {
  if (!input.sourceUrl) throw new Error("Empty source URL");

  const enhanced = await buildTransformPrompt(input.kind);
  const model =
    (await loadPromptTemplate("blog.image.transform.model")) ??
    "stability-ai/sdxl";
  const strength = TRANSFORM_STRENGTH[input.kind];

  const replicate = getReplicate();
  const output = await replicate.run(model as `${string}/${string}`, {
    input: {
      prompt: enhanced,
      image: input.sourceUrl,
      prompt_strength: strength,
      refine: "no_refiner",
      num_inference_steps: 25,
      // SDXL-style params; alternative models ignore unknown fields.
    },
  });

  const url = await normalizeOutputToUrl(output);
  if (!url) throw new Error("Replicate returned no usable output");

  const saved = await uploadFromUrl(url, input.postId, "transform");
  return { url: saved, enhanced_prompt: enhanced, kind: input.kind };
}
