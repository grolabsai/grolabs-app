import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import type { Metadata } from "next";

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
};

export default async function PublicBlogIndex() {
  const t = await getTranslations("blog.public");
  const supabase = await createClient();

  const { data } = await supabase
    .from("post")
    .select("post_id, title, slug, summary, cover_image_url, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);

  const posts: PublicPostRow[] = (data ?? []) as PublicPostRow[];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("indexTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">{t("indexDescription")}</p>
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
                {p.published_at ? (
                  <time
                    dateTime={p.published_at}
                    className="mt-2 block text-xs text-muted-foreground"
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
    </main>
  );
}
