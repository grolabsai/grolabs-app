"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Wraps the dashboard grid and plays the fill-in reveal once, when scrolled
 * into view (IntersectionObserver, then disconnect). Honors reduced-motion by
 * jumping straight to the final state. Mirrors the design handoff's behavior.
 */
export function InsightsReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dash = ref.current;
    if (!dash) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      dash.classList.add("go");
      return;
    }

    // The grid is taller than the viewport, so a high threshold can never be
    // met — fire as soon as the top scrolls in.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            dash.classList.add("go");
            io.disconnect();
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(dash);
    return () => io.disconnect();
  }, []);

  return (
    <div className="gro-id" data-bg="dark">
      <div className="dash" ref={ref}>
        {children}
      </div>
    </div>
  );
}
