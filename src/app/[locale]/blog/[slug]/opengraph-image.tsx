import { ImageResponse } from "next/og";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { instanceIdForHost } from "@/lib/blog/host";
import { getBrandSystem } from "@/lib/blog/brand";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Blog post";

/**
 * Generated OpenGraph image — used when a post has no cover_image_url.
 * Reads `brand_system` for the post's instance so each tenant's
 * social cards match their own colors + heading font.
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
  const postInstanceId = data?.instance_id as number | undefined;

  const brand = await getBrandSystem(postInstanceId ?? instanceId);

  // next/og supports font-family CSS strings but not custom font loading
  // without explicit Font registration. We pass the brand's heading_font
  // string through; the serif/sans fallback chain ensures something renders.

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: brand.background_color,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: brand.heading_font,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 28,
              color: brand.primary_color,
              letterSpacing: 2,
              textTransform: "uppercase",
              fontFamily: brand.body_font,
            }}
          >
            {brand.display_name || "Blog"}
          </div>
          <div
            style={{
              fontSize: title.length > 60 ? 64 : 80,
              fontWeight: 700,
              color: brand.text_color,
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>
          {summary ? (
            <div
              style={{
                fontSize: 32,
                color: brand.muted_color,
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
            color: brand.primary_color,
            fontFamily: brand.body_font,
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
