"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * FloatingLabelInput
 *
 * An outlined input where the label is always rendered in the "floated"
 * position — absolutely placed at -7px from the top of the wrapper, with
 * horizontal padding and bg-background so it visually cuts through the
 * input's border. Matches the GroLabs .s-field pattern, but built
 * on the shadcn Input primitive.
 *
 * The label is ALWAYS visible (not animated). Use this for every form
 * field across the app so all inputs look identical.
 *
 * Usage:
 *   <FloatingLabelInput id="name" label="Nombre del producto" />
 *   <FloatingLabelInput id="slug" label="Slug" className="font-mono text-xs" />
 */

export interface FloatingLabelInputProps
  extends React.ComponentProps<typeof Input> {
  /** Visible label — pass the translated string from t(), never a raw literal */
  label: string;
  /** Must match the Input's id for accessible label association */
  id: string;
  /** Additional className forwarded to the wrapper div */
  wrapperClassName?: string;
}

const FloatingLabelInput = React.forwardRef<
  HTMLInputElement,
  FloatingLabelInputProps
>(({ label, id, className, wrapperClassName, ...props }, ref) => {
  return (
    <div className={cn("relative", wrapperClassName)}>
      {/* Label cuts through the top border via z-index + background match */}
      <label
        htmlFor={id}
        style={{ color: "var(--s-text-tertiary)" }}
        className={cn(
          // Positioning: sits on top of the border line
          "absolute -top-[7px] left-[10px] z-10",
          // Padding cuts a gap through the border visually
          "inline-flex items-center gap-1 px-1.5",
          // Must be white so label visually cuts through the input's border
          "bg-white",
          // Typography — matches .s-field-label
          "text-[10px] font-medium uppercase tracking-[0.06em]",
          "leading-none",
          // Disabled state mirrors the input
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        )}
      >
        {label}
      </label>

      <Input
        id={id}
        ref={ref}
        className={cn(
          // Extra top padding so text doesn't collide with the label cutout
          "pt-[11px] pb-[9px] h-10",
          className,
        )}
        {...props}
      />
    </div>
  );
});

FloatingLabelInput.displayName = "FloatingLabelInput";

export { FloatingLabelInput };
