"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { FigureImage, type FigureImageAlign } from "./_figure-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Typography from "@tiptap/extension-typography";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Youtube from "@tiptap/extension-youtube";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";
import { useEffect, useMemo, useRef, useState } from "react";
import { SlashCommand, buildSlashRender, type SlashCommandItem } from "./_slash-command";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
  Sparkles,
  Wand2,
  ChevronDown,
  Table as TableIcon,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Film as YoutubeIcon,
  Minus,
  Braces,
  Palette,
  X as XIcon,
  Maximize2,
  Captions,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { uploadPostImage } from "@/lib/actions/post";
import {
  aiContinueWriting,
  aiRewriteSelection,
  aiSuggestAltText,
} from "@/lib/actions/blog-ai";
import { aiGenerateImage, aiTransformImage } from "@/lib/actions/blog-image";
import type { TransformKind } from "@/lib/ai/image";
import type { RewriteAction } from "@/lib/ai/blog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TiptapEditorProps {
  initialHTML?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
}

const WORDS_PER_MINUTE = 220;

/**
 * The fixed catalog of slash-menu commands. Search is a space-joined
 * alias string used for fuzzy-ish substring matching — add common
 * keywords (`bulletlist`, `ul`, `dash`, …) so the menu finds the item
 * however the writer phrases it.
 */
function buildSlashItems(): SlashCommandItem[] {
  return [
    {
      title: "Heading 1",
      description: "Top-level heading",
      search: "h1 heading 1 title",
      command: (e) => e.chain().focus().setNode("heading", { level: 1 }).run(),
    },
    {
      title: "Heading 2",
      description: "Section heading",
      search: "h2 heading 2 section",
      command: (e) => e.chain().focus().setNode("heading", { level: 2 }).run(),
    },
    {
      title: "Heading 3",
      description: "Subsection heading",
      search: "h3 heading 3 subsection",
      command: (e) => e.chain().focus().setNode("heading", { level: 3 }).run(),
    },
    {
      title: "Bullet list",
      description: "Unordered list",
      search: "bullet list ul unordered dash",
      command: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "Ordered list",
      search: "numbered list ol ordered",
      command: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      title: "Task list",
      description: "Checkboxes",
      search: "task todo checkbox checklist",
      command: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
      title: "Quote",
      description: "Blockquote",
      search: "quote blockquote citation",
      command: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      title: "Code block",
      description: "Syntax-highlighted code",
      search: "code block snippet program",
      command: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      description: "Horizontal rule",
      search: "divider hr horizontal rule separator",
      command: (e) => e.chain().focus().setHorizontalRule().run(),
    },
    {
      title: "Table",
      description: "3×3 table",
      search: "table grid",
      command: (e) =>
        e
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: "YouTube",
      description: "Embed a YouTube video",
      search: "youtube video embed yt",
      command: (e) => {
        const url = window.prompt("YouTube URL");
        if (url) {
          e.commands.setYoutubeVideo({ src: url, width: 640, height: 360 });
        }
      },
    },
  ];
}

export function TiptapEditor({
  initialHTML = "",
  placeholder,
  onChange,
}: TiptapEditorProps) {
  const t = useTranslations("blog.tiptap");
  const tAi = useTranslations("blog.ai");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageAltText, setImageAltText] = useState("");
  const [transforming, setTransforming] = useState(false);
  const lowlight = useMemo(() => createLowlight(common), []);
  // Ref so the Tiptap editorProps handlers (created at mount time)
  // can reach the latest editor instance even after later re-renders.
  const uploadHandlerRef = useRef<(file: File) => void>(() => {});
  const bubbleMenuRef = useRef<HTMLDivElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // disabled in favor of CodeBlockLowlight
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      FigureImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "paragraph"
            ? (placeholder ?? "Type / for commands…")
            : "",
      }),
      CharacterCount,
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: false }),
      Youtube.configure({ controls: true, nocookie: true }),
      CodeBlockLowlight.configure({ lowlight }),
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          allowSpaces: false,
          items: ({ query }: { query: string }) =>
            buildSlashItems().filter((item) =>
              item.search.toLowerCase().includes(query.toLowerCase()),
            ),
          render: buildSlashRender(),
          command: ({
            editor,
            range,
            props,
          }: {
            editor: import("@tiptap/core").Editor;
            range: import("@tiptap/core").Range;
            props: SlashCommandItem;
          }) => {
            editor.chain().focus().deleteRange(range).run();
            props.command(editor, range);
          },
        },
      }),
    ],
    content: initialHTML || "<p></p>",
    immediatelyRender: false,
    // Re-render React on every transaction so toolbar buttons that read
    // `editor.isActive(...)` reflect the current selection (notably the
    // image-align/caption buttons that only show when an image is
    // selected). Cheap for our editor size; replace with `useEditorState`
    // if it becomes a perf bottleneck.
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[400px] focus:outline-none p-4 border rounded-md bg-background tiptap-blog",
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) uploadHandlerRef.current(file);
        return true;
      },
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItems = items.filter((it) => it.type.startsWith("image/"));
        if (imageItems.length === 0) return false;
        event.preventDefault();
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) uploadHandlerRef.current(file);
        }
        return true;
      },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML());
    },
  });

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Bubble menu — register the ProseMirror plugin after both the
  // editor and the menu DOM element are mounted. Tiptap v3 moved
  // BubbleMenu to a non-React extension that needs an HTMLElement.
  useEffect(() => {
    if (!editor || !bubbleMenuRef.current) return;
    const el = bubbleMenuRef.current;
    el.style.visibility = "hidden"; // hidden until first show
    const plugin = BubbleMenuPlugin({
      pluginKey: "bubbleMenu",
      editor,
      element: el,
      updateDelay: 100,
      shouldShow: ({ editor: ed, from, to }) => {
        if (from === to) return false;
        if (ed.isActive("codeBlock")) return false;
        // The image toolbar above already handles images.
        if (ed.isActive("image")) return false;
        return true;
      },
    });
    editor.registerPlugin(plugin);
    return () => {
      editor.unregisterPlugin("bubbleMenu");
    };
  }, [editor]);

  async function insertImage() {
    fileInputRef.current?.click();
  }

  async function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    await uploadAndInsertFile(file);
  }

  /**
   * Upload a File/Blob to the inline-images bucket, suggest alt text
   * via Claude vision in parallel, and insert into the editor. Used
   * by the toolbar button, drag-and-drop, and paste-from-clipboard.
   */
  async function uploadAndInsertFile(file: File) {
    if (!editor) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "inline");
    const res = await uploadPostImage(fd);
    setUploading(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    // Insert immediately with empty alt; suggest in the background so
    // the writer can keep typing. They can edit it later via the alt
    // input on the image (alignment toolbar — separate feature).
    editor.chain().focus().setImage({ src: res.url, alt: "" }).run();

    aiSuggestAltText(res.url).then((altRes) => {
      if (!altRes.ok || !editor) return;
      // Find the image node we just inserted and update its alt attr.
      const { state } = editor;
      let imagePos: number | null = null;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.src === res.url) {
          imagePos = pos;
          return false;
        }
      });
      if (imagePos !== null) {
        editor
          .chain()
          .focus(imagePos)
          .updateAttributes("image", { alt: altRes.data })
          .setNodeSelection(imagePos)
          .blur()
          .run();
        toast.success(tAi("imageAltSuggested"));
      }
    });
  }

  // Keep the upload handler ref pointed at the latest closure so
  // editorProps.handleDrop / handlePaste (created at mount) reach
  // the current editor instance.
  useEffect(() => {
    uploadHandlerRef.current = uploadAndInsertFile;
  });

  function promptLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("linkPrompt"), previous ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  async function onContinueWriting() {
    if (!editor) return;
    const html = editor.getHTML();
    if (!editor.getText().trim()) {
      toast.error(tAi("emptyContent"));
      return;
    }
    setAiPending(true);
    const res = await aiContinueWriting({
      content: html,
      contentFormat: "html",
    });
    setAiPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // Insert as new paragraphs at the end. Preserve paragraph breaks.
    const paragraphs = res.data.split(/\n\s*\n/).filter(Boolean);
    const chain = editor.chain().focus("end");
    for (const p of paragraphs) {
      chain.insertContent({ type: "paragraph", content: [{ type: "text", text: p.trim() }] });
    }
    chain.run();
    toast.success(tAi("continued"));
  }

  async function onRewrite(action: RewriteAction) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      toast.error(tAi("noSelection"));
      return;
    }
    const selection = editor.state.doc.textBetween(from, to, "\n");
    if (!selection.trim()) {
      toast.error(tAi("noSelection"));
      return;
    }
    setAiPending(true);
    const res = await aiRewriteSelection({
      selection,
      action,
      context: { content: editor.getHTML(), contentFormat: "html" },
    });
    setAiPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    editor.chain().focus().insertContentAt({ from, to }, res.data).run();
    toast.success(tAi("rewritten"));
  }

  function openImageDialog() {
    setImagePrompt("");
    setImagePreviewUrl(null);
    setImageAltText("");
    setImageDialogOpen(true);
  }

  async function onGenerateImage() {
    if (!imagePrompt.trim()) {
      toast.error(tAi("imagePromptRequired"));
      return;
    }
    setImageGenerating(true);
    setImagePreviewUrl(null);
    const res = await aiGenerateImage(imagePrompt);
    setImageGenerating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setImagePreviewUrl(res.data.url);
  }

  function onInsertGeneratedImage() {
    if (!editor || !imagePreviewUrl) return;
    editor
      .chain()
      .focus()
      .setImage({ src: imagePreviewUrl, alt: imageAltText.trim() || imagePrompt })
      .run();
    setImageDialogOpen(false);
    toast.success(tAi("imageInserted"));
  }

  async function onTransformImage(kind: TransformKind) {
    if (!editor) return;
    const sourceUrl = editor.getAttributes("image").src as string | undefined;
    if (!sourceUrl) {
      toast.error(tAi("imageTransformNoSelection"));
      return;
    }
    setTransforming(true);
    toast.message(tAi("imageTransforming"), { duration: 60000, id: "transform" });
    const res = await aiTransformImage({ sourceUrl, kind });
    setTransforming(false);
    toast.dismiss("transform");
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // Replace the image src in place — keep alt/align/caption attrs.
    editor
      .chain()
      .focus()
      .updateAttributes("image", { src: res.data.url })
      .run();
    toast.success(tAi("imageTransformed"));
  }

  if (!editor) {
    return (
      <div className="min-h-[400px] animate-pulse rounded-md border bg-muted/20" />
    );
  }

  const words = editor.storage.characterCount.words() as number;
  const readingMinutes = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));

  const tbBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground";
  const tbBtnActive = "bg-muted text-foreground";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-0.5 rounded-md border bg-background p-1">
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("heading", { level: 1 }) ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          aria-label={t("h1")}
        >
          <Icon icon={Heading1} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("heading", { level: 2 }) ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          aria-label={t("h2")}
        >
          <Icon icon={Heading2} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("heading", { level: 3 }) ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          aria-label={t("h3")}
        >
          <Icon icon={Heading3} size={14} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("bold") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label={t("bold")}
        >
          <Icon icon={Bold} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("italic") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label={t("italic")}
        >
          <Icon icon={Italic} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("strike") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          aria-label={t("strike")}
        >
          <Icon icon={Strikethrough} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("code") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleCode().run()}
          aria-label={t("code")}
        >
          <Icon icon={Code} size={14} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("bulletList") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          aria-label={t("bulletList")}
        >
          <Icon icon={List} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("orderedList") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label={t("orderedList")}
        >
          <Icon icon={ListOrdered} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("blockquote") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          aria-label={t("quote")}
        >
          <Icon icon={Quote} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("taskList") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          aria-label={t("taskList")}
          title={t("taskList")}
        >
          <Icon icon={ListChecks} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("highlight") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          aria-label={t("highlight")}
          title={t("highlight")}
        >
          <Icon icon={Highlighter} size={14} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={`${tbBtn} ${editor.isActive({ textAlign: "left" }) ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          aria-label={t("alignLeft")}
          title={t("alignLeft")}
        >
          <Icon icon={AlignLeft} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive({ textAlign: "center" }) ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          aria-label={t("alignCenter")}
          title={t("alignCenter")}
        >
          <Icon icon={AlignCenter} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive({ textAlign: "right" }) ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          aria-label={t("alignRight")}
          title={t("alignRight")}
        >
          <Icon icon={AlignRight} size={14} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={tbBtn}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          aria-label={t("divider")}
          title={t("divider")}
        >
          <Icon icon={Minus} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("codeBlock") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          aria-label={t("codeBlock")}
          title={t("codeBlock")}
        >
          <Icon icon={Braces} size={14} />
        </button>
        <button
          type="button"
          className={tbBtn}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          aria-label={t("table")}
          title={t("table")}
        >
          <Icon icon={TableIcon} size={14} />
        </button>
        <button
          type="button"
          className={tbBtn}
          onClick={() => {
            const url = window.prompt(t("youtubePrompt"));
            if (url) editor.commands.setYoutubeVideo({ src: url, width: 640, height: 360 });
          }}
          aria-label={t("youtube")}
          title={t("youtube")}
        >
          <Icon icon={YoutubeIcon} size={14} />
        </button>
        <button
          type="button"
          className={tbBtn}
          onClick={openImageDialog}
          aria-label={tAi("imageGenerate")}
          title={tAi("imageGenerate")}
        >
          <Icon icon={Palette} size={14} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("link") ? tbBtnActive : ""}`}
          onClick={promptLink}
          aria-label={t("link")}
        >
          <Icon icon={LinkIcon} size={14} />
        </button>
        <button
          type="button"
          className={tbBtn}
          onClick={insertImage}
          disabled={uploading}
          aria-label={t("image")}
        >
          <Icon icon={ImageIcon} size={14} />
        </button>

        {editor.isActive("image") && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            {(["left", "center", "right", "full"] as FigureImageAlign[]).map(
              (a) => {
                const Icn =
                  a === "left"
                    ? AlignLeft
                    : a === "right"
                    ? AlignRight
                    : a === "full"
                    ? Maximize2
                    : AlignCenter;
                return (
                  <button
                    key={a}
                    type="button"
                    className={`${tbBtn} ${
                      editor.isActive("image", { align: a }) ? tbBtnActive : ""
                    }`}
                    onClick={() => editor.chain().focus().setImageAlign(a).run()}
                    aria-label={t(`imageAlign.${a}`)}
                    title={t(`imageAlign.${a}`)}
                  >
                    <Icn className="h-3.5 w-3.5" />
                  </button>
                );
              },
            )}
            <button
              type="button"
              className={tbBtn}
              onClick={() => {
                const current =
                  (editor.getAttributes("image").caption as string) ?? "";
                const next = window.prompt(t("imageCaptionPrompt"), current);
                if (next === null) return;
                editor.chain().focus().setImageCaption(next.trim()).run();
              }}
              aria-label={t("imageCaption")}
              title={t("imageCaption")}
            >
              <Icon icon={Captions} size={14} />
            </button>
            <button
              type="button"
              className={tbBtn}
              onClick={() => {
                const current =
                  (editor.getAttributes("image").alt as string) ?? "";
                const next = window.prompt(t("imageAltPrompt"), current);
                if (next === null) return;
                editor
                  .chain()
                  .focus()
                  .updateAttributes("image", { alt: next.trim() })
                  .run();
              }}
              aria-label={t("imageAlt")}
              title={t("imageAlt")}
            >
              <Icon icon={Type} size={14} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`${tbBtn} w-auto px-1.5`}
                  disabled={transforming}
                  aria-label={tAi("imageTransform")}
                  title={tAi("imageTransform")}
                >
                  <Icon icon={Wand2} size={14} />
                  <Icon icon={ChevronDown} size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onSelect={() => onTransformImage("restyle")}>
                  {tAi("imageTransformRestyle")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onTransformImage("recolor")}>
                  {tAi("imageTransformRecolor")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onTransformImage("conceptualize")}
                >
                  {tAi("imageTransformConceptualize")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={tbBtn}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          aria-label={t("undo")}
        >
          <Icon icon={Undo} size={14} />
        </button>
        <button
          type="button"
          className={tbBtn}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          aria-label={t("redo")}
        >
          <Icon icon={Redo} size={14} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          className={tbBtn}
          onClick={onContinueWriting}
          disabled={aiPending}
          aria-label={tAi("continue")}
          title={tAi("continue")}
        >
          <Icon icon={Sparkles} size={14} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`${tbBtn} w-auto px-1.5`}
              disabled={aiPending}
              aria-label={tAi("rewrite")}
              title={tAi("rewrite")}
            >
              <Icon icon={Wand2} size={14} />
              <Icon icon={ChevronDown} size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={() => onRewrite("shorter")}>
              {tAi("rewriteShorter")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("longer")}>
              {tAi("rewriteLonger")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("clearer")}>
              {tAi("rewriteClearer")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("formal")}>
              {tAi("rewriteFormal")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("casual")}>
              {tAi("rewriteCasual")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("grammar")}>
              {tAi("rewriteGrammar")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-3 pr-2 text-xs text-muted-foreground">
          <span>{t("words", { count: words })}</span>
          <span>{t("readingTime", { minutes: readingMinutes })}</span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onImageFile}
      />

      <div
        ref={bubbleMenuRef}
        className="flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md"
        style={{ position: "absolute", zIndex: 30 }}
      >
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("bold") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label={t("bold")}
        >
          <Icon icon={Bold} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("italic") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label={t("italic")}
        >
          <Icon icon={Italic} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("strike") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          aria-label={t("strike")}
        >
          <Icon icon={Strikethrough} size={14} />
        </button>
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("highlight") ? tbBtnActive : ""}`}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          aria-label={t("highlight")}
        >
          <Icon icon={Highlighter} size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <button
          type="button"
          className={`${tbBtn} ${editor.isActive("link") ? tbBtnActive : ""}`}
          onClick={promptLink}
          aria-label={t("link")}
        >
          <Icon icon={LinkIcon} size={14} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`${tbBtn} w-auto px-1.5`}
              disabled={aiPending}
              aria-label={tAi("rewrite")}
              title={tAi("rewrite")}
            >
              <Icon icon={Wand2} size={14} />
              <Icon icon={ChevronDown} size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={() => onRewrite("shorter")}>
              {tAi("rewriteShorter")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("longer")}>
              {tAi("rewriteLonger")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("clearer")}>
              {tAi("rewriteClearer")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("formal")}>
              {tAi("rewriteFormal")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("casual")}>
              {tAi("rewriteCasual")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRewrite("grammar")}>
              {tAi("rewriteGrammar")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EditorContent editor={editor} />

      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon icon={Palette} size={14} />
              {tAi("imageGenerate")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder={tAi("imagePromptPlaceholder")}
              rows={3}
              className="w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {tAi("imageBrandHint")}
            </p>

            {imageGenerating && (
              <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
                {tAi("imageGenerating")}
              </div>
            )}

            {imagePreviewUrl && !imageGenerating && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreviewUrl}
                  alt=""
                  className="aspect-video w-full rounded-md border object-cover"
                />
                <input
                  type="text"
                  value={imageAltText}
                  onChange={(e) => setImageAltText(e.target.value)}
                  placeholder={tAi("imageAltPlaceholder")}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setImageDialogOpen(false)}
              disabled={imageGenerating}
            >
              <Icon icon={XIcon} size={12} />
              {tAi("imageCancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onGenerateImage}
              disabled={imageGenerating || !imagePrompt.trim()}
            >
              <Icon icon={Sparkles} size={12} />
              {imagePreviewUrl ? tAi("imageRegenerate") : tAi("imageGenerateBtn")}
            </Button>
            {imagePreviewUrl && (
              <Button
                type="button"
                size="sm"
                onClick={onInsertGeneratedImage}
                disabled={imageGenerating}
              >
                {tAi("imageInsert")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
