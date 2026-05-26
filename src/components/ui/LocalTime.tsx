"use client";

import { useEffect, useState } from "react";

/**
 * Renders an ISO timestamp in the user's browser timezone.
 *
 * Server-renders an empty placeholder (no flash of UTC time) and fills
 * in the formatted local-tz string after hydration. We can't know the
 * user's tz on the server without explicit input, so client-rendering
 * is the simplest correct path.
 */
export function LocalTime({
  iso,
  fallback = "",
  options = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
}: {
  iso: string | null;
  fallback?: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    // setState inside an effect is intentional here: we must defer
    // toLocaleString to after hydration so it picks up the browser's
    // timezone (the SSR pass renders with Vercel's UTC, which is wrong
    // for every viewer). Same pattern used by ThemeSwitcher.
    let next: string | null;
    if (iso == null) {
      next = null;
    } else {
      const d = new Date(iso);
      next = Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleString(undefined, options);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormatted(next);
  }, [iso, options]);

  if (iso == null) return <>{fallback}</>;
  return <span suppressHydrationWarning>{formatted ?? ""}</span>;
}
