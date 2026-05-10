"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TreeMultiSelectCombobox } from "@/components/ui/tree-multiselect";
import {
  saveProvider,
  setProviderActive,
  setProviderBrands,
  type ProviderDetail,
  type ProviderInput,
  type BrandRow,
} from "@/lib/actions/pricing";

/**
 * Single provider editor — used for both create and edit.
 *
 * The form is a controlled React state object; `saveProvider` and
 * `setProviderBrands` run sequentially on submit. Brand assignment is a
 * separate server action so a brand-write failure doesn't roll back the
 * provider write — the user can simply retry from the same form.
 *
 * The visible "Activo" switch defers to setProviderActive when editing,
 * since toggling it in the form payload alone would require the user to
 * hit Save afterwards. For new records, it's part of the initial insert.
 */
export function ProviderForm({
  initial,
  brands,
  initialBrandIds,
}: {
  initial: ProviderDetail | null; // null = create mode
  brands: BrandRow[];
  initialBrandIds: number[];
}) {
  const t = useTranslations("pricing.providerForm");
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();

  const isCreate = initial === null;

  const [form, setForm] = useState<ProviderInput>({
    provider_name: initial?.provider_name ?? "",
    legal_name: initial?.legal_name ?? null,
    tax_id: initial?.tax_id ?? null,
    contact_name: initial?.contact_name ?? null,
    email: initial?.email ?? null,
    phone: initial?.phone ?? null,
    website: initial?.website ?? null,
    address_line: initial?.address_line ?? null,
    city: initial?.city ?? null,
    country: initial?.country ?? "GT",
    payment_terms: initial?.payment_terms ?? null,
    default_currency: initial?.default_currency ?? "GTQ",
    consignment: initial?.consignment ?? false,
    notes: initial?.notes ?? null,
    bank_name: initial?.bank_name ?? null,
    bank_account_number: initial?.bank_account_number ?? null,
    is_active: initial?.is_active ?? true,
  });

  const [selectedBrandIds, setSelectedBrandIds] =
    useState<number[]>(initialBrandIds);

  function update<K extends keyof ProviderInput>(
    key: K,
    value: ProviderInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.provider_name.trim().length < 2) {
      toast.error(t("toastNameRequired"));
      return;
    }
    startSubmit(async () => {
      const res = await saveProvider(initial?.provider_id ?? null, form);
      if (!res.ok) {
        toast.error(t("toastSaveError"), { description: res.error });
        return;
      }
      // Brand assignment is best-effort — failures here surface as a toast
      // but don't roll back the provider write.
      const brandRes = await setProviderBrands(res.providerId, selectedBrandIds);
      if (!brandRes.ok) {
        toast.warning(t("toastBrandsError"), { description: brandRes.error });
      } else {
        toast.success(t("toastSaved"));
      }
      router.push("/pricing/providers");
      router.refresh();
    });
  }

  async function onToggleActive(active: boolean) {
    if (isCreate) {
      update("is_active", active);
      return;
    }
    const res = await setProviderActive(initial!.provider_id, active);
    if (!res.ok) {
      toast.error(t("toastActiveError"), { description: res.error });
      return;
    }
    update("is_active", active);
    toast.success(active ? t("toastActivated") : t("toastDeactivated"));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Identity */}
      <Section title={t("sections.identity")}>
        <Row>
          <Field label={t("fields.provider_name")} required>
            <input
              type="text"
              value={form.provider_name}
              onChange={(e) => update("provider_name", e.target.value)}
              required
              minLength={2}
              style={inputStyle}
            />
          </Field>
          <Field label={t("fields.legal_name")}>
            <input
              type="text"
              value={form.legal_name ?? ""}
              onChange={(e) => update("legal_name", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label={t("fields.tax_id")}>
            <input
              type="text"
              value={form.tax_id ?? ""}
              onChange={(e) => update("tax_id", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
        </Row>
      </Section>

      {/* Brands distributed — sits right after identity so the user
         tags the provider with what they sell before getting into
         contact/banking detail. Uses TreeMultiSelectCombobox so we
         scale gracefully past hundreds of brands. */}
      <Section
        title={t("sections.brands")}
        hint={brands.length === 0 ? t("brands.empty") : t("brands.hint")}
      >
        {brands.length > 0 ? (
          <TreeMultiSelectCombobox
            value={selectedBrandIds}
            onChange={setSelectedBrandIds}
            nodes={brands.map((b) => ({
              id: b.brand_id,
              label: b.brand_name,
              parentId: null,
            }))}
            placeholder={t("brands.placeholder")}
            searchPlaceholder={t("brands.searchPlaceholder")}
            emptyText={t("brands.searchEmpty")}
            removeTagAriaLabel={t("brands.removeTag")}
          />
        ) : null}
      </Section>

      {/* Contact */}
      <Section title={t("sections.contact")}>
        <Row>
          <Field label={t("fields.contact_name")}>
            <input
              type="text"
              value={form.contact_name ?? ""}
              onChange={(e) => update("contact_name", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label={t("fields.email")}>
            <input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => update("email", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label={t("fields.phone")}>
            <input
              type="text"
              value={form.phone ?? ""}
              onChange={(e) => update("phone", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label={t("fields.website")}>
            <input
              type="text"
              value={form.website ?? ""}
              onChange={(e) => update("website", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
        </Row>
      </Section>

      {/* Address */}
      <Section title={t("sections.address")}>
        <Row>
          <Field label={t("fields.address_line")}>
            <input
              type="text"
              value={form.address_line ?? ""}
              onChange={(e) => update("address_line", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label={t("fields.city")}>
            <input
              type="text"
              value={form.city ?? ""}
              onChange={(e) => update("city", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label={t("fields.country")}>
            <input
              type="text"
              value={form.country ?? ""}
              onChange={(e) => update("country", e.target.value || null)}
              style={inputStyle}
              placeholder="GT"
            />
          </Field>
        </Row>
      </Section>

      {/* Commercial */}
      <Section title={t("sections.commercial")}>
        <Row>
          <Field label={t("fields.payment_terms")}>
            <input
              type="text"
              value={form.payment_terms ?? ""}
              onChange={(e) => update("payment_terms", e.target.value || null)}
              style={inputStyle}
              placeholder={t("placeholders.payment_terms")}
            />
          </Field>
          <Field label={t("fields.default_currency")}>
            <Select
              value={form.default_currency ?? "GTQ"}
              onValueChange={(v) => update("default_currency", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GTQ">GTQ</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Row>
        <Row>
          <Field label={t("fields.consignment")}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingTop: 6,
              }}
            >
              <Switch
                checked={form.consignment}
                onCheckedChange={(v) => update("consignment", v)}
              />
              <span style={{ fontSize: 13, color: "var(--s-text-secondary)" }}>
                {form.consignment ? t("yes") : t("no")}
              </span>
            </div>
          </Field>
        </Row>
        <Row>
          <Field label={t("fields.notes")}>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value || null)}
              rows={3}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </Field>
        </Row>
      </Section>

      {/* Banking */}
      <Section title={t("sections.banking")}>
        <Row>
          <Field label={t("fields.bank_name")}>
            <input
              type="text"
              value={form.bank_name ?? ""}
              onChange={(e) => update("bank_name", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label={t("fields.bank_account_number")}>
            <input
              type="text"
              value={form.bank_account_number ?? ""}
              onChange={(e) =>
                update("bank_account_number", e.target.value || null)
              }
              style={inputStyle}
            />
          </Field>
        </Row>
      </Section>

      {/* Status — only show on edit; create defaults to active */}
      {!isCreate ? (
        <Section title={t("sections.status")}>
          <Row>
            <Field label={t("fields.is_active")}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  paddingTop: 6,
                }}
              >
                <Switch
                  checked={form.is_active}
                  onCheckedChange={onToggleActive}
                />
                <span style={{ fontSize: 13, color: "var(--s-text-secondary)" }}>
                  {form.is_active ? t("active") : t("inactive")}
                </span>
              </div>
            </Field>
          </Row>
        </Section>
      ) : null}

      {/* Footer actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          paddingTop: 16,
          borderTop: "1px solid var(--s-border)",
        }}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/pricing/providers")}
        >
          {t("buttons.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("buttons.saving") : t("buttons.save")}
        </Button>
      </div>
    </form>
  );
}

// =============================================================================
// Layout helpers
// =============================================================================

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid var(--s-border-strong)",
  borderRadius: "var(--s-radius-md)",
  background: "var(--s-surface)",
  color: "var(--s-text)",
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--s-surface)",
        border: "1px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: 20,
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--s-text)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {title}
        </h2>
        {hint ? (
          <p
            style={{
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              marginTop: 4,
            }}
          >
            {hint}
          </p>
        ) : null}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--s-text-secondary)",
        }}
      >
        {label}
        {required ? <span style={{ color: "var(--s-danger)" }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}
