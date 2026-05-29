"use server";

import { currentInstanceId } from "@/lib/instance";
import {
  generateImage,
  transformImage,
  type GenerateImageResult,
  type TransformImageResult,
  type TransformKind,
} from "@/lib/ai/image";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function aiGenerateImage(
  prompt: string,
  postId?: number,
): Promise<Result<GenerateImageResult>> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "No instance" };
  try {
    const data = await generateImage({ prompt, postId });
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Image generation failed",
    };
  }
}

export async function aiTransformImage(input: {
  sourceUrl: string;
  kind: TransformKind;
  postId?: number;
}): Promise<Result<TransformImageResult>> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "No instance" };
  try {
    const data = await transformImage(input);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Image transform failed",
    };
  }
}
