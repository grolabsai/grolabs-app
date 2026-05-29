import DOMPurify from "isomorphic-dompurify";

const WORDS_PER_MINUTE = 220;

/**
 * Strip a string of all HTML to count words for reading-time estimation.
 * Uses a regex (not a DOM) because this runs server-side without a window.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(textOrHtml: string): number {
  const text = stripHtml(textOrHtml);
  if (!text) return 0;
  return text.split(/\s+/).length;
}

export function readingMinutes(textOrHtml: string): number {
  const words = countWords(textOrHtml);
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/**
 * Sanitize Tiptap-generated HTML for public rendering. Keeps the tags
 * Tiptap can emit (headings, lists, blockquote, code, links, images)
 * and strips anything the editor doesn't produce — scripts, iframes,
 * inline event handlers, style attributes carrying javascript:.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "br",
      "strong",
      "em",
      "s",
      "u",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "label",
      "input",
      "a",
      "img",
      "hr",
      "mark",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "div",
      "iframe",
      "span",
      "figure",
      "figcaption",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "rel",
      "target",
      "id",
      "class",
      "style",
      "data-checked",
      "data-type",
      "data-youtube-video",
      "checked",
      "disabled",
      "type",
      "colspan",
      "rowspan",
      "frameborder",
      "allow",
      "allowfullscreen",
      "loading",
    ],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/)/i,
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
  });
}

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Walk the sanitized HTML for `<h2>` and `<h3>` tags, returning a TOC
 * structure and the HTML mutated to include `id="…"` anchors on each
 * heading so we can copy-link to it.
 */
export function extractTocAndAnchor(html: string): {
  html: string;
  toc: TocEntry[];
} {
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";

  const out = html.replace(
    /<(h2|h3)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
    (_match, tag: string, attrs: string | undefined, inner: string) => {
      const text = stripHtml(inner);
      let id = slugify(text);
      const seenCount = seen.get(id);
      if (seenCount !== undefined) {
        seen.set(id, seenCount + 1);
        id = `${id}-${seenCount + 1}`;
      } else {
        seen.set(id, 0);
      }
      toc.push({ id, text, level: tag.toLowerCase() === "h2" ? 2 : 3 });
      const cleanedAttrs = (attrs ?? "").replace(/\sid=("|')[^"']*\1/i, "");
      return `<${tag} id="${id}"${cleanedAttrs}>${inner}</${tag}>`;
    },
  );

  return { html: out, toc };
}
