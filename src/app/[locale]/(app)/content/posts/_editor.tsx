"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Icon } from "@/components/ui/icon";
import { Upload, Trash2, Eye, EyeOff, Save } from "lucide-react";
import {
  createPost,
  updatePost,
  setPostStatus,
  deletePost,
  uploadPostImage,
  type PostStatus,
} from "@/lib/actions/post";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface PostEditorInitial {
  post_id?: number;
  title?: string;
  slug?: string;
  summary?: string | null;
  content?: string;
  cover_image_url?: string | null;
  status?: PostStatus;
}

export function PostEditor({ initial }: { initial?: PostEditorInitial }) {
  const t = useTranslations("blog");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.cover_image_url ?? "");
  const [status, setStatus] = useState<PostStatus>(initial?.status ?? "draft");
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isEdit = Boolean(initial?.post_id);

  async function uploadImage(file: File, kind: "cover" | "inline") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    setUploading(true);
    const res = await uploadPostImage(fd);
    setUploading(false);
    if ("error" in res) {
      toast.error(res.error);
      return null;
    }
    return res.url;
  }

  async function onCoverSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadImage(file, "cover");
    if (url) {
      setCoverUrl(url);
      toast.success(t("toast.coverUploaded"));
    }
    e.target.value = "";
  }

  async function onInlineImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadImage(file, "inline");
    if (url) {
      const md = `\n\n![](${url})\n\n`;
      setContent((c) => c + md);
      toast.success(t("toast.imageInserted"));
    }
    e.target.value = "";
  }

  function onSave() {
    if (!title.trim()) {
      toast.error(t("toast.titleRequired"));
      return;
    }
    startTransition(async () => {
      const payload = {
        title,
        slug: slug || title,
        summary: summary || null,
        content,
        cover_image_url: coverUrl || null,
      };
      if (isEdit) {
        const res = await updatePost(initial!.post_id!, payload);
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
        toast.success(t("toast.saved"));
      } else {
        const res = await createPost(payload);
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
        toast.success(t("toast.created"));
        router.push(`/content/posts/${res.post_id}` as never);
      }
    });
  }

  function onTogglePublish() {
    if (!initial?.post_id) {
      toast.error(t("toast.saveFirst"));
      return;
    }
    const next: PostStatus = status === "published" ? "draft" : "published";
    startTransition(async () => {
      const res = await setPostStatus(initial.post_id!, next);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setStatus(next);
      toast.success(next === "published" ? t("toast.published") : t("toast.unpublished"));
    });
  }

  function onDelete() {
    if (!initial?.post_id) return;
    if (!confirm(t("confirm.delete"))) return;
    startTransition(async () => {
      await deletePost(initial.post_id!);
    });
  }

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">
            {isEdit ? t("editTitle") : t("newPost")}
          </h1>
          {isEdit && (
            <span className="ml-3 text-xs text-muted-foreground">
              {status === "published" ? t("status.published") : t("status.draft")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
          >
            <Icon icon={showPreview ? EyeOff : Eye} size={14} />
            {showPreview ? t("editor.hidePreview") : t("editor.showPreview")}
          </Button>
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onTogglePublish}
              disabled={pending}
            >
              {status === "published" ? t("editor.unpublish") : t("editor.publish")}
            </Button>
          )}
          <Button type="button" onClick={onSave} disabled={pending} size="sm">
            <Icon icon={Save} size={14} />
            {t("editor.save")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <FloatingLabelInput
            id="post-title"
            label={t("fields.title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <FloatingLabelInput
            id="post-slug"
            label={t("fields.slug")}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t("fields.slugPlaceholder")}
            className="font-mono text-xs"
          />
          <FloatingLabelInput
            id="post-summary"
            label={t("fields.summary")}
            value={summary ?? ""}
            onChange={(e) => setSummary(e.target.value)}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="post-content" className="text-xs text-muted-foreground">
                {t("fields.content")}
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Icon icon={Upload} size={12} />
                {uploading ? t("editor.uploading") : t("editor.insertImage")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onInlineImage}
                />
              </label>
            </div>
            {showPreview ? (
              <article className="prose prose-sm min-h-[400px] max-w-none rounded-md border bg-background p-4">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="mb-6 rounded" />
                ) : null}
                <h1>{title || t("fields.titlePlaceholder")}</h1>
                {summary ? <p className="lead">{summary}</p> : null}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || `*${t("editor.previewEmpty")}*`}
                </ReactMarkdown>
              </article>
            ) : (
              <textarea
                id="post-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("fields.contentPlaceholder")}
                rows={20}
                className="w-full rounded-md border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("sidebar.cover")}
            </h3>
            {coverUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverUrl} alt="" className="w-full rounded border" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCoverUrl("")}
                  className="w-full text-destructive hover:text-destructive"
                >
                  <Icon icon={Trash2} size={12} />
                  {t("sidebar.removeCover")}
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed py-6 text-center text-xs text-muted-foreground hover:bg-muted/40">
                <Icon icon={Upload} size={16} />
                {uploading ? t("editor.uploading") : t("sidebar.uploadCover")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onCoverSelect}
                />
              </label>
            )}
          </div>

          {isEdit && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-destructive">
                {t("sidebar.dangerZone")}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDelete}
                disabled={pending}
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Icon icon={Trash2} size={12} />
                {t("sidebar.delete")}
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
