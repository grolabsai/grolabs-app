"use client";

import { useEffect, useState } from "react";

/**
 * Reading progress bar — sticky 3px sliver at the top of the article
 * page. Width tracks scroll position from the article element to the
 * bottom of the document. Uses `requestAnimationFrame` to throttle
 * scroll handlers so it doesn't trigger layout thrash on long posts.
 */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    function update() {
      raf = 0;
      const article = document.getElementById("blog-content");
      if (!article) return;
      const start = article.offsetTop;
      const total = article.offsetHeight;
      const y = window.scrollY + window.innerHeight * 0.5;
      const pct = Math.max(0, Math.min(1, (y - start) / total));
      setProgress(pct);
    }
    function onScroll() {
      if (raf === 0) raf = requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]"
    >
      <div
        className="h-full origin-left transition-transform duration-150 ease-out"
        style={{
          transform: `scaleX(${progress})`,
          background: "var(--blog-primary, #9C5530)",
        }}
      />
    </div>
  );
}
