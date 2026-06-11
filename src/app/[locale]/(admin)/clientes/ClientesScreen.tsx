"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Icon } from "@/components/ui/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Button } from "@/components/ui/button";
import { createCustomerAccount, type TenantSummary } from "@/lib/actions/users";
import { generateStrongPassword } from "@/lib/auth/password";

/**
 * Admin "Clientes" screen (user-management.md §3). GroLabs staff provision a
 * customer in one flow: tenant + domain + first instance + first Tenant Admin,
 * with a one-time password shown once. Gated by isGroLabsAdmin (layout) and by
 * createCustomerAccount server-side.
 */
export function ClientesScreen({
  initialTenants,
}: {
  initialTenants: TenantSummary[];
}) {
  const t = useTranslations("clientes");
  const router = useRouter();

  const [domain, setDomain] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generateStrongPassword());
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit =
    domain.trim().length > 0 &&
    instanceName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length > 0 &&
    !pending;

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
      const result = await createCustomerAccount({
        domain,
        tenantName,
        instanceName,
        email,
        password,
      });
      if (!result.ok) {
        const key =
          result.error === "invalid_domain"
            ? "errors.invalidDomain"
            : result.error === "invalid_email"
              ? "errors.invalidEmail"
              : result.error === "invalid_name"
                ? "errors.invalidName"
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
        // Existing user attached as collaborator — no new password to show.
        toast.success(t("attached"));
      }

      // Reset the form for the next customer; regenerate a fresh password.
      setDomain("");
      setTenantName("");
      setInstanceName("");
      setEmail("");
      setPassword(generateStrongPassword());
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6" style={{ maxWidth: 880 }}>
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
                id="cust-domain"
                label={t("domainLabel")}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                autoComplete="off"
                disabled={pending}
              />
              <FloatingLabelInput
                id="cust-tenant-name"
                label={t("tenantNameLabel")}
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                autoComplete="off"
                disabled={pending}
              />
              <FloatingLabelInput
                id="cust-instance-name"
                label={t("instanceNameLabel")}
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={pending}
              />
              <FloatingLabelInput
                id="cust-email"
                label={t("emailLabel")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                disabled={pending}
              />
            </div>

            <div className="flex items-end gap-2">
              <FloatingLabelInput
                id="cust-password"
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
          {initialTenants.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--gl-text-secondary)" }}>
              {t("empty")}
            </p>
          ) : (
            <div className="grid gap-1">
              <div
                className="grid grid-cols-[2fr_2fr_1fr_1fr_auto] gap-2 px-2 py-1 text-[11px] uppercase tracking-[0.06em]"
                style={{ color: "var(--gl-text-tertiary)" }}
              >
                <span>{t("colDomain")}</span>
                <span>{t("colName")}</span>
                <span>{t("colInstances")}</span>
                <span>{t("colMembers")}</span>
                <span className="sr-only">{t("colOpen")}</span>
              </div>
              {initialTenants.map((tn) => (
                <Link
                  key={tn.tenantId}
                  href={`/clientes/${tn.tenantId}`}
                  className="grid grid-cols-[2fr_2fr_1fr_1fr_auto] items-center gap-2 px-2 py-1.5 text-sm transition-colors hover:bg-[var(--gl-surface-alt)]"
                  style={{
                    color: "var(--gl-text)",
                    borderTop: "0.5px solid var(--gl-border)",
                  }}
                >
                  <span className="truncate font-mono text-xs">{tn.domain ?? ""}</span>
                  <span className="truncate">{tn.name}</span>
                  <span>{tn.instanceCount}</span>
                  <span>{tn.memberCount}</span>
                  <Icon icon={ChevronRight} size={14} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
