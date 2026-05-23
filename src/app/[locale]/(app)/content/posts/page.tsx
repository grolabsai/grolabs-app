import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Plus, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

type PostRow = {
  post_id: number;
  title: string;
  slug: string;
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
};

export default async function BlogAdminPage() {
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
  const { data: posts } = await supabase
    .from("post")
    .select("post_id, title, slug, status, published_at, updated_at")
    .order("updated_at", { ascending: false });

  const rows: PostRow[] = (posts ?? []) as PostRow[];

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
                  {t("colUpdated")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("colSlug")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.post_id} className="border-b last:border-0 hover:bg-muted/30">
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
                      className={
                        p.status === "published"
                          ? "rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700"
                          : "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {t(`status.${p.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    /blog/{p.slug}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
