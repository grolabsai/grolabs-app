import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Base Input — unstyled shadcn primitive.
 */
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-md border border-input bg-background px-3.5 py-3 text-base font-medium tracking-tight text-foreground transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-100",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

/**
 * Base Textarea — same styling rules as Input.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[90px] w-full resize-y rounded-md border border-input bg-background px-3.5 py-3 text-base font-medium leading-relaxed tracking-tight text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-100",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

/**
 * FloatingField — wraps Input or Textarea with a label that floats
 * on the top border. The label has a background punch-out so the
 * border line doesn't cross through the text.
 *
 * Usage:
 *   <FloatingField label="Nombre del producto">
 *     <Input defaultValue="Royal Canin" disabled />
 *   </FloatingField>
 */
function FloatingField({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative mb-4 last:mb-0", className)}>
      <span className="absolute -top-1.5 left-2.5 z-10 inline-flex items-center gap-1 bg-background px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {required && (
          <span className="text-destructive">*</span>
        )}
      </span>
      {children}
    </div>
  );
}

export { Input, Textarea, FloatingField };
