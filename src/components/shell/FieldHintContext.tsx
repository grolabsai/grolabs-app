"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Field-hint state — shown in the right-side AgentPanel when an input
 * gains focus and cleared when the input loses focus. Replaces the
 * inline "?" icon pattern.
 *
 * Yellow card with the field's label in bold + a multi-line body. Lives
 * in the AgentPanel so it doesn't take any content-area space and
 * doesn't compete with the form itself.
 */

export type FieldHint = {
  /** Field name — rendered bold at the top of the card. */
  label: string;
  /** Multi-line hint body. Can be 4-5 lines, longer if needed. */
  body: string;
};

type FieldHintCtx = {
  active: FieldHint | null;
  setHint: (hint: FieldHint) => void;
  clearHint: () => void;
};

const FieldHintContext = createContext<FieldHintCtx | null>(null);

export function FieldHintProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<FieldHint | null>(null);

  const setHint = useCallback((hint: FieldHint) => setActive(hint), []);
  const clearHint = useCallback(() => setActive(null), []);

  const value = useMemo<FieldHintCtx>(
    () => ({ active, setHint, clearHint }),
    [active, setHint, clearHint],
  );

  return (
    <FieldHintContext.Provider value={value}>
      {children}
    </FieldHintContext.Provider>
  );
}

export function useFieldHintState(): FieldHintCtx {
  const ctx = useContext(FieldHintContext);
  if (!ctx) {
    // Outside the provider — return a no-op state so callers don't
    // need to check (this keeps inputs working on pages without the
    // provider, e.g. the public /diagnostics report).
    return {
      active: null,
      setHint: () => undefined,
      clearHint: () => undefined,
    };
  }
  return ctx;
}

/**
 * Binds a form control to the field-hint state. Spread the returned
 * `onFocus` / `onBlur` handlers onto any input/select/textarea.
 *
 *   const fieldProps = useFieldHint({
 *     label: "Root URL",
 *     body: "Paste your storefront URL. We'll fetch the homepage and detect…"
 *   });
 *
 *   <input className="s-input" {...fieldProps} />
 *
 * Pass `null` (or omit a `body`) to disable — the handlers are then
 * no-ops, useful for fields that don't need a hint.
 */
export function useFieldHint(hint: FieldHint | null) {
  const { setHint, clearHint } = useFieldHintState();
  return useMemo(() => {
    if (!hint) return {};
    return {
      onFocus: () => setHint(hint),
      onBlur: () => clearHint(),
    };
  }, [hint, setHint, clearHint]);
}
