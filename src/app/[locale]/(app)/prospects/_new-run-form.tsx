"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
            placeholder="example.com"
            required
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.pdpUrl")} <span style={{ color: "var(--s-text-tertiary)", fontWeight: 400 }}>({t("form.optional")})</span>
          </label>
          <input
            type="text"
            className="s-input"
            value={pdpUrl}
            onChange={(e) => setPdpUrl(e.target.value)}
            placeholder={t("form.pdpUrlPlaceholder")}
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.categoryUrl")} <span style={{ color: "var(--s-text-tertiary)", fontWeight: 400 }}>({t("form.optional")})</span>
          </label>
          <input
            type="text"
            className="s-input"
            value={categoryUrl}
            onChange={(e) => setCategoryUrl(e.target.value)}
            placeholder={t("form.categoryUrlPlaceholder")}
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
          />
        </div>
        <div className="s-field" style={{ marginBottom: 0 }}>
          <label className="s-field-label" style={{ fontSize: 11 }}>
            {t("form.vertical")}
          </label>
          <select
            className="s-input"
            value={verticalId ?? ""}
            onChange={(e) => setVerticalId(e.target.value ? Number(e.target.value) : null)}
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
            placeholder="500000"
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
            placeholder="45"
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
