"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared shell for the portable analytics blocks under
 * `src/components/analytics/*`. Every block renders one of these so the page
 * gets consistent typography, padding, and loading/error/empty placeholders —
 * and moving a block to another page costs nothing because the surface is
 * uniform.
 *
 * Each block owns its own data fetching and decides when to render the
 * `loading`, `error`, `empty`, or `children` slot. Keep this primitive dumb;
 * push variation into the block itself.
 */

type Props = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Toolbar slot on the right of the header — used by blocks with a
   * period selector. */
  toolbar?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyLabel?: React.ReactNode;
  loadingLabel?: React.ReactNode;
  /** Optional bottom strip (e.g. "Últimos 7 días · N consultas"). */
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

export function MetricCard({
  title,
  description,
  toolbar,
  loading,
  error,
  empty,
  emptyLabel,
  loadingLabel,
  footer,
  className,
  children,
}: Props) {
  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
        {loadingLabel ?? "…"}
      </div>
    );
  } else if (error) {
    body = (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700">
        {error}
      </div>
    );
  } else if (empty) {
    body = (
      <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
        {emptyLabel ?? "—"}
      </div>
    );
  } else {
    body = children;
  }

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description ? (
            <CardDescription className="text-xs">{description}</CardDescription>
          ) : null}
        </div>
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 pt-2">{body}</CardContent>
      {footer ? (
        <div className="border-t px-6 py-2 text-[11px] text-muted-foreground">{footer}</div>
      ) : null}
    </Card>
  );
}

/** Big numeric headline rendered above any sublines a block adds. */
export function BigValue({
  value,
  unit,
  tone = "default",
}: {
  value: React.ReactNode;
  unit?: React.ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "text-3xl font-semibold tabular-nums leading-none tracking-tight",
          tone === "muted" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
      {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
    </div>
  );
}
