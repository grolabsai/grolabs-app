import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { mergeAnalysisConfig } from "@/lib/analytics/analysis-config";
import { SIGNAL_METRICS } from "@/lib/analytics/signals";
import { AnalysisSettingsForm, type GoalRowDef } from "./_form";

/**
 * Configuration → Analysis: the per-instance variables behind the Signals
 * engine and the canonical charts — timezone, week shape, currency, the
 * delta threshold, the noise guards, and the per-metric intentional band
 * (target + lower threshold). Presets are applied at instance creation
 * (DB column default); this screen is where a store tunes them.
 */
export default async function AnalysisConfigurationPage() {
  const t = await getTranslations("configuration.analysis");
  const tm = await getTranslations("dashboard.signals.metric");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const supabase = await createClient();
  const { data: instance } = await supabase
    .from("instance")
    .select("timezone, default_currency, analysis_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (!instance) redirect("/login");

  const config = mergeAnalysisConfig(instance.analysis_config);
  const goalRows: GoalRowDef[] = SIGNAL_METRICS.map((d) => ({
    key: d.key,
    label: tm(d.key),
    isMoney: d.kind === "money",
    isRate: d.kind === "rate",
  }));

  return (
    <div className="s-page-content">
      <div className="s-page-header" style={{ marginBottom: 8 }}>
        <h1 className="s-page-title">{t("title")}</h1>
      </div>
      <p style={{ color: "var(--gl-text-secondary)", fontSize: 13.5, maxWidth: "70ch", margin: "0 0 24px" }}>
        {t("intro")}
      </p>
      <AnalysisSettingsForm
        initialTimezone={instance.timezone ?? "UTC"}
        initialCurrency={instance.default_currency ?? "USD"}
        config={config}
        goalRows={goalRows}
      />
    </div>
  );
}
