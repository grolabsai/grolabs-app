import { getTranslations } from "next-intl/server";
import { EventsLogLive } from "@/components/configuration/events-log-live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Live raw-events viewer for the selected instance. A debug surface to watch
 * exactly what the storefront (WP plugin / SDK) is recording into analytics_event,
 * step by step. Reads via /api/events-log (service-role, scoped to the caller's
 * current instance).
 */
export default async function EventsLogPage() {
  const t = await getTranslations("configuration.events");
  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
      </div>
      <EventsLogLive />
    </div>
  );
}
