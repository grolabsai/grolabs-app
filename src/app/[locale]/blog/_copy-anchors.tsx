"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Add a "copy link" affordance next to every h2/h3 inside the rendered
 * blog post. Pure client-side enhancement — the headings already carry
 * `id` attributes from server-side extractTocAndAnchor().
 *
 * Renders nothing visible. The toast notice is i18n-free on purpose;
 * it's a short ack, not user-facing chrome.
 */
export function CopyHeadingAnchors() {
  useEffect(() => {
    const root = document.getElementById("blog-content");
    if (!root) return;
    const headings = root.querySelectorAll<HTMLElement>("h2[id], h3[id]");
    const handlers: Array<{ el: HTMLElement; fn: () => void }> = [];
    for (const h of headings) {
      h.style.cursor = "pointer";
      h.title = "Copy link";
      const fn = () => {
        const url = `${window.location.origin}${window.location.pathname}#${h.id}`;
        navigator.clipboard.writeText(url).then(
          () => toast.success("Link copied"),
          () => toast.error("Could not copy"),
        );
      };
      h.addEventListener("click", fn);
      handlers.push({ el: h, fn });
    }
    return () => {
      for (const { el, fn } of handlers) el.removeEventListener("click", fn);
    };
  }, []);
  return null;
}
