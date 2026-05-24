import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import type { Metadata } from "next";
import { instanceIdForHost } from "@/lib/blog/host";
import { getBrandSystem, brandCssBlock } from "@/lib/blog/brand";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blog.public");
  return {
    title: t("indexTitle"),
    description: t("indexDescription"),
  };
}

type PublicPostRow = {
  post_id: number;
  title: string;
  slug: string;
  summary: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  tags: string[] | null;
};

function normalizeQuery(raw: string | undefined): string {
  if (!raw) return "";
  // Trim + collapse whitespace; cap to keep PG happy (websearch_to_tsquery
  // accepts long strings but there's no point feeding it megabytes).
  return raw.trim().replace(/\s+/g, " ").slice(0, 200);
}

export default async function PublicBlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const { tag, q: qRaw } = await searchParams;
  const q = normalizeQuery(qRaw);
  const t = await getTranslations("blog.public");
  const supabase = await createClient();
  const instanceId = await instanceIdForHost();

  let query = supabase
    .from("post")
    .select(
      "post_id, title, slug, summary, cover_image_url, published_at, tags",
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);
  if (instanceId !== null) query = query.eq("instance_id", instanceId);
  if (tag) query = query.contains("tags", [tag.toLowerCase()]);
  if (q) {
    // websearch syntax — supports quoted phrases, OR, -negation,
    // matching common Google-ish query shapes writers will type.
    query = query.textSearch("search_vector", q, {
      type: "websearch",
      config: "simple",
    });
  }

  const { data } = await query;
  const posts: PublicPostRow[] = (data ?? []) as PublicPostRow[];
  const brand = await getBrandSystem(instanceId);

  return (
    <main className="blog-themed min-h-screen">
      <style
        dangerouslySetInnerHTML={{ __html: brandCssBlock(brand, "blog-themed") }}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-4xl font-semibold tracking-tight">
            {t("indexTitle")}
          </h1>
          <p className="mt-2 opacity-75">{t("indexDescription")}</p>

          <form className="mt-6 flex gap-2" action="/blog" method="get">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="flex-1 rounded-md border bg-background/60 px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              type="submit"
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
            >
              {t("searchButton")}
            </button>
          </form>

          {q ? (
            <p className="mt-3 text-sm">
              <span className="opacity-70">{t("searchResultsFor")} </span>
              <span className="rounded bg-muted px-2 py-0.5 font-mono">
                {q}
              </span>{" "}
              <Link href="/blog" className="ml-2 text-xs underline">
                {t("clearFilter")}
              </Link>
            </p>
          ) : null}

          {tag ? (
            <p className="mt-3 text-sm">
              <span className="opacity-70">{t("filterByTag")} </span>
              <span className="rounded bg-muted px-2 py-0.5 font-mono">
                #{tag}
              </span>{" "}
              <Link href="/blog" className="ml-2 text-xs underline">
                {t("clearFilter")}
              </Link>
            </p>
          ) : null}
        </header>

        {posts.length === 0 ? (
          <p className="opacity-70">
            {q ? t("searchNoResults") : t("empty")}
          </p>
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
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-60">
                    {p.published_at ? (
                      <time dateTime={p.published_at}>
                        {new Date(p.published_at).toLocaleDateString(
                          undefined,
                          { year: "numeric", month: "long", day: "numeric" },
                        )}
                      </time>
                    ) : null}
                    {p.tags && p.tags.length > 0 ? (
                      <>
                        <span>·</span>
                        <div className="flex flex-wrap gap-1">
                          {p.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-muted px-1.5 py-0.5"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
