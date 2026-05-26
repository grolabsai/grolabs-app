"use client";

import { useTranslations } from "next-intl";
import { useFieldHintState } from "@/components/shell/FieldHintContext";

export function ScanStatusBadge({
  status,
  errorMessage,
  startedAt,
}: {
  status: string;
  errorMessage: string | null;
  startedAt: string | null;
}) {
  const t = useTranslations("prospects.page");
  const { setHint } = useFieldHintState();
  const color =
    status === "completed"
      ? "var(--s-success)"
      : status === "failed"
        ? "var(--s-danger)"
        : "var(--s-text-tertiary)";

  const clickable = status === "failed" && errorMessage != null;

  const inner = (
    <span
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color,
        fontWeight: 600,
      }}
    >
      {status}
      {clickable && <span style={{ marginLeft: 6, opacity: 0.7 }}>ⓘ</span>}
    </span>
  );

  if (!clickable) return inner;

  return (
    <button
      type="button"
      onClick={() =>
        setHint({
          label: t("scanTable.failureLabel"),
          body:
            `${t("detail.when")}: ${startedAt ?? "—"}\n\n` +
            `${t("detail.errorMessage")}:\n${errorMessage}`,
        })
      }
      title={t("revealDetail")}
      style={{ all: "unset", cursor: "pointer" }}
    >
      {inner}
    </button>
  );
}
