"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
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
} from "lucide-react";
import { toast } from "sonner";
import { uploadPostImage } from "@/lib/actions/post";
import {
  aiContinueWriting,
  aiRewriteSelection,
} from "@/lib/actions/blog-ai";
import type { RewriteAction } from "@/lib/ai/blog";
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
  const lowlight = useMemo(() => createLowlight(common), []);

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
      Image.configure({ inline: false, allowBase64: false }),
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
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[400px] focus:outline-none p-4 border rounded-md bg-background tiptap-blog",
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

  async function insertImage() {
    fileInputRef.current?.click();
  }

  async function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    // Prompt for alt text before uploading. Empty alt is allowed (decorative),
    // but the prompt nudges the writer to think about accessibility.
    const altRaw = window.prompt(t("imageAltPrompt"), "");
    if (altRaw === null) return;
    const alt = altRaw.trim();
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
    editor.chain().focus().setImage({ src: res.url, alt }).run();
  }

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

      <EditorContent editor={editor} />
    </div>
  );
}
