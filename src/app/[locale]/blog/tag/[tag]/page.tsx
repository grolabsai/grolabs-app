import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { instanceIdForHost } from "@/lib/blog/host";
import { getBrandSystem, brandCssBlock } from "@/lib/blog/brand";

export const dynamic = "force-dynamic";

type PublicPostRow = {
  post_id: number;
  title: string;
  slug: string;
  summary: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  tags: string[] | null;
};

function normalizeTag(raw: string): string {
  return decodeURIComponent(raw).toLowerCase().replace(/\s+/g, "-");
}

async function loadPosts(
  tag: string,
  instanceId: number | null,
): Promise<PublicPostRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("post")
    .select(
      "post_id, title, slug, summary, cover_image_url, published_at, tags",
    )
    .eq("status", "published")
    .contains("tags", [tag])
    .order("published_at", { ascending: false })
    .limit(100);
  if (instanceId !== null) q = q.eq("instance_id", instanceId);
  const { data } = await q;
  return (data ?? []) as PublicPostRow[];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag: rawTag } = await params;
  const tag = normalizeTag(rawTag);
  const instanceId = await instanceIdForHost();
  const brand = await getBrandSystem(instanceId);
  const tenant = brand.display_name || "Blog";
  return {
    title: `#${tag} · ${tenant}`,
    description: `Artículos etiquetados como “${tag}” en ${tenant}. Posts tagged "${tag}" from ${tenant}.`,
    openGraph: {
      title: `#${tag} · ${tenant}`,
      description: `All posts tagged "${tag}" from ${tenant}.`,
      type: "website",
    },
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: rawTag } = await params;
  const tag = normalizeTag(rawTag);
  if (!tag || tag.length > 64) notFound();

  const t = await getTranslations("blog.public");
  const instanceId = await instanceIdForHost();
  const posts = await loadPosts(tag, instanceId);
  const brand = await getBrandSystem(instanceId);

  // Empty tag pages are still 200 (vs notFound) so the URL is shareable
  // and indexable; no posts just means none yet.

  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `#${tag}`,
    description: `Posts tagged "${tag}"`,
    isPartOf: { "@type": "Blog", name: brand.display_name || "Blog" },
    hasPart: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `/blog/${p.slug}`,
      datePublished: p.published_at ?? undefined,
    })),
  };

  return (
    <main className="blog-themed min-h-screen">
      <style
        dangerouslySetInnerHTML={{ __html: brandCssBlock(brand, "blog-themed") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12">
          <p className="mb-2 text-xs uppercase tracking-wider opacity-70">
            {t("filterByTag")}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">#{tag}</h1>
          <p className="mt-2 text-sm opacity-75">
            <Link href="/blog" className="underline">
              ← {t("indexTitle")}
            </Link>
          </p>
        </header>

        {posts.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul className="space-y-10">
            {posts.map((p) => (
              <li key={p.post_id} className="group">
                <Link href={`/blog/${p.slug}` as never} className="block">
                  {p.cover_image_url ? (
                    <Image
                      src={p.cover_image_url}
                      alt={p.title}
                      width={800}
                      height={400}
                      sizes="(max-width: 768px) 100vw, 768px"
                      className="mb-4 aspect-[2/1] w-full rounded-lg border object-cover"
                    />
                  ) : null}
                  <h2 className="text-2xl font-semibold tracking-tight group-hover:underline">
                    {p.title}
                  </h2>
                  {p.summary ? (
                    <p className="mt-1 opacity-75">{p.summary}</p>
                  ) : null}
                  {p.published_at ? (
                    <time
                      dateTime={p.published_at}
                      className="mt-2 block text-xs opacity-60"
                    >
                      {new Date(p.published_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
