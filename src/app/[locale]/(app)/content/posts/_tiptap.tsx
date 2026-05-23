"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Typography from "@tiptap/extension-typography";
import { useEffect, useRef, useState } from "react";
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
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
} from "lucide-react";
import { toast } from "sonner";
import { uploadPostImage } from "@/lib/actions/post";

export interface TiptapEditorProps {
  initialHTML?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
}

const WORDS_PER_MINUTE = 220;

export function TiptapEditor({
  initialHTML = "",
  placeholder,
  onChange,
}: TiptapEditorProps) {
  const t = useTranslations("blog.tiptap");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      CharacterCount,
      Typography,
    ],
    content: initialHTML || "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[400px] focus:outline-none p-4 border rounded-md bg-background",
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
    editor.chain().focus().setImage({ src: res.url }).run();
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
