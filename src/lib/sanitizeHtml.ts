import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize WooCommerce-sourced description HTML for display. WC stores
 * rich HTML (tables, lists, links); we render it but strip anything that
 * could execute — script tags, on* handlers, javascript: URLs. Only the
 * standard formatting tags merchants actually use are allowed through.
 */
export function sanitizeDescriptionHtml(input: string | null | undefined): string {
  if (!input) return "";
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "a",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#)/i,
  });
}
