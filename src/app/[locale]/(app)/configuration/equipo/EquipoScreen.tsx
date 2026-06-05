"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTenantUser,
  setTenantUserRole,
  deactivateTenantUser,
  type TenantRole,
  type TenantMemberSummary,
} from "@/lib/actions/users";
import { generateStrongPassword } from "@/lib/auth/password";

/**
 * RRE "Equipo" screen (user-management.md §4). A Tenant Admin creates and
 * manages Admins / Members for their own tenant; each gets access to all of the
 * tenant's instances. Gated by is_tenant_admin (page + every server action).
 */
export function EquipoScreen({
  initialMembers,
}: {
  initialMembers: TenantMemberSummary[];
}) {
  const t = useTranslations("equipo");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("member");
  const [password, setPassword] = useState(() => generateStrongPassword());
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = email.trim().length > 0 && password.length > 0 && !pending;

  function roleLabel(r: string): string {
    return r === "admin" || r === "owner" ? t("roleAdmin") : t("roleMember");
  }

  function copyPassword() {
    if (createdPassword) {
      navigator.clipboard?.writeText(createdPassword);
      toast.success(t("copied"));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setCreatedPassword(null);
    startTransition(async () => {
      const result = await createTenantUser(email, role, password);
      if (!result.ok) {
        const key =
          result.error === "invalid_email"
            ? "errors.invalidEmail"
            : result.error === "unauthorized"
              ? "errors.unauthorized"
              : "errors.saveFailed";
        setError(t(key));
        return;
      }
      if (result.password) {
        setCreatedPassword(result.password);
        setCreatedEmail(email);
        toast.success(t("created"));
      } else {
        toast.success(t("attached"));
      }
      setEmail("");
      setRole("member");
      setPassword(generateStrongPassword());
      router.refresh();
    });
  }

  function changeRole(userId: string, next: TenantRole) {
    startTransition(async () => {
      const res = await setTenantUserRole(userId, next);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      router.refresh();
    });
  }

  function deactivate(userId: string) {
    startTransition(async () => {
      const res = await deactivateTenantUser(userId);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6" style={{ maxWidth: 760 }}>
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--gl-text)" }}>
          {t("title")}
        </h1>
        <p className="text-sm" style={{ color: "var(--gl-text-secondary)" }}>
          {t("subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("newTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FloatingLabelInput
                id="member-email"
                label={t("emailLabel")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                disabled={pending}
              />
              <div className="grid gap-1.5">
                <label
                  htmlFor="member-role"
                  className="text-[10px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--gl-text-tertiary)" }}
                >
                  {t("roleLabel")}
                </label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as TenantRole)}
                  disabled={pending}
                >
                  <SelectTrigger id="member-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{t("roleMember")}</SelectItem>
                    <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-end gap-2">
              <FloatingLabelInput
                id="member-password"
                label={t("passwordLabel")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono text-xs"
                wrapperClassName="flex-1"
                disabled={pending}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setPassword(generateStrongPassword())}
                disabled={pending}
              >
                {t("regenerate")}
              </Button>
            </div>

            {error ? (
              <p className="text-xs" style={{ color: "var(--gl-text-error, #b91c1c)" }}>
                {error}
              </p>
            ) : null}

            <div>
              <Button type="submit" disabled={!canSubmit}>
                {pending ? t("creating") : t("create")}
              </Button>
            </div>
          </form>

          {createdPassword ? (
            <div
              className="mt-4 rounded-[var(--gl-radius-md)] p-3"
              style={{ border: "0.5px solid var(--gl-border)" }}
            >
              <p className="text-xs" style={{ color: "var(--gl-text-secondary)" }}>
                {t("oneTimeNote", { email: createdEmail ?? "" })}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code
                  className="flex-1 rounded px-2 py-1 text-sm"
                  style={{ background: "var(--gl-surface-alt)", color: "var(--gl-text)" }}
                >
                  {createdPassword}
                </code>
                <Button type="button" variant="outline" onClick={copyPassword}>
                  {t("copy")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {initialMembers.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--gl-text-secondary)" }}>
              {t("empty")}
            </p>
          ) : (
            <div className="grid gap-1">
              {initialMembers.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 px-2 py-2 text-sm"
                  style={{
                    color: "var(--gl-text)",
                    borderTop: "0.5px solid var(--gl-border)",
                    opacity: m.isActive ? 1 : 0.5,
                  }}
                >
                  <span className="flex-1 truncate">{m.email}</span>
                  {m.isActive ? (
                    <>
                      <Select
                        value={m.role === "owner" ? "admin" : m.role}
                        onValueChange={(v) => changeRole(m.userId, v as TenantRole)}
                        disabled={pending || m.role === "owner"}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue>{roleLabel(m.role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">{t("roleMember")}</SelectItem>
                          <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                        </SelectContent>
                      </Select>
                      {m.role !== "owner" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => deactivate(m.userId)}
                          disabled={pending}
                        >
                          {t("deactivate")}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--gl-text-tertiary)" }}>
                      {t("inactive")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
