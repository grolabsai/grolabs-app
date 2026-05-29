import { notFound } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTranslations } from "next-intl/server";
import { instanceIdForHost } from "@/lib/blog/host";
import { getBrandSystem, brandCssBlock } from "@/lib/blog/brand";
import {
  sanitizeHtml,
  extractTocAndAnchor,
  readingMinutes,
} from "@/lib/blog/render";
import { CopyHeadingAnchors } from "../_copy-anchors";
import { ReadingProgress } from "../_reading-progress";
import { getRelatedPosts } from "@/lib/blog/related";
import { Link } from "@/i18n/routing";
import {
  authorSchema,
  breadcrumbSchema,
  canonicalUrl,
  jsonLdScriptContent,
  publisherSchema,
  requestOrigin,
} from "@/lib/blog/seo";
import { getAuthorInfo } from "@/lib/blog/author";
import { countWords } from "@/lib/blog/render";

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
  updated_at: string;
  tags: string[] | null;
  instance_id: number;
  author_id: string;
};

async function loadPost(slug: string): Promise<PublicPost | null> {
  const supabase = await createClient();
  const instanceId = await instanceIdForHost();
  let query = supabase
    .from("post")
    .select(
      "post_id, title, slug, summary, content, content_format, cover_image_url, published_at, updated_at, tags, instance_id, author_id",
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
  const origin = await requestOrigin();
  const canonical = canonicalUrl(origin, `/blog/${post.slug}`);
  return {
    title: post.title,
    description: post.summary ?? undefined,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description: post.summary ?? undefined,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at ?? undefined,
      url: canonical,
      tags: post.tags ?? undefined,
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

  const brand = await getBrandSystem(post.instance_id);
  const related = await getRelatedPosts(
    {
      post_id: post.post_id,
      instance_id: post.instance_id,
      tags: post.tags,
    },
    3,
  );
  const origin = await requestOrigin();
  const author = await getAuthorInfo(post.author_id);
  const canonical = canonicalUrl(origin, `/blog/${post.slug}`);
  const wordCount = countWords(post.content);

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary ?? undefined,
    image: post.cover_image_url ?? undefined,
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at ?? undefined,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    wordCount: wordCount > 0 ? wordCount : undefined,
    inLanguage: undefined as string | undefined,
    keywords:
      post.tags && post.tags.length > 0 ? post.tags.join(", ") : undefined,
    author: authorSchema(author, brand, origin),
    publisher: publisherSchema(brand, origin),
  };

  const breadcrumbItems = [
    { name: "Home", url: origin },
    { name: brand.display_name ? `${brand.display_name} — Blog` : "Blog", url: `${origin}/blog` },
  ];
  if (post.tags && post.tags.length > 0) {
    const firstTag = post.tags[0];
    breadcrumbItems.push({
      name: `#${firstTag}`,
      url: `${origin}/blog/tag/${encodeURIComponent(firstTag)}`,
    });
  }
  breadcrumbItems.push({ name: post.title, url: canonical });

  const schemas = [articleSchema, breadcrumbSchema(breadcrumbItems)];

  const showToc = toc.filter((e) => e.level === 2).length >= 3;

  return (
    <main className="blog-themed min-h-screen">
      <style
        dangerouslySetInnerHTML={{ __html: brandCssBlock(brand, "blog-themed") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(schemas) }}
      />
      <ReadingProgress />
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
                  <Link
                    key={tag}
                    href={`/blog/tag/${encodeURIComponent(tag)}` as never}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs hover:underline"
                  >
                    #{tag}
                  </Link>
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

      {related.length > 0 ? (
        <aside
          className="mt-16 border-t pt-10"
          style={{ borderColor: "var(--blog-muted, currentColor)", opacity: 0.95 }}
          aria-label={t("related")}
        >
          <h2 className="mb-6 text-sm font-medium uppercase tracking-wider">
            {t("related")}
          </h2>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <li key={r.post_id} className="group">
                <Link href={`/blog/${r.slug}` as never} className="block">
                  {r.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.cover_image_url}
                      alt={r.title}
                      className="mb-3 aspect-[2/1] w-full rounded-md border object-cover"
                    />
                  ) : null}
                  <h3 className="text-base font-semibold leading-tight group-hover:underline">
                    {r.title}
                  </h3>
                  {r.summary ? (
                    <p className="mt-1 line-clamp-2 text-sm opacity-75">
                      {r.summary}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      </div>
    </main>
  );
}
