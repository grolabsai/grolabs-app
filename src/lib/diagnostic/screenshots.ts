/**
 * Upload PNG screenshots captured by the browser probe to Supabase
 * Storage. Path convention is `<run_id>/<check_code>.png` so the URL
 * is stable per (run, check) and can be computed before the finding
 * is inserted (no chicken-and-egg with finding_id).
 *
 * The bucket (`prospect-evidence`) is public-read; writes go through
 * the service-role client because Storage RLS doesn't grant the
 * authenticated role write access. We mint the service-role client
 * internally so callers don't have to thread it through (and so admin
 * diagnostic runs — which otherwise use the authenticated client —
 * don't silently lose their screenshots).
 *
 * Privacy comes from the unguessable run_id prefix — same access
 * model as the public report page itself.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BUCKET = "prospect-evidence";

export type ScreenshotUploadResult = {
  check_code: string;
  storage_path: string;
  public_url: string;
};

export async function uploadProbeScreenshots(
  runId: string,
  screenshots: Array<{ check_code: string; buffer: Buffer }>,
): Promise<ScreenshotUploadResult[]> {
  if (screenshots.length === 0) return [];
  const supabase = createServiceRoleClient();
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
