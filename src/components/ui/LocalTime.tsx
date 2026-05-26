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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (iso == null) {
      setFormatted(null);
      return;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      setFormatted(iso);
      return;
    }
    setFormatted(d.toLocaleString(undefined, options));
  }, [iso, options]);

  if (iso == null) return <>{fallback}</>;
  return <span suppressHydrationWarning>{formatted ?? ""}</span>;
}
