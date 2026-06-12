"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import { ChevronLeft, KeyRound, Check } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { FloatingLabelSelect } from "@/components/ui/floating-label-select";
import {
  adminUpdateUserName,
  adminResetUserPassword,
  adminSetTenantUserRole,
  adminSetTenantUserActive,
  type AdminTenantUser,
  type TenantDetail,
  type TenantRole,
} from "@/lib/actions/users";

/**
 * Admin "Clientes" detail screen. GroLabs staff open one tenant and manage its
 * users: edit display name, reset password (one-time temp shown once + forced
 * change on next login), change role, activate/deactivate. Every action is
 * re-gated server-side by is_grolabs_admin. Per docs/policy/user-management.md
 * §3 / §8.
 */
export function TenantUsersScreen({
  tenant,
  initialUsers,
}: {
  tenant: TenantDetail;
  initialUsers: AdminTenantUser[];
}) {
  const t = useTranslations("clientes");
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="grid gap-6" style={{ maxWidth: 880 }}>
      <div className="grid gap-2">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: "var(--gl-text-secondary)" }}
        >
          <Icon icon={ChevronLeft} size={14} />
          {t("backToList")}
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold" style={{ color: "var(--gl-text)" }}>
            {tenant.name || tenant.domain || t("untitledTenant")}
          </h1>
          {tenant.kind === "template_owner" ? (
            <Badge variant="secondary">{t("kindTemplate")}</Badge>
          ) : null}
        </div>
        <p className="text-sm" style={{ color: "var(--gl-text-secondary)" }}>
          <span className="font-mono text-xs">{tenant.domain ?? ""}</span>
          {tenant.instances.length > 0 ? (
            <>
              {" · "}
              {t("instanceCount", { count: tenant.instances.length })}
            </>
          ) : null}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("usersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {initialUsers.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--gl-text-secondary)" }}>
              {t("noUsers")}
            </p>
          ) : (
            <div className="grid gap-1">
              {initialUsers.map((u) => (
                <UserRow
                  key={u.userId}
                  tenantId={tenant.tenantId}
                  user={u}
                  open={openId === u.userId}
                  onToggle={() =>
                    setOpenId((id) => (id === u.userId ? null : u.userId))
                  }
                  onChanged={() => router.refresh()}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({
  tenantId,
  user,
  open,
  onToggle,
  onChanged,
}: {
  tenantId: number;
  user: AdminTenantUser;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("clientes");
  const [name, setName] = useState(user.fullName ?? "");
  const [role, setRole] = useState<TenantRole>(
    user.role === "admin" || user.role === "owner" ? "admin" : "member",
  );
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isSSO = user.provider !== "email";

  function saveName() {
    startTransition(async () => {
      const res = await adminUpdateUserName(tenantId, user.userId, name);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(t("nameSaved"));
      onChanged();
    });
  }

  function saveRole(next: TenantRole) {
    setRole(next);
    startTransition(async () => {
      const res = await adminSetTenantUserRole(tenantId, user.userId, next);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(t("roleSaved"));
      onChanged();
    });
  }

  function resetPassword() {
    startTransition(async () => {
      const res = await adminResetUserPassword(tenantId, user.userId);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      setTempPassword(res.password);
      toast.success(t("passwordReset"));
      onChanged();
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const res = await adminSetTenantUserActive(tenantId, user.userId, !user.isActive);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(user.isActive ? t("deactivated") : t("activated"));
      onChanged();
    });
  }

  function copyTemp() {
    if (tempPassword) {
      navigator.clipboard?.writeText(tempPassword);
      toast.success(t("copied"));
    }
  }

  return (
    <div style={{ borderTop: "0.5px solid var(--gl-border)" }}>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[2fr_1.4fr_auto] items-center gap-2 px-2 py-2 text-left text-sm"
        style={{ color: "var(--gl-text)" }}
      >
        <span className="min-w-0">
          <span className="block truncate">{user.email}</span>
          {user.fullName ? (
            <span
              className="block truncate text-xs"
              style={{ color: "var(--gl-text-secondary)" }}
            >
              {user.fullName}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-1.5">
          <Badge variant={user.role === "admin" || user.role === "owner" ? "default" : "secondary"}>
            {t(user.role === "admin" || user.role === "owner" ? "roleAdmin" : "roleMember")}
          </Badge>
          {isSSO ? <Badge variant="outline">{user.provider}</Badge> : null}
        </span>
        <span
          className="justify-self-end text-xs"
          style={{ color: user.isActive ? "var(--gl-text-secondary)" : "var(--gl-text-error, #b91c1c)" }}
        >
          {user.isActive ? t("statusActive") : t("statusInactive")}
        </span>
      </button>

      {open ? (
        <div className="grid gap-4 px-2 pb-4 pt-1">
          <div className="flex items-end gap-2">
            <FloatingLabelInput
              id={`name-${user.userId}`}
              label={t("nameLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              wrapperClassName="flex-1"
              disabled={pending}
            />
            <Button
              type="button"
              variant="outline"
              onClick={saveName}
              disabled={pending || name === (user.fullName ?? "")}
            >
              {t("saveName")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FloatingLabelSelect
              id={`role-${user.userId}`}
              label={t("roleLabel")}
              value={role}
              onChange={(e) => saveRole(e.target.value as TenantRole)}
              disabled={pending}
            >
              <option value="admin">{t("roleAdmin")}</option>
              <option value="member">{t("roleMember")}</option>
            </FloatingLabelSelect>

            <div className="flex items-end">
              <Button
                type="button"
                variant={user.isActive ? "outline" : "default"}
                onClick={toggleActive}
                disabled={pending}
                className="w-full"
              >
                {user.isActive ? t("deactivate") : t("activate")}
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetPassword}
                disabled={pending || isSSO}
              >
                <Icon icon={KeyRound} size={14} />
                {t("resetPassword")}
              </Button>
              {isSSO ? (
                <span className="text-xs" style={{ color: "var(--gl-text-secondary)" }}>
                  {t("ssoNoPassword", { provider: user.provider })}
                </span>
              ) : null}
            </div>

            {tempPassword ? (
              <div
                className="rounded-[var(--gl-radius-md)] p-3"
                style={{ border: "0.5px solid var(--gl-border)" }}
              >
                <p className="flex items-center gap-1 text-xs" style={{ color: "var(--gl-text-secondary)" }}>
                  <Icon icon={Check} size={13} />
                  {t("oneTimeNote", { email: user.email })}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code
                    className="flex-1 rounded px-2 py-1 text-sm"
                    style={{ background: "var(--gl-surface-alt)", color: "var(--gl-text)" }}
                  >
                    {tempPassword}
                  </code>
                  <Button type="button" variant="outline" onClick={copyTemp}>
                    {t("copy")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
