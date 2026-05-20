import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import {
  getActiveAlerts,
  getAlertTiles,
  getGa4Config,
  getGeoTop,
  getSessionTimeseries,
  getTopChannels,
  getTopExitPages,
  getTopLandingPages,
  isGa4Connected,
} from "@/lib/integrations/ga4/fetchers";
import { createClient } from "@/lib/supabase/server";
import { LiveActiveUsers } from "./_live-active-users";

/**
 * /dashboard/traffic — barebones data-layer exerciser.
 *
 * Renders every server-side fetcher's output as labeled blocks. Intentionally
 * unstyled: the visual implementation lands once the design mockups arrive
 * (docs/design/dashboard.md). The point is to prove every fetcher works
 * end-to-end against real data.
 */
export default async function TrafficDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) redirect("/login");
  const instanceId: number = membership.instance_id;

  const connected = await isGa4Connected(instanceId);
  if (!connected) {
    return (
      <div className="s-page-content">
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Traffic dashboard
        </h1>
        <p style={{ fontSize: 14, color: "var(--s-text-secondary)" }}>
          Google Analytics no está conectado para esta instancia.
        </p>
        <Link href="/configuration/ga4" style={{ color: "var(--scout-accent)" }}>
          Conectar Google Analytics →
        </Link>
      </div>
    );
  }

  const [
    cfg,
    tiles,
    timeseries,
    channels,
    landings,
    exits,
    geo,
    alerts,
  ] = await Promise.all([
    getGa4Config(instanceId),
    getAlertTiles(instanceId),
    getSessionTimeseries(instanceId),
    getTopChannels(instanceId),
    getTopLandingPages(instanceId),
    getTopExitPages(instanceId),
    getGeoTop(instanceId),
    getActiveAlerts(instanceId),
  ]);

  return (
    <div className="s-page-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Traffic dashboard (data wiring)</h1>
      <p style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
        Property: {cfg?.property_id ?? ""} · Last pull:{" "}
        {cfg?.last_pull_at ? new Date(cfg.last_pull_at).toLocaleString() : ""}
      </p>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
          Right-now widget
        </h2>
        <LiveActiveUsers />
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
          Alert tiles
        </h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {tiles.map((tile) => (
            <div
              key={tile.metric}
              style={{
                padding: 12,
                border: "0.5px solid var(--s-border)",
                borderRadius: 6,
                minWidth: 200,
                background:
                  tile.status === "firing" ? "var(--s-danger-bg)" : undefined,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                {tile.metric}
              </div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>
                {tile.metric === "engagement_rate"
                  ? `${(tile.current * 100).toFixed(1)}%`
                  : tile.current.toFixed(0)}
              </div>
              <div style={{ fontSize: 11, color: "var(--s-text-secondary)" }}>
                Δ {tile.delta.toFixed(1)}
                {tile.metric === "engagement_rate" ? "pp" : "%"} vs baseline{" "}
                {tile.metric === "engagement_rate"
                  ? `${(tile.baseline * 100).toFixed(1)}%`
                  : tile.baseline.toFixed(0)}
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  color:
                    tile.status === "firing"
                      ? "var(--s-danger-text)"
                      : "var(--s-success-text)",
                }}
              >
                {tile.status}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
          Session time series (14d, with 7d rolling avg)
        </h2>
        <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingRight: 12 }}>date</th>
              <th style={{ textAlign: "right", paddingRight: 12 }}>sessions</th>
              <th style={{ textAlign: "right", paddingRight: 12 }}>rolling avg</th>
              <th style={{ textAlign: "right" }}>engagement_rate</th>
            </tr>
          </thead>
          <tbody>
            {timeseries.map((p) => (
              <tr key={p.date}>
                <td style={{ paddingRight: 12 }}>{p.date}</td>
                <td style={{ textAlign: "right", paddingRight: 12 }}>
                  {p.sessions}
                </td>
                <td style={{ textAlign: "right", paddingRight: 12 }}>
                  {p.rolling_avg_sessions.toFixed(1)}
                </td>
                <td style={{ textAlign: "right" }}>
                  {(p.engagement_rate * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
            {timeseries.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--s-text-tertiary)" }}>
                  no data yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
          Channel mix (today vs 7d)
        </h2>
        <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingRight: 12 }}>channel</th>
              <th style={{ textAlign: "right", paddingRight: 12 }}>sessions today</th>
              <th style={{ textAlign: "right", paddingRight: 12 }}>share today</th>
              <th style={{ textAlign: "right" }}>Δ pp</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.channel}>
                <td style={{ paddingRight: 12 }}>{c.channel}</td>
                <td style={{ textAlign: "right", paddingRight: 12 }}>
                  {c.sessions_today}
                </td>
                <td style={{ textAlign: "right", paddingRight: 12 }}>
                  {(c.share_today * 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: "right" }}>{c.delta_share_pp.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Top landing pages
          </h2>
          <table style={{ fontSize: 12 }}>
            <tbody>
              {landings.map((p) => (
                <tr key={p.page_path}>
                  <td style={{ paddingRight: 12 }}>{p.page_path}</td>
                  <td style={{ paddingRight: 12, textAlign: "right" }}>
                    {p.value}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {p.delta_pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Top exit pages
          </h2>
          <table style={{ fontSize: 12 }}>
            <tbody>
              {exits.map((p) => (
                <tr key={p.page_path}>
                  <td style={{ paddingRight: 12 }}>{p.page_path}</td>
                  <td style={{ paddingRight: 12, textAlign: "right" }}>
                    {p.value}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {p.delta_pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Geo top 5</h2>
        <table style={{ fontSize: 12 }}>
          <tbody>
            {geo.map((g) => (
              <tr key={g.country}>
                <td style={{ paddingRight: 12 }}>{g.country}</td>
                <td style={{ paddingRight: 12, textAlign: "right" }}>
                  {g.sessions}
                </td>
                <td style={{ textAlign: "right" }}>{g.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
          Active alerts ({alerts.length})
        </h2>
        {alerts.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
            No hay alertas activas
          </p>
        ) : (
          <ul style={{ fontSize: 12, paddingLeft: 0, listStyle: "none" }}>
            {alerts.map((a) => (
              <li
                key={a.alert_id}
                style={{
                  padding: 8,
                  border: "0.5px solid var(--s-border)",
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div>
                  <strong>{a.metric}</strong>
                  {a.dimension_key ? ` · ${a.dimension_key}` : null} ·{" "}
                  {a.status}
                </div>
                <div style={{ color: "var(--s-text-secondary)" }}>
                  observed {Number(a.observed_value).toFixed(2)} vs baseline{" "}
                  {Number(a.baseline_value).toFixed(2)} · Δ{" "}
                  {Number(a.delta_pct).toFixed(1)}%
                </div>
                <div style={{ color: "var(--s-text-tertiary)" }}>
                  fired {new Date(a.fired_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
