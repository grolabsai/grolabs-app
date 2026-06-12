"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Icon } from "@/components/ui/icon";
import { Upload, Trash2, Save, X, Clock, Sparkles, LinkIcon, Copy, Eye } from "lucide-react";
import {
  createPost,
  updatePost,
  setPostStatus,
  schedulePost,
  deletePost,
  uploadPostImage,
  autosavePost,
  type PostStatus,
  type PostContentFormat,
} from "@/lib/actions/post";
import {
  aiSuggestTitles,
  aiGenerateSummary,
} from "@/lib/actions/blog-ai";
import { ensureShortLinkForPost } from "@/lib/actions/short-link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TiptapEditor = dynamic(
  () => import("./_tiptap").then((m) => m.TiptapEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[440px] animate-pulse rounded-md border bg-muted/20" />
    ),
  },
);

export interface PostEditorInitial {
  post_id?: number;
  title?: string;
  slug?: string;
  summary?: string | null;
  content?: string;
  content_format?: PostContentFormat;
  cover_image_url?: string | null;
  status?: PostStatus;
  tags?: string[];
  published_at?: string | null;
  short_link_code?: string | null;
  preview_token?: string;
}

const AUTOSAVE_DEBOUNCE_MS = 5000;

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
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [scheduleAt, setScheduleAt] = useState<string>(
    initial?.status === "scheduled" && initial?.published_at
      ? new Date(initial.published_at).toISOString().slice(0, 16)
      : "",
  );
  const [uploading, setUploading] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<string[] | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(
    initial?.short_link_code ?? null,
  );
  const dirtyRef = useRef(false);

  const isEdit = Boolean(initial?.post_id);
  const isMarkdown = (initial?.content_format ?? "html") === "markdown";

  // Autosave loop — debounced, edit mode only.
  useEffect(() => {
    if (!isEdit || !initial?.post_id) return;
    if (!dirtyRef.current) return;
    const handle = setTimeout(() => {
      autosavePost(initial.post_id!, {
        title,
        slug: slug || title,
        summary: summary || null,
        content,
        content_format: "html",
        cover_image_url: coverUrl || null,
        tags,
      }).then((res) => {
        if (!("error" in res) && res.saved_at) {
          setLastSavedAt(res.saved_at);
          dirtyRef.current = false;
        }
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [title, slug, summary, content, coverUrl, tags, isEdit, initial?.post_id]);

  function markDirty() {
    dirtyRef.current = true;
  }

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
      markDirty();
      toast.success(t("toast.coverUploaded"));
    }
    e.target.value = "";
  }

  function addTagFromInput() {
    const next = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!next) return;
    if (tags.includes(next)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, next]);
    setTagInput("");
    markDirty();
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
    markDirty();
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
        content_format: "html" as const,
        cover_image_url: coverUrl || null,
        tags,
      };
      if (isEdit) {
        const res = await updatePost(initial!.post_id!, payload);
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
        dirtyRef.current = false;
        setLastSavedAt(new Date().toISOString());
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
      toast.success(
        next === "published" ? t("toast.published") : t("toast.unpublished"),
      );
      // Warn (don't block) if any image is missing alt text. The
      // editor's AI suggestion fills these in by default; this
      // catches the case where the writer dismissed the suggestion or
      // pasted images from an older draft.
      if (next === "published" && res.missing_alt_count && res.missing_alt_count > 0) {
        toast.warning(
          t("toast.missingAlt", { count: res.missing_alt_count }),
          { duration: 8000 },
        );
      }
      // Mint a short link on first publish (idempotent — re-publishing
      // returns the existing code).
      if (next === "published" && !shortCode) {
        const publicSlug = slug || title;
        const targetUrl = `${window.location.origin}/blog/${publicSlug}`;
        const slRes = await ensureShortLinkForPost(initial.post_id!, targetUrl);
        if (slRes.ok) setShortCode(slRes.data.code);
      }
    });
  }

  function onSchedule() {
    if (!initial?.post_id) {
      toast.error(t("toast.saveFirst"));
      return;
    }
    if (!scheduleAt) {
      toast.error(t("toast.scheduleRequired"));
      return;
    }
    const iso = new Date(scheduleAt).toISOString();
    startTransition(async () => {
      const res = await schedulePost(initial.post_id!, iso);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setStatus("scheduled");
      toast.success(t("toast.scheduled"));
    });
  }

  function onDelete() {
    if (!initial?.post_id) return;
    if (!confirm(t("confirm.delete"))) return;
    startTransition(async () => {
      await deletePost(initial.post_id!);
    });
  }

  async function onSuggestTitles() {
    if (!content.trim()) {
      toast.error(t("ai.emptyContent"));
      return;
    }
    setAiPending(true);
    const res = await aiSuggestTitles({
      content,
      contentFormat: "html",
      summary,
    });
    setAiPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTitleSuggestions(res.data);
  }

  async function onGenerateSummary() {
    if (!content.trim()) {
      toast.error(t("ai.emptyContent"));
      return;
    }
    setAiPending(true);
    const res = await aiGenerateSummary({
      title,
      content,
      contentFormat: "html",
    });
    setAiPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSummary(res.data);
    markDirty();
    toast.success(t("ai.summaryGenerated"));
  }

  const statusBadgeClass =
    status === "published"
      ? "bg-emerald-100 text-emerald-700"
      : status === "scheduled"
      ? "bg-amber-100 text-amber-700"
      : "bg-muted text-muted-foreground";

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{isEdit ? t("editTitle") : t("newPost")}</h1>
          {isEdit && (
            <span
              className={`ml-3 rounded px-1.5 py-0.5 text-xs ${statusBadgeClass}`}
            >
              {t(`status.${status}`)}
            </span>
          )}
          {lastSavedAt && (
            <span className="ml-2 text-xs text-muted-foreground">
              {t("editor.savedAt", {
                time: new Date(lastSavedAt).toLocaleTimeString(),
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEdit && initial?.preview_token && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const url = `${window.location.origin}/blog/preview/${initial.preview_token}`;
                navigator.clipboard.writeText(url).then(
                  () => toast.success(t("editor.previewLinkCopied")),
                  () => toast.error(t("editor.previewLinkCopyFailed")),
                );
              }}
              title={t("editor.copyPreviewLink")}
            >
              <Icon icon={Eye} size={14} />
              {t("editor.copyPreviewLink")}
            </Button>
          )}
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onTogglePublish}
              disabled={pending}
            >
              {status === "published"
                ? t("editor.unpublish")
                : t("editor.publish")}
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
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
          />
          <FloatingLabelInput
            id="post-slug"
            label={t("fields.slug")}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              markDirty();
            }}
            placeholder={t("fields.slugPlaceholder")}
            className="font-mono text-xs"
          />
          <FloatingLabelInput
            id="post-summary"
            label={t("fields.summary")}
            value={summary ?? ""}
            onChange={(e) => {
              setSummary(e.target.value);
              markDirty();
            }}
          />

          {isMarkdown ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-700">
                {t("editor.markdownLegacy")}
              </p>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  markDirty();
                }}
                rows={20}
                className="w-full rounded-md border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          ) : (
            <TiptapEditor
              initialHTML={content}
              placeholder={t("fields.contentPlaceholder")}
              onChange={(html) => {
                setContent(html);
                markDirty();
              }}
            />
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Icon icon={Sparkles} size={12} />
              {t("sidebar.aiAssist")}
            </h3>
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSuggestTitles}
                disabled={aiPending}
                className="w-full justify-start"
              >
                <Icon icon={Sparkles} size={12} />
                {t("ai.suggestTitles")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onGenerateSummary}
                disabled={aiPending}
                className="w-full justify-start"
              >
                <Icon icon={Sparkles} size={12} />
                {t("ai.generateSummary")}
              </Button>
              {aiPending && (
                <p className="text-xs text-muted-foreground">
                  {t("ai.thinking")}
                </p>
              )}
            </div>
          </div>

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
                  onClick={() => {
                    setCoverUrl("");
                    markDirty();
                  }}
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

          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("sidebar.tags")}
            </h3>
            <div className="mb-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("sidebar.tagsEmpty")}
                </span>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t("sidebar.removeTag")}
                    >
                      <Icon icon={X} size={10} />
                    </button>
                  </span>
                ))
              )}
            </div>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTagFromInput();
                }
              }}
              onBlur={addTagFromInput}
              placeholder={t("sidebar.tagsPlaceholder")}
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {isEdit && status === "published" && shortCode && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon icon={LinkIcon} size={12} />
                {t("sidebar.shortLink")}
              </h3>
              <ShortLinkRow code={shortCode} />
            </div>
          )}

          {isEdit && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("sidebar.schedule")}
              </h3>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="mb-2 w-full rounded border bg-background px-2 py-1 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSchedule}
                disabled={pending || !scheduleAt}
                className="w-full"
              >
                <Icon icon={Clock} size={12} />
                {t("sidebar.schedulePublish")}
              </Button>
            </div>
          )}

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

      <Dialog
        open={titleSuggestions !== null}
        onOpenChange={(open) => {
          if (!open) setTitleSuggestions(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai.titleSuggestionsTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {titleSuggestions?.map((suggestion, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setTitle(suggestion);
                  markDirty();
                  setTitleSuggestions(null);
                  toast.success(t("ai.titleApplied"));
                }}
                className="w-full rounded-md border bg-background p-3 text-left text-sm hover:bg-muted"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortLinkRow({ code }: { code: string }) {
  const t = useTranslations("blog");
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/s/${code}`
      : `/s/${code}`;
  return (
    <div className="space-y-2">
      <div className="break-all rounded border bg-background px-2 py-1 font-mono text-xs">
        {url}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(url).then(
            () => toast.success(t("sidebar.shortLinkCopied")),
            () => toast.error(t("sidebar.shortLinkCopyFailed")),
          );
        }}
        className="w-full"
      >
        <Icon icon={Copy} size={12} />
        {t("sidebar.shortLinkCopy")}
      </Button>
    </div>
  );
}
