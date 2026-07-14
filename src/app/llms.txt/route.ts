import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/**
 * /llms.txt — the AEO surface. Plain-text site map for LLM crawlers.
 * Format: <https://llmstxt.org/> — short title + description, then a
 * bulleted list of canonical content URLs.
 */
export async function GET() {
  const h = await headers();
  const rawHost = h.get("host") ?? h.get("x-forwarded-host") ?? "localhost";
  const host = rawHost.toLowerCase().split(":")[0];
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${rawHost}`;

  // On the APP host this is a DEVELOPER surface, not a blog: agents that
  // fetch app.grolabs.ai/llms.txt get the integration entry points. Merchant
  // storefront hosts (matched by instance.domain below) keep the blog index.
  if (host === "app.grolabs.ai" || host === process.env.NEXT_PUBLIC_APP_HOST) {
    const dev = [
      "# GroLabs — developer integration",
      "",
      "> Connect any storefront to GroLabs: catalog ingest, search, analytics",
      "> events, and traffic analytics. Start with the agent guide below.",
      "",
      "## Integration",
      "",
      `- [Integration guide for coding agents](${origin}/llm-integration.md): modules SEARCH / CATALOG / EVENTS / GA4 — contracts, canonical event names, verification steps`,
      `- [OpenAPI 3.1 spec](${origin}/openapi.yaml): machine-readable API contract`,
      `- [Browsable API docs](${origin}/api-docs.html): Swagger UI`,
      `- [Get connected (human guide)](${origin}/get-connected): WordPress and proprietary-platform tracks`,
      "",
    ];
    return new Response(dev.join("\n") + "\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }

  const supabase = createServiceRoleClient();
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("instance_id, name")
    .eq("domain", host)
    .maybeSingle();

  let q = supabase
    .from("post")
    .select("title, slug, summary, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(200);
  if (instanceRow?.instance_id != null) q = q.eq("instance_id", instanceRow.instance_id);
  const { data: posts } = await q;

  const title = instanceRow?.name ?? "Blog";
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `> Public blog content for ${title}. Sourced from ${origin}/blog. RSS at ${origin}/rss.xml.`,
  );
  lines.push("");
  lines.push("## Posts");
  lines.push("");
  for (const p of posts ?? []) {
    const link = `${origin}/blog/${p.slug}`;
    const summary = (p.summary as string | null)?.trim();
    lines.push(`- [${p.title}](${link})${summary ? `: ${summary}` : ""}`);
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
