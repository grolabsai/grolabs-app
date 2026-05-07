"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { CheckCircle2, AlertTriangle } from "lucide-react";

import { useWizard } from "@/components/import/WizardContext";
import { Link } from "@/i18n/routing";
import { createProductsBulk } from "@/lib/actions/import";
import type { CreateProductFullInput } from "@/lib/actions/product";

export function Step6Import({ defaultProductTypeId }: { defaultProductTypeId: number | null }) {
  const t = useTranslations("import.wizard.step6");
  const { state, dispatch } = useWizard();
  const [pending, startTransition] = useTransition();

  function buildPayloads(): CreateProductFullInput[] {
    return state.productBases
      .filter((b) => b.categoryId !== null)
      .map((b) => {
        // Pick a slug derived from base name for now — server normalises if blank
        const slug = b.baseName
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60);

        const variants = b.variants.map((v) => ({
          name: v.label || null,
          sku: v.sku || null,
          barcode: v.barcode || null,
          weightGrams: v.weightGrams ? Number(v.weightGrams) : null,
          listPrice: v.listPrice ? Number(v.listPrice) : null,
          costPrice: v.costPrice ? Number(v.costPrice) : null,
          isActive: true,
          axes: v.axes
            .filter((a) => a.valueId !== null || a.valueText !== null || a.valueNumber !== null)
            .map((a) => ({
              attributeId: typeof a.attributeId === "string" ? Number(a.attributeId) : a.attributeId,
              valueId: a.valueId === null ? null : typeof a.valueId === "string" ? Number(a.valueId) : a.valueId,
              valueText: a.valueText,
              valueNumber: a.valueNumber,
              unitId: a.unitId === null ? null : typeof a.unitId === "string" ? Number(a.unitId) : a.unitId,
            })),
        }));

        return {
          name: b.baseName,
          slug,
          shortDescription: null,
          longDescription: null,
          // For MVP we use the instance's first active product_type for every
          // imported product. A per-base picker is a likely follow-up — surface
          // when a customer's catalog uses multiple product types.
          productTypeId: defaultProductTypeId ?? 0,
          brandId: state.brand.brandId,
          categoryIds: b.categoryId !== null ? [b.categoryId] : [],
          isActive: true,
          trackInventory: true,
          isConsignment: false,
          variants,
          attributeValues: b.variants
            .flatMap((v) => v.attributes)
            .filter((a) => a.valueId !== null || a.valueText !== null)
            .map((a) => ({
              attributeId: typeof a.attributeId === "string" ? Number(a.attributeId) : a.attributeId,
              valueId: a.valueId === null ? null : typeof a.valueId === "string" ? Number(a.valueId) : a.valueId,
              valueText: a.valueText,
            })),
          photos: [],
        } as unknown as CreateProductFullInput;
      });
  }

  function startImport() {
    if (!defaultProductTypeId) {
      toast.error(t("noProductType"));
      return;
    }
    const payloads = buildPayloads();
    if (payloads.length === 0) {
      toast.error(t("nothingToImport"));
      return;
    }
    dispatch({ type: "SET_IMPORTING", on: true });
    startTransition(async () => {
      const r = await createProductsBulk(payloads);
      dispatch({ type: "SET_IMPORTING", on: false });
      dispatch({
        type: "SET_IMPORT_RESULT",
        result: {
          basesCreated: r.basesCreated,
          variantsCreated: r.variantsCreated,
          errors: r.errors,
        },
      });
    });
  }

  const result = state.importResult;
  const totalVariants = state.productBases.reduce((n, b) => n + b.variants.length, 0);

  return (
    <div>
      {!result && !state.importing ? (
        <div className="s-card">
          <p className="s-card-label">{t("title")}</p>
          <p style={{ fontSize: 13, color: "var(--s-text-secondary)", margin: "0 0 16px" }}>
            {t("ready", { bases: state.productBases.length, variants: totalVariants })}
          </p>
          <button
            type="button"
            className="s-btn s-btn-primary"
            disabled={pending}
            onClick={startImport}
          >
            {t("startButton")}
          </button>
        </div>
      ) : null}

      {state.importing ? (
        <div className="s-card" style={{ textAlign: "center", padding: 48 }}>
          <div className="s-spinner" style={{ margin: "0 auto 16px" }} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t("importing")}</div>
          <div style={{ fontSize: 12, color: "var(--s-text-tertiary)", marginTop: 4 }}>
            {t("importingHint")}
          </div>
        </div>
      ) : null}

      {result ? (
        <>
          <div className="s-card" style={{ textAlign: "center" }}>
            {result.errors.length === 0 ? (
              <>
                <Icon icon={CheckCircle2} size={48} />
                <div style={{ fontSize: 18, fontWeight: 500, marginTop: 12 }}>
                  {t("successTitle")}
                </div>
                <div style={{ fontSize: 13, color: "var(--s-text-secondary)", marginTop: 4 }}>
                  {t("successSummary", {
                    bases: result.basesCreated,
                    variants: result.variantsCreated,
                  })}
                </div>
              </>
            ) : (
              <>
                <Icon icon={AlertTriangle} size={48} />
                <div style={{ fontSize: 18, fontWeight: 500, marginTop: 12 }}>
                  {t("partialTitle")}
                </div>
                <div style={{ fontSize: 13, color: "var(--s-text-secondary)", marginTop: 4 }}>
                  {t("partialSummary", {
                    created: result.basesCreated,
                    failed: result.errors.length,
                  })}
                </div>
              </>
            )}

            <div style={{ marginTop: 24, display: "flex", justifyContent: "center", gap: 8 }}>
              <Link href={"/import"} className="s-btn s-btn-secondary" style={{ textDecoration: "none" }}>
                {t("backToImport")}
              </Link>
              <Link href={"/catalog/products"} className="s-btn s-btn-primary" style={{ textDecoration: "none" }}>
                {t("viewProducts")}
              </Link>
            </div>
          </div>

          {result.errors.length > 0 ? (
            <div className="s-card">
              <p className="s-card-label">{t("errorsTitle")}</p>
              <table className="s-table" style={{ minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th>{t("err.col.base")}</th>
                    <th>{t("err.col.message")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{e.baseName}</td>
                      <td style={{ color: "var(--s-danger-text)", fontSize: 12 }}>{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
