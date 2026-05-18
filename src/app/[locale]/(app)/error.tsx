"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useActivityStream } from "@/components/shell/ActivityStreamContext";

/**
 * Route-segment error boundary for the whole authenticated app. Next.js
 * renders this in place of the segment's children when an uncaught error
 * bubbles up; the (app) layout (and so ActivityStreamProvider) stays
 * mounted, so we can record the failure into the Activity Stream.
 *
 * Next's error boundary gives us { error, digest } — there is no React
 * componentStack here (that exists only on class error boundaries), so we
 * surface message + stack + digest instead.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("activityStream");
  const { emit } = useActivityStream();

  useEffect(() => {
    emit({
      actor: "system",
      type: "error.uncaught",
      severity: "error",
      title: `Uncaught error: ${error.message}`,
      payload: {
        message: error.message,
        stack: error.stack,
        digest: error.digest,
      },
    });
  }, [error, emit]);

  return (
    <div className="s-content" style={{ padding: 32 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        {error.message || "Error"}
      </h1>
      <p style={{ fontSize: 13, color: "var(--s-text-secondary)", marginBottom: 16 }}>
        {t("title")}
      </p>
      <button type="button" className="s-btn s-btn-secondary" onClick={reset}>
        Retry
      </button>
    </div>
  );
}
