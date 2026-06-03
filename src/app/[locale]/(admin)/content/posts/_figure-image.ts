import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";

export type FigureImageAlign = "left" | "center" | "right" | "full";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    figureImage: {
      setImageAlign: (align: FigureImageAlign) => ReturnType;
      setImageCaption: (caption: string) => ReturnType;
    };
  }
}

/**
 * Image with caption + alignment, rendered as a `<figure>`.
 *
 * Storage shape:
 *   <figure class="img-align-{left|center|right|full}">
 *     <img src="…" alt="…" />
 *     <figcaption>caption…</figcaption>  ← optional, omitted when empty
 *   </figure>
 *
 * Reuses the default Image node's name so existing `<img>`-only
 * content keeps working — `parseHTML` handles both shapes.
 */
export const FigureImage = Image.extend({
  // Keep the same name so old posts that contain bare <img> continue
  // to parse against this extension.
  name: "image",
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "center",
        rendered: false,
        parseHTML: (el) => {
          const parent = (el as HTMLElement).parentElement;
          const cls = parent?.className ?? "";
          const m = cls.match(/img-align-(left|center|right|full)/);
          return m ? m[1] : "center";
        },
      },
      caption: {
        default: "",
        rendered: false,
        parseHTML: (el) => {
          const parent = (el as HTMLElement).parentElement;
          if (!parent || parent.tagName.toLowerCase() !== "figure") return "";
          return parent.querySelector("figcaption")?.textContent ?? "";
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[class*='img-align-']",
        contentElement: "img",
        getAttrs: (node) => {
          const fig = node as HTMLElement;
          const img = fig.querySelector("img");
          if (!img) return false;
          const cls = fig.className;
          const m = cls.match(/img-align-(left|center|right|full)/);
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            align: m ? m[1] : "center",
            caption:
              fig.querySelector("figcaption")?.textContent?.trim() ?? "",
          };
        },
      },
      { tag: "img[src]" },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const align = (node.attrs.align ?? "center") as FigureImageAlign;
    const caption = (node.attrs.caption ?? "") as string;
    const imgAttrs = mergeAttributes(
      this.options.HTMLAttributes ?? {},
      HTMLAttributes,
    );
    // Strip our custom attrs from the img so the DOM stays clean
    delete (imgAttrs as Record<string, unknown>).align;
    delete (imgAttrs as Record<string, unknown>).caption;
    if (caption.trim()) {
      return [
        "figure",
        { class: `img-align-${align}` },
        ["img", imgAttrs],
        ["figcaption", caption],
      ];
    }
    return ["figure", { class: `img-align-${align}` }, ["img", imgAttrs]];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align }),
      setImageCaption:
        (caption) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { caption }),
    };
  },
});
