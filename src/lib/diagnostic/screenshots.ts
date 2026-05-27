/**
 * Upload PNG screenshots captured by the browser probe to Supabase
 * Storage. Path convention is `<run_id>/<check_code>.png` so the URL
 * is stable per (run, check) and can be computed before the finding
 * is inserted (no chicken-and-egg with finding_id).
 *
 * The bucket (`prospect-evidence`) is public-read; privacy comes from
 * the unguessable run_id prefix — same access model as the public
 * report page itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "prospect-evidence";

export type ScreenshotUploadResult = {
  check_code: string;
  storage_path: string;
  public_url: string;
};

export async function uploadProbeScreenshots(
  supabase: SupabaseClient,
  runId: string,
  screenshots: Array<{ check_code: string; buffer: Buffer }>,
): Promise<ScreenshotUploadResult[]> {
  if (screenshots.length === 0) return [];
  const uploads = await Promise.all(
    screenshots.map(async (ss) => {
      const path = `${runId}/${ss.check_code}.png`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, ss.buffer, {
        contentType: "image/png",
        cacheControl: "31536000",
        upsert: true,
      });
      if (error) {
        console.warn(
          `[screenshots] upload failed for ${ss.check_code}: ${error.message}`,
        );
        return null;
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return {
        check_code: ss.check_code,
        storage_path: path,
        public_url: data.publicUrl,
      };
    }),
  );
  return uploads.filter((u): u is ScreenshotUploadResult => u !== null);
}
