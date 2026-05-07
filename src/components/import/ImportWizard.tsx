"use client";

import { useTranslations } from "next-intl";

import { Step1Upload } from "@/components/import/Step1Upload";
import { Step2Categories } from "@/components/import/Step2Categories";
import { Step3Grouping } from "@/components/import/Step3Grouping";
import { Step4Mapping } from "@/components/import/Step4Mapping";
import { Step5Review } from "@/components/import/Step5Review";
import { Step6Import } from "@/components/import/Step6Import";
import { WizardProvider, useWizard } from "@/components/import/WizardContext";

export type Brand = { brand_id: number; brand_name: string };
export type Category = { category_id: number; category_name: string; parent_category_id: number | null };

export type SharedProps = {
  brands: Brand[];
  categories: Category[];
  defaultProductTypeId: number | null;
};

export function ImportWizard(props: SharedProps) {
  return (
    <WizardProvider>
      <Inner {...props} />
    </WizardProvider>
  );
}

function Inner({ brands, categories, defaultProductTypeId }: SharedProps) {
  const t = useTranslations("import.wizard");
  const { state, dispatch } = useWizard();

  const steps: Array<{ n: 1 | 2 | 3 | 4 | 5 | 6; key: string }> = [
    { n: 1, key: "step1" },
    { n: 2, key: "step2" },
    { n: 3, key: "step3" },
    { n: 4, key: "step4" },
    { n: 5, key: "step5" },
    { n: 6, key: "step6" },
  ];

  function canGoTo(n: number): boolean {
    if (n <= state.step) return true;
    if (n === 2) return state.parsedFile !== null;
    if (n === 3) return state.parsedFile !== null && state.categoriesAnalyzed && state.categoryAssignments.some((c) => c.categoryId !== null);
    if (n === 4) return state.grouped && state.productBases.length > 0;
    if (n === 5) return state.grouped && state.productBases.length > 0;
    if (n === 6) return state.grouped && state.productBases.length > 0;
    return false;
  }

  return (
    <>
      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-meta">{t("subtitle")}</p>
        </div>
      </div>

      {/* Stepper */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "12px 0 20px",
          marginBottom: 20,
          borderBottom: "0.5px solid var(--s-border)",
          flexWrap: "wrap",
        }}
      >
        {steps.map(({ n, key }) => {
          const active = n === state.step;
          const reachable = canGoTo(n);
          const completed = n < state.step;
          return (
            <button
              key={n}
              type="button"
              onClick={() => reachable && dispatch({ type: "GO_TO_STEP", step: n })}
              disabled={!reachable}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                color: active ? "var(--scout-accent)" : completed ? "var(--s-text)" : "var(--s-text-tertiary)",
                background: active ? "var(--scout-accent-50)" : "transparent",
                border: "none",
                borderRadius: "var(--s-radius-md)",
                cursor: reachable ? "pointer" : "not-allowed",
                opacity: reachable ? 1 : 0.5,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: active ? "var(--scout-accent)" : completed ? "var(--s-success)" : "var(--s-surface-alt)",
                  color: active || completed ? "white" : "var(--s-text-tertiary)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {n}
              </span>
              {t(`${key}.label`)}
            </button>
          );
        })}
      </div>

      {/* Active step */}
      <div>
        {state.step === 1 && <Step1Upload />}
        {state.step === 2 && <Step2Categories brands={brands} categories={categories} />}
        {state.step === 3 && <Step3Grouping categories={categories} />}
        {state.step === 4 && <Step4Mapping />}
        {state.step === 5 && <Step5Review categories={categories} />}
        {state.step === 6 && <Step6Import defaultProductTypeId={defaultProductTypeId} />}
      </div>
    </>
  );
}
