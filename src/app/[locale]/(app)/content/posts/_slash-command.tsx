"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ForwardedRef,
} from "react";

/**
 * Slash command — `/` opens a Notion-style insertion menu. Each item runs
 * a `command(editor, range)` callback when selected. Filter is substring,
 * case-insensitive, against the item's title and search aliases.
 *
 * Mounted as a portal next to the cursor. Positioning is computed from
 * Suggestion's `clientRect` callback — no popup library.
 */

export interface SlashCommandItem {
  title: string;
  description: string;
  search: string;
  command: (editor: Editor, range: Range) => void;
}

interface CommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

interface CommandListHandle {
  onKeyDown: (e: { event: KeyboardEvent }) => boolean;
}

const CommandList = forwardRef(function CommandList(
  { items, command }: CommandListProps,
  ref: ForwardedRef<CommandListHandle>,
) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + items.length - 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-72 rounded-md border bg-popover p-2 text-xs text-muted-foreground shadow-md">
        No matching command.
      </div>
    );
  }

  return (
    <div className="max-h-80 w-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          onClick={() => command(item)}
          onMouseEnter={() => setSelected(i)}
          className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
            i === selected ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium">{item.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {item.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
});

interface SlashCommandOptions {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, "editor">;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor, range);
        },
        items: () => [],
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

/**
 * Build the popup render lifecycle. Returns a function suitable for
 * `Suggestion.render`. The popup is a plain absolutely-positioned div;
 * no Tippy.js dependency.
 */
export function buildSlashRender() {
  return () => {
    let renderer: ReactRenderer<CommandListHandle, CommandListProps> | null = null;
    let popup: HTMLDivElement | null = null;

    function position(rect: DOMRect | null | undefined) {
      if (!popup || !rect) return;
      popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
      popup.style.left = `${rect.left + window.scrollX}px`;
    }

    return {
      onStart: (props: {
        editor: Editor;
        clientRect?: (() => DOMRect | null) | null;
        items: SlashCommandItem[];
        command: (item: SlashCommandItem) => void;
      }) => {
        renderer = new ReactRenderer(CommandList, {
          props,
          editor: props.editor,
        });
        popup = document.createElement("div");
        popup.style.position = "absolute";
        popup.style.zIndex = "60";
        popup.appendChild(renderer.element);
        document.body.appendChild(popup);
        position(props.clientRect?.());
      },
      onUpdate: (props: {
        clientRect?: (() => DOMRect | null) | null;
        items: SlashCommandItem[];
      }) => {
        renderer?.updateProps(props);
        position(props.clientRect?.());
      },
      onKeyDown: (props: { event: KeyboardEvent }) => {
        if (props.event.key === "Escape") {
          popup?.remove();
          renderer?.destroy();
          renderer = null;
          popup = null;
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        popup?.remove();
        renderer?.destroy();
        renderer = null;
        popup = null;
      },
    };
  };
}
