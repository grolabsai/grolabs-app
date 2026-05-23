import { notFound } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getBrandSystem, brandCssBlock } from "@/lib/blog/brand";
import {
  sanitizeHtml,
  extractTocAndAnchor,
  readingMinutes,
} from "@/lib/blog/render";
import { CopyHeadingAnchors } from "../../_copy-anchors";
import { ReadingProgress } from "../../_reading-progress";

export const dynamic = "force-dynamic";

/**
 * Draft preview page — render a post by its preview_token regardless
 * of status. Bypasses RLS via service role; the token itself is the
 * authorization. `robots: noindex` so search engines don't pick it up.
 *
 * Banner across the top tells the reader they're looking at a draft.
 * No related-posts section (the article isn't published, so neighbors
 * are out of context).
 */

type PreviewPost = {
  post_id: number;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  content_format: "markdown" | "html";
  cover_image_url: string | null;
  published_at: string | null;
  tags: string[] | null;
  instance_id: number;
  status: "draft" | "scheduled" | "published";
};

async function loadByToken(token: string): Promise<PreviewPost | null> {
  if (!token || token.length > 64) return null;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("post")
    .select(
      "post_id, title, slug, summary, content, content_format, cover_image_url, published_at, tags, instance_id, status",
    )
    .eq("preview_token", token)
    .maybeSingle();
  return (data as PreviewPost | null) ?? null;
}

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const post = await loadByToken(token);
  if (!post) notFound();
  const t = await getTranslations("blog.public");
  const tPreview = await getTranslations("blog.preview");
  const brand = await getBrandSystem(post.instance_id);

  const minutes = readingMinutes(post.content);
  let renderedHtml: string | null = null;
  let toc: { id: string; text: string; level: 2 | 3 }[] = [];
  if (post.content_format === "html") {
    const safe = sanitizeHtml(post.content);
    const anchored = extractTocAndAnchor(safe);
    renderedHtml = anchored.html;
    toc = anchored.toc;
  }

  const showToc = toc.filter((e) => e.level === 2).length >= 3;

  return (
    <main className="blog-themed min-h-screen">
      <style
        dangerouslySetInnerHTML={{ __html: brandCssBlock(brand, "blog-themed") }}
      />
      <ReadingProgress />

      <div
        className="sticky top-0 z-40 flex items-center justify-center gap-3 border-b px-4 py-2 text-xs font-medium"
        style={{
          background: "var(--blog-primary, #9C5530)",
          color: "var(--blog-bg, #F4F1EA)",
        }}
      >
        <span className="rounded bg-black/20 px-1.5 py-0.5 uppercase tracking-wider">
          {tPreview("badge")}
        </span>
        <span>
          {tPreview(`status.${post.status}`)} ·{" "}
          {tPreview("notIndexed")}
        </span>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-16">
        <article className="prose prose-lg max-w-none">
          {post.cover_image_url ? (
            <Image
              src={post.cover_image_url}
              alt={post.title}
              width={1200}
              height={600}
              priority
              sizes="(max-width: 768px) 100vw, 672px"
              className="mb-8 aspect-[2/1] w-full rounded-lg border object-cover"
            />
          ) : null}

          <h1>{post.title}</h1>
          <div className="not-prose mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {post.published_at ? (
              <time dateTime={post.published_at}>
                {new Date(post.published_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            ) : null}
            <span>·</span>
            <span>{t("readingTime", { minutes })}</span>
            {post.tags && post.tags.length > 0 ? (
              <>
                <span>·</span>
                <div className="flex flex-wrap gap-1">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {post.summary ? <p className="lead">{post.summary}</p> : null}

          {showToc ? (
            <nav
              className="not-prose mb-8 rounded-lg border bg-muted/30 p-4"
              aria-label={t("toc")}
            >
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("toc")}
              </div>
              <ul className="space-y-1 text-sm">
                {toc.map((entry) => (
                  <li
                    key={entry.id}
                    className={entry.level === 3 ? "pl-4" : ""}
                  >
                    <a
                      href={`#${entry.id}`}
                      className="text-foreground hover:underline"
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {renderedHtml !== null ? (
            <div
              id="blog-content"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {post.content}
            </ReactMarkdown>
          )}
        </article>

        <CopyHeadingAnchors />
      </div>
    </main>
  );
}
