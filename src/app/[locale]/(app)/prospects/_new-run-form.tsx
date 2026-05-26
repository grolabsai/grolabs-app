"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFieldHint } from "@/components/shell/FieldHintContext";
import { startDiagnostic, setProspectEconomics } from "./_actions";

export function NewRunForm({
  verticals,
}: {
  verticals: { vertical_id: number; vertical_name: string }[];
}) {
  const t = useTranslations("prospects.list");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [pdpUrl, setPdpUrl] = useState("");
  const [categoryUrl, setCategoryUrl] = useState("");
  const [name, setName] = useState("");
  const [verticalId, setVerticalId] = useState<number | null>(null);
  const [annualTraffic, setAnnualTraffic] = useState("");
  const [aov, setAov] = useState("");

  // Field hints — focus any input to surface these in the AgentPanel.
  // Multi-line copy is fine; the yellow card accommodates 4-5 lines.
  const rootUrlHint = useFieldHint({
    label: t("form.rootUrl"),
    body:
      "Paste the storefront's home page (example.com). We'll fetch the homepage once, auto-detect the industry, pick a featured product and a category to probe, and probe the search box. Mandatory — everything else is optional.",
  });
  const pdpUrlHint = useFieldHint({
    label: t("form.pdpUrl"),
    body:
      "A specific product detail page to audit. If left empty, we'll auto-pick one from the homepage (featured / best-seller block first, otherwise the first product link we find).",
  });
  const categoryUrlHint = useFieldHint({
    label: t("form.categoryUrl"),
    body:
      "A category / collection / listing page. Required to score faceting (filter depth, count display, multi-select). If empty, the faceting check is skipped and shows as N/A.",
  });
  const nameHint = useFieldHint({
    label: t("form.displayName"),
    body:
      "Optional human-readable name for the prospect (e.g. \"Acme Pet Co.\"). Shown in the prospect list. If empty, we use the URL.",
  });
  const verticalHint = useFieldHint({
    label: t("form.vertical"),
    body:
      "Override the industry vertical. Leave on \"Generic\" and we'll auto-classify the storefront from its homepage content. Setting this explicitly skips the classifier and locks the vertical for revenue benchmarks and test vocabulary.",
  });
  const trafficHint = useFieldHint({
    label: t("form.annualTraffic"),
    body:
      "Estimated annual sessions across the storefront. Used to compute the dollar uplift per finding (traffic × stage share × baseline CR × AOV × Δ rate × headroom). Skip and the per-finding uplift stays blank.",
  });
  const aovHint = useFieldHint({
    label: t("form.aov"),
    body:
      "Average order value in USD. Lets the revenue formula convert percentage uplifts into dollar amounts. If unset, the per-vertical benchmark default is used.",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Persist economics on the prospect *before* the run starts so the
      // revenue formula can consume them. Best-effort; failure here
      // shouldn't block the diagnostic.
      const trafficNum = annualTraffic.trim() ? Number(annualTraffic) : null;
      const aovNum = aov.trim() ? Number(aov) : null;
      if (trafficNum != null || aovNum != null) {
        await setProspectEconomics({
          url,
          est_annual_traffic: trafficNum,
          est_aov_usd: aovNum,
        });
      }
      const result = await startDiagnostic({
        url,
        pdpUrl: pdpUrl || null,
        categoryUrl: categoryUrl || null,
        prospectName: name || null,
        verticalId,
      });
      if ("error" in result) {
        setError(result.error === "EMPTY_URL" ? t("form.errorEmptyUrl") : result.error);
      } else {
        router.push(`/prospects/runs/${result.runId}`);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--s-text)",
          marginBottom: 12,
        }}
      >
        {t("form.title")}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr) auto", gap: 10, alignItems: "end" }}>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.rootUrl")}
          </label>
          <input
            type="text"
            className="s-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder=" "
            required
            {...rootUrlHint}
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.pdpUrl")}
          </label>
          <input
            type="text"
            className="s-input"
            value={pdpUrl}
            onChange={(e) => setPdpUrl(e.target.value)}
            placeholder=" "
            {...pdpUrlHint}
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.categoryUrl")}
          </label>
          <input
            type="text"
            className="s-input"
            value={categoryUrl}
            onChange={(e) => setCategoryUrl(e.target.value)}
            placeholder=" "
            {...categoryUrlHint}
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.displayName")}
          </label>
          <input
            type="text"
            className="s-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder=" "
            {...nameHint}
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.vertical")}
          </label>
          <select
            className="s-input"
            value={verticalId ?? ""}
            data-empty={verticalId == null ? "true" : "false"}
            onChange={(e) => setVerticalId(e.target.value ? Number(e.target.value) : null)}
            {...verticalHint}
          >
            <option value="">—</option>
            {verticals.map((v) => (
              <option key={v.vertical_id} value={v.vertical_id}>
                {v.vertical_name}
              </option>
            ))}
          </select>
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.annualTraffic")}
          </label>
          <input
            type="number"
            className="s-input"
            value={annualTraffic}
            onChange={(e) => setAnnualTraffic(e.target.value)}
            placeholder=" "
            {...trafficHint}
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.aov")}
          </label>
          <input
            type="number"
            step="0.01"
            className="s-input"
            value={aov}
            onChange={(e) => setAov(e.target.value)}
            placeholder=" "
            {...aovHint}
          />
        </div>
        <button
          type="submit"
          className="s-btn s-btn-primary"
          disabled={isPending}
          style={{ height: 36 }}
        >
          {isPending ? t("form.running") : t("form.runButton")}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--s-danger)" }}>
          {error}
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--s-text-tertiary)",
        }}
      >
        {t("form.hint")}
      </div>
    </form>
  );
}
