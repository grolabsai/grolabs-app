"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { FloatingLabelSelect } from "@/components/ui/floating-label-select";
import { useFieldHint } from "@/components/shell/FieldHintContext";
import { Icon } from "@/components/ui/icon";

/**
 * Standard form-field wrappers that combine three GroLabs conventions:
 *
 *   1. Label sits INSIDE the border via FloatingLabelInput / Select —
 *      never a separate <label> above the field.
 *   2. There is NO placeholder. Hints / examples live in the right
 *      Agent panel via useFieldHint and are shown on focus.
 *   3. A small ⓘ icon at the end of the field signals "there's a hint
 *      available." Tapping the icon opens it (focus also opens it).
 *
 * Any new form field in RRE should reach for HintedInput / HintedSelect.
 * The bare <input className="s-input" placeholder="..."> pattern is
 * forbidden — it visually reads as a "label inside" but is invisible
 * to assistive tech and clashes with the agent panel's role.
 */

type HintShape = { label: string; body: string };

function InlineInfoIcon({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        right: 10,
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--gl-text-tertiary)",
        pointerEvents: "none",
        display: "inline-flex",
        opacity: 0.7,
      }}
    >
      <Icon icon={Info} size={13} />
    </span>
  );
}

export type HintedInputProps = React.ComponentProps<typeof FloatingLabelInput> & {
  /** Field hint shown in the right Agent panel on focus. */
  hint?: HintShape | null;
};

export function HintedInput({ hint, ...props }: HintedInputProps) {
  const focusBindings = useFieldHint(hint ?? null);
  return (
    <div style={{ position: "relative" }}>
      <FloatingLabelInput
        {...props}
        {...focusBindings}
        className={[props.className ?? "", hint ? "pr-8" : ""].join(" ")}
      />
      <InlineInfoIcon visible={!!hint} />
    </div>
  );
}

export type HintedSelectProps = React.ComponentProps<typeof FloatingLabelSelect> & {
  hint?: HintShape | null;
};

export function HintedSelect({ hint, children, ...props }: HintedSelectProps) {
  const focusBindings = useFieldHint(hint ?? null);
  return (
    <div style={{ position: "relative" }}>
      <FloatingLabelSelect
        {...props}
        {...focusBindings}
        className={[props.className ?? "", hint ? "pr-8" : ""].join(" ")}
      >
        {children}
      </FloatingLabelSelect>
      {/* Selects already have a built-in dropdown chevron, so the ⓘ
          sits a bit further left to avoid colliding with it. */}
      {hint && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 30,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--gl-text-tertiary)",
            pointerEvents: "none",
            display: "inline-flex",
            opacity: 0.7,
          }}
        >
          <Icon icon={Info} size={13} />
        </span>
      )}
    </div>
  );
}

/**
 * Textarea sibling. The agent panel's hint card is roomy, so use this
 * when the field can carry multi-line input but its example/hint still
 * belongs in the panel.
 */
export function HintedTextarea({
  id,
  label,
  hint,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: HintShape | null;
}) {
  const focusBindings = useFieldHint(hint ?? null);
  return (
    <div style={{ position: "relative" }}>
      <label
        htmlFor={id}
        style={{ color: "var(--gl-text-tertiary)" }}
        className="absolute -top-[7px] left-[10px] z-10 inline-flex items-center gap-1 px-1.5 bg-[var(--gl-surface)] text-[10px] font-medium uppercase tracking-[0.08em] leading-none pointer-events-none"
      >
        {label}
      </label>
      <textarea
        id={id}
        {...props}
        {...focusBindings}
        className={["s-textarea", "pt-[14px] pb-[10px]", className ?? ""].join(" ")}
      />
      {hint && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            color: "var(--gl-text-tertiary)",
            pointerEvents: "none",
            display: "inline-flex",
            opacity: 0.7,
          }}
        >
          <Icon icon={Info} size={13} />
        </span>
      )}
    </div>
  );
}
