"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FloatingLabelSelect — the select counterpart of FloatingLabelInput.
 * Renders a native <select> with the label cutting through the top
 * border, identical in look to the input variant so forms feel uniform.
 *
 * Usage:
 *   <FloatingLabelSelect id="locale" label="Locale" value={value}
 *     onChange={(e) => setValue(e.target.value)}>
 *     <option value="en">English</option>
 *     <option value="es">Español</option>
 *   </FloatingLabelSelect>
 */
export interface FloatingLabelSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  id: string;
  wrapperClassName?: string;
}

const FloatingLabelSelect = React.forwardRef<
  HTMLSelectElement,
  FloatingLabelSelectProps
>(({ label, id, className, wrapperClassName, children, ...props }, ref) => {
  return (
    <div
      className={cn(
        "relative",
        // On focus, the label turns accent-yellow to match the select border.
        "[&:focus-within>label]:text-[color:var(--gl-accent)]",
        wrapperClassName,
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          "absolute -top-[7px] left-[10px] z-10",
          "inline-flex items-center gap-1 px-1.5",
          "bg-[var(--gl-surface)]",
          // Base color as a class (not inline) so the focus-within variant wins.
          "text-[color:var(--gl-text-tertiary)] transition-colors",
          "text-[10px] font-medium uppercase tracking-[0.08em]",
          "leading-none",
          "pointer-events-none",
        )}
      >
        {label}
      </label>
      <select
        id={id}
        ref={ref}
        className={cn("s-select", "pt-[11px] pb-[9px] h-10", className)}
        {...props}
      >
        {children}
      </select>
    </div>
  );
});
FloatingLabelSelect.displayName = "FloatingLabelSelect";

export { FloatingLabelSelect };
