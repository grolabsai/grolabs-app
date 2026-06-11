"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Email + password sign-in form. Client component so the submit button can
 * react to input: it stays muted (secondary) until the user starts typing a
 * password, then turns yellow (primary). SSO is the primary path on this
 * screen, so the email form should not compete for attention until the user
 * has clearly committed to it. The actual sign-in is the server action passed
 * in via `action`.
 */
export function LoginForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const t = useTranslations("auth.login");
  const [hasPassword, setHasPassword] = useState(false);

  return (
    <form action={action}>
      <div className="s-field">
        <label className="s-field-label" htmlFor="email">
          {t("email")}
        </label>
        <input
          className="s-input"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="s-field">
        <label className="s-field-label" htmlFor="password">
          {t("password")}
        </label>
        <input
          className="s-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          onChange={(e) => setHasPassword(e.target.value.length > 0)}
        />
      </div>
      <button
        className={`s-btn ${hasPassword ? "s-btn-primary" : "s-btn-secondary"}`}
        type="submit"
        style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
      >
        {t("signIn")}
      </button>
    </form>
  );
}
