import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import type { Metadata } from "next";
import { instanceIdForHost } from "@/lib/blog/host";

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

export default async function PublicBlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const { tag } = await searchParams;
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

  const { data } = await query;
  const posts: PublicPostRow[] = (data ?? []) as PublicPostRow[];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("indexTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">{t("indexDescription")}</p>
        {tag ? (
          <p className="mt-3 text-sm">
            <span className="text-muted-foreground">
              {t("filterByTag")}{" "}
            </span>
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
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-10">
          {posts.map((p) => (
            <li key={p.post_id} className="group">
              <Link href={`/blog/${p.slug}` as never} className="block">
                {p.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.cover_image_url}
                    alt=""
                    className="mb-4 aspect-[2/1] w-full rounded-lg border object-cover"
                  />
                ) : null}
                <h2 className="text-2xl font-semibold tracking-tight group-hover:underline">
                  {p.title}
                </h2>
                {p.summary ? (
                  <p className="mt-1 text-muted-foreground">{p.summary}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {p.published_at ? (
                    <time dateTime={p.published_at}>
                      {new Date(p.published_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
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
    </main>
  );
}
