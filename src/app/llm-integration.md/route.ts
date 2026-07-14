import { promises as fs } from "fs";
import path from "path";

/**
 * /llm-integration.md — the integration guide for coding agents, served raw.
 * Developers paste this URL into their agent (or the agent fetches it from
 * /llms.txt). Source of truth is the repo file; this route just streams it.
 * Top-level route (outside [locale]) like llms.txt/sitemap — bypasses locale
 * routing. The docs/guides tracing glob in next.config.ts ships the file.
 */

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const filePath = path.join(
    process.cwd(),
    "docs",
    "guides",
    "implementation",
    "llm-integration.md",
  );
  const body = await fs.readFile(filePath, "utf8");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
