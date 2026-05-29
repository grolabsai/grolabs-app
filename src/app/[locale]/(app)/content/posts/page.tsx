import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Plus, FileText } from "lucide-react";
import type { PostStatus } from "@/lib/actions/post";
import { getPostViewCounts } from "@/lib/blog/views";

export const dynamic = "force-dynamic";

type PostRow = {
  post_id: number;
  title: string;
  slug: string;
  status: PostStatus;
  published_at: string | null;
  updated_at: string;
  tags: string[] | null;
};

type SearchParams = { status?: string };

const VALID_STATUSES: PostStatus[] = ["draft", "scheduled", "published"];

export default async function BlogAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status: rawStatus } = await searchParams;
  const filter: PostStatus | "all" =
    rawStatus && (VALID_STATUSES as string[]).includes(rawStatus)
      ? (rawStatus as PostStatus)
      : "all";

  const instanceId = await currentInstanceId();
  const t = await getTranslations("blog");

  if (instanceId === null) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">{t("noInstance")}</span>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  let query = supabase
    .from("post")
    .select("post_id, title, slug, status, published_at, updated_at, tags")
    .order("updated_at", { ascending: false });
  if (filter !== "all") query = query.eq("status", filter);

  const { data: posts } = await query;
  const rows: PostRow[] = (posts ?? []) as PostRow[];

  // Per-post 30-day view counts from GA4 daily snapshots.
  // Only worth pulling for the published rows the writer would
  // actually compare against each other; everything else renders "—".
  const publishedSlugs = rows
    .filter((r) => r.status === "published")
    .map((r) => r.slug);
  const viewCounts =
    publishedSlugs.length > 0
      ? await getPostViewCounts(instanceId, publishedSlugs)
      : new Map<string, number>();

  const tabs: Array<PostStatus | "all"> = [
    "all",
    "draft",
    "scheduled",
    "published",
  ];

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
        </div>
        <Button asChild>
          <Link href="/content/posts/new">
            <Icon icon={Plus} size={14} />
            {t("newPost")}
          </Link>
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-1 border-b">
        {tabs.map((tab) => {
          const active = filter === tab;
          const href =
            tab === "all" ? "/content/posts" : `/content/posts?status=${tab}`;
          return (
            <Link
              key={tab}
              href={href as never}
              className={
                active
                  ? "border-b-2 border-[var(--scout-accent)] px-3 py-2 text-sm font-medium"
                  : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              {tab === "all" ? t("filter.all") : t(`status.${tab}`)}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Icon icon={FileText} size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Button asChild variant="outline">
            <Link href="/content/posts/new">{t("newPost")}</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("colTitle")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("colStatus")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("colTags")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium" title={t("colViewsTooltip")}>
                  {t("colViews")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("colUpdated")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("colSlug")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const badge =
                  p.status === "published"
                    ? "bg-emerald-100 text-emerald-700"
                    : p.status === "scheduled"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-muted text-muted-foreground";
                return (
                  <tr
                    key={p.post_id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/content/posts/${p.post_id}` as never}
                        className="font-medium hover:underline"
                      >
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${badge}`}
                      >
                        {t(`status.${p.status}`)}
                      </span>
                      {p.status === "scheduled" && p.published_at && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {new Date(p.published_at).toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.tags && p.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {p.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-muted px-1.5 py-0.5 text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {p.status === "published" ? (
                        viewCounts.get(p.slug) ?? 0
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {new Date(p.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      /blog/{p.slug}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
