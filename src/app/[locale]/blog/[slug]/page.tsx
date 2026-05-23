import { notFound } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTranslations } from "next-intl/server";
import { instanceIdForHost } from "@/lib/blog/host";
import {
  sanitizeHtml,
  extractTocAndAnchor,
  readingMinutes,
} from "@/lib/blog/render";
import { CopyHeadingAnchors } from "../_copy-anchors";

export const dynamic = "force-dynamic";

type PublicPost = {
  post_id: number;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  content_format: "markdown" | "html";
  cover_image_url: string | null;
  published_at: string | null;
  tags: string[] | null;
};

async function loadPost(slug: string): Promise<PublicPost | null> {
  const supabase = await createClient();
  const instanceId = await instanceIdForHost();
  let query = supabase
    .from("post")
    .select(
      "post_id, title, slug, summary, content, content_format, cover_image_url, published_at, tags",
    )
    .eq("slug", slug)
    .eq("status", "published");
  if (instanceId !== null) query = query.eq("instance_id", instanceId);
  const { data } = await query.maybeSingle();
  return (data as PublicPost | null) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await loadPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.summary ?? undefined,
    openGraph: {
      title: post.title,
      description: post.summary ?? undefined,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      images: post.cover_image_url ? [post.cover_image_url] : undefined,
    },
    twitter: {
      card: post.cover_image_url ? "summary_large_image" : "summary",
      title: post.title,
      description: post.summary ?? undefined,
      images: post.cover_image_url ? [post.cover_image_url] : undefined,
    },
  };
}

export default async function PublicPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await loadPost(slug);
  if (!post) notFound();
  const t = await getTranslations("blog.public");

  const minutes = readingMinutes(post.content);

  let renderedHtml: string | null = null;
  let toc: { id: string; text: string; level: 2 | 3 }[] = [];
  if (post.content_format === "html") {
    const safe = sanitizeHtml(post.content);
    const anchored = extractTocAndAnchor(safe);
    renderedHtml = anchored.html;
    toc = anchored.toc;
  }

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary ?? undefined,
    image: post.cover_image_url ?? undefined,
    datePublished: post.published_at ?? undefined,
    keywords: post.tags && post.tags.length > 0 ? post.tags.join(", ") : undefined,
  };

  const showToc = toc.filter((e) => e.level === 2).length >= 3;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />

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
    </main>
  );
}
