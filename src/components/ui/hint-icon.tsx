"use client";

import { cn } from "@/lib/utils";

/**
 * The hint affordance for form inputs.
 *
 * Sits inside the trailing edge of an input. Visible only when the
 * input is empty (CSS sibling selector against `:placeholder-shown`,
 * which is why every input using this pattern must declare
 * `placeholder=" "` — a non-empty placeholder attribute is what
 * activates the pseudo-class). Hovering the circle reveals a small
 * tooltip carrying the hint copy that used to live as placeholder
 * text inside the field.
 *
 * Required fields render the circle in kinetic yellow so the eye
 * can sweep a form and catch what's mandatory before clicking
 * "Save" and watching the validator complain.
 */
export function HintIcon({
  hint,
  required,
  className,
}: {
  hint: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("s-hint-icon", required && "s-hint-icon--required", className)}
      role="tooltip"
      aria-label={hint}
    >
      <span aria-hidden="true">?</span>
      <span className="s-hint-icon-tip">{hint}</span>
    </span>
  );
}
