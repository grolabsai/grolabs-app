import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sanitizeHtml } from "@/lib/blog/render";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const rawHost = h.get("host") ?? h.get("x-forwarded-host") ?? "localhost";
  const host = rawHost.toLowerCase().split(":")[0];
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${rawHost}`;

  const supabase = createServiceRoleClient();
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("instance_id, name")
    .eq("domain", host)
    .maybeSingle();

  let q = supabase
    .from("post")
    .select(
      "title, slug, summary, content, content_format, published_at, author_id",
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);
  if (instanceRow?.instance_id != null) q = q.eq("instance_id", instanceRow.instance_id);
  const { data: posts } = await q;

  const channelTitle = instanceRow?.name ? `${instanceRow.name} — Blog` : "Blog";

  const items = (posts ?? [])
    .map((p) => {
      const link = `${origin}/blog/${p.slug}`;
      const description =
        p.content_format === "html"
          ? sanitizeHtml(p.content as string)
          : (p.summary as string | null) ?? "";
      return `    <item>
      <title>${xmlEscape(p.title as string)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${p.published_at ? new Date(p.published_at as string).toUTCString() : new Date().toUTCString()}</pubDate>
      <description>${xmlEscape(description)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(channelTitle)}</title>
    <link>${origin}/blog</link>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${xmlEscape(channelTitle)}</description>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
