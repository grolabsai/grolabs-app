"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * Forced first-login password change form (docs/policy/user-management.md §6).
 * On success it clears user_metadata.must_change_password and routes home; the
 * (app)/(admin) layouts stop redirecting here once the flag is gone.
 */
export function ChangePasswordForm() {
  const t = useTranslations("auth.changePassword");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_PASSWORD_LENGTH && password === confirm;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        setError(t("errorSave"));
        return;
      }
      await supabase.auth.updateUser({ data: { must_change_password: false } });
      window.location.href = "/";
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3" style={{ marginTop: 8 }}>
      <FloatingLabelInput
        id="new-password"
        label={t("newLabel")}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={pending}
        autoFocus
      />
      <FloatingLabelInput
        id="confirm-password"
        label={t("confirmLabel")}
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={pending}
      />
      {tooShort ? (
        <p className="text-xs" style={{ color: "var(--gl-text-secondary)" }}>
          {t("minHint", { min: MIN_PASSWORD_LENGTH })}
        </p>
      ) : null}
      {mismatch ? (
        <p className="text-xs" style={{ color: "var(--gl-text-error, #b91c1c)" }}>
          {t("mismatch")}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs" style={{ color: "var(--gl-text-error, #b91c1c)" }}>
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!valid || pending} className="w-full justify-center">
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
