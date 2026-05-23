import { ImageResponse } from "next/og";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { instanceIdForHost } from "@/lib/blog/host";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Blog post";

/**
 * Generated OpenGraph image — used when a post has no cover_image_url.
 * When a cover IS set, `generateMetadata` in page.tsx overrides
 * `openGraph.images` with the cover URL, so this route is the fallback.
 *
 * Branded text-only card: title on cream background with serif type.
 * Read post by slug + host-scoped instance, matching the public page.
 */
export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const instanceId = await instanceIdForHost();

  const supabase = createServiceRoleClient();
  let q = supabase
    .from("post")
    .select("title, summary, instance_id")
    .eq("slug", slug)
    .eq("status", "published");
  if (instanceId !== null) q = q.eq("instance_id", instanceId);
  const { data } = await q.maybeSingle();

  const title = (data?.title as string | undefined) ?? "Blog";
  const summary = (data?.summary as string | undefined) ?? "";

  // Tenant name pulled lazily for the footer line.
  let tenantName = "";
  const dataInstanceId = data?.instance_id as number | undefined;
  if (dataInstanceId !== undefined) {
    const { data: instanceRow } = await supabase
      .from("instance")
      .select("name")
      .eq("instance_id", dataInstanceId)
      .maybeSingle();
    tenantName = (instanceRow?.name as string | undefined) ?? "";
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#F4F1EA",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 28,
              color: "#9C5530",
              letterSpacing: 2,
              textTransform: "uppercase",
              fontFamily: "sans-serif",
            }}
          >
            {tenantName || "Blog"}
          </div>
          <div
            style={{
              fontSize: title.length > 60 ? 64 : 80,
              fontWeight: 700,
              color: "#1A1612",
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>
          {summary ? (
            <div
              style={{
                fontSize: 32,
                color: "#5C5247",
                lineHeight: 1.3,
                fontStyle: "italic",
              }}
            >
              {summary.length > 140 ? summary.slice(0, 137) + "…" : summary}
            </div>
          ) : null}
        </div>

        <div
          style={{
            fontSize: 22,
            color: "#9C5530",
            fontFamily: "sans-serif",
            letterSpacing: 1,
          }}
        >
          /blog/{slug}
        </div>
      </div>
    ),
    { ...size },
  );
}
