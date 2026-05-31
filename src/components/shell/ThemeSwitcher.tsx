"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/**
 * Dark/light theme toggle for the topbar.
 *
 * The app defaults to dark (the Engineered Luxury palette). Adding a
 * `.gl-light` class to <html> flips every --gl-* and shadcn HSL var
 * to the light variant defined in globals.css. We persist the user's
 * pick in localStorage under `rre-theme` and re-apply on mount.
 *
 * SSR-safe: until the effect fires, we render the moon icon (the
 * default-dark state). After mount we may swap to sun if light is
 * stored. No layout shift since both icons are the same size.
 */
const STORAGE_KEY = "rre-theme";

function readStoredTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (theme === "light") {
    html.classList.add("gl-light");
  } else {
    html.classList.remove("gl-light");
  }
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    // Reading localStorage is a client-only operation; we deliberately
    // sync it into state on mount. Same shape used by every theme
    // toggle in the wild — the alternative (read in render) would
    // cause an SSR/CSR hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    applyTheme(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / quota — non-fatal */
    }
  }

  // Before mount we don't know which way the toggle should read; render
  // the dark-default icon (Sun = "switch to light"). Same icon position
  // post-mount when theme is "dark". Avoids a hydration flicker.
  const showSun = !mounted ? true : theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={showSun ? "Switch to light theme" : "Switch to dark theme"}
      title={showSun ? "Light mode" : "Dark mode"}
      style={{
        height: 28,
        width: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "0.5px solid var(--gl-border)",
        borderRadius: "var(--gl-radius-md)",
        background: "var(--gl-surface)",
        color: "var(--gl-text-secondary)",
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--gl-accent)";
        e.currentTarget.style.borderColor = "var(--gl-border-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--gl-text-secondary)";
        e.currentTarget.style.borderColor = "var(--gl-border)";
      }}
    >
      <Icon icon={showSun ? Sun : Moon} size={14} strokeWidth={1.5} />
    </button>
  );
}
