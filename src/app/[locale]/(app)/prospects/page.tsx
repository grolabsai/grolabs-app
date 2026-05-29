import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { NewRunForm } from "./_new-run-form";
import { LocalTime } from "@/components/ui/LocalTime";

export const dynamic = "force-dynamic";

type ProspectRow = {
  prospect_id: number;
  url: string;
  display_name: string | null;
  logo_url: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_position: string | null;
  contact_email: string | null;
  platform_detected: string | null;
  engine_detected: string | null;
  updated_at: string;
};

type RunSummary = {
  prospect_id: number;
  overall_score: number | null;
  est_annual_uplift_usd: number | null;
  completed_at: string | null;
};

type VerticalRow = {
  vertical_id: number;
  vertical_name: string;
};

export default async function ProspectsPage() {
  const t = await getTranslations("prospects.list");
  const instanceId = await currentInstanceId();

  if (instanceId === null) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">{t("sessionExpired")}</span>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: prospectsRaw }, { data: verticalsRaw }, { data: runsRaw }] = await Promise.all([
    supabase
      .from("prospect")
      .select(
        "prospect_id, url, display_name, logo_url, contact_first_name, contact_last_name, contact_position, contact_email, platform_detected, engine_detected, updated_at",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("vertical")
      .select("vertical_id, vertical_name")
      .order("vertical_name"),
    supabase
      .from("diagnostic_run")
      .select("prospect_id, overall_score, est_annual_uplift_usd, completed_at")
      .eq("run_status", "completed")
      .order("completed_at", { ascending: false }),
  ]);

  const prospects: ProspectRow[] = (prospectsRaw ?? []) as ProspectRow[];
  const verticals: VerticalRow[] = (verticalsRaw ?? []) as VerticalRow[];
  const runs: RunSummary[] = (runsRaw ?? []) as RunSummary[];

  // Latest completed run per prospect (the array is already sorted desc).
  const latestByProspect = new Map<number, RunSummary>();
  for (const r of runs) {
    if (!latestByProspect.has(r.prospect_id)) latestByProspect.set(r.prospect_id, r);
  }

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/prospects/rubric"
            className="s-btn"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {t("editRubricButton")}
          </Link>
          <Link
            href="/prospects/benchmarks"
            className="s-btn"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {t("benchmarksButton")}
          </Link>
        </div>
      </div>

      <NewRunForm verticals={verticals} />

      {prospects.length === 0 ? (
        <div
          style={{
            background: "var(--s-surface)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-lg)",
            padding: 32,
            textAlign: "center",
            color: "var(--s-text-tertiary)",
            fontSize: 13,
          }}
        >
          {t("empty.title")}
        </div>
      ) : (
        <div
          style={{
            background: "var(--s-surface)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-lg)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "0.5px solid var(--s-border)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("prospectsTitle")} ({prospects.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("table.url")}</Th>
                <Th>{t("table.contact")}</Th>
                <Th>{t("table.platform")}</Th>
                <Th>{t("table.lastScore")}</Th>
                <Th>{t("table.lastUplift")}</Th>
                <Th>{t("table.lastScanned")}</Th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => {
                const latest = latestByProspect.get(p.prospect_id) ?? null;
                const contactName = [p.contact_first_name, p.contact_last_name]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr
                    key={p.prospect_id}
                    style={{ borderTop: "1px solid var(--s-border)" }}
                  >
                    <Td>
                      <Link
                        href={`/prospects/${p.prospect_id}` as never}
                        style={{
                          color: "var(--s-text)",
                          textDecoration: "none",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <ProspectLogo url={p.logo_url} fallback={p.url} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>
                            {p.display_name ?? p.url}
                          </div>
                          {p.display_name && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--s-text-tertiary)",
                                fontFamily: "var(--s-font-mono)",
                              }}
                            >
                              {p.url}
                            </div>
                          )}
                        </div>
                      </Link>
                    </Td>
                    <Td>
                      {contactName ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{contactName}</div>
                          {p.contact_position && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--s-text-tertiary)",
                              }}
                            >
                              {p.contact_position}
                            </div>
                          )}
                        </div>
                      ) : p.contact_email ? (
                        <span style={{ color: "var(--s-text-tertiary)" }}>
                          {p.contact_email}
                        </span>
                      ) : (
                        ""
                      )}
                    </Td>
                    <Td>
                      {p.platform_detected ?? ""}
                      {p.engine_detected && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--s-text-tertiary)",
                            fontFamily: "var(--s-font-mono)",
                          }}
                        >
                          {p.engine_detected}
                        </div>
                      )}
                    </Td>
                    <Td mono>{latest?.overall_score ?? ""}</Td>
                    <Td mono>
                      {latest?.est_annual_uplift_usd != null
                        ? `$${Math.round(latest.est_annual_uplift_usd).toLocaleString()}`
                        : ""}
                    </Td>
                    <Td>
                      <LocalTime iso={latest?.completed_at ?? null} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProspectLogo({
  url,
  fallback,
}: {
  url: string | null;
  fallback: string;
}) {
  // 32px square logo badge. <img> is intentional — these point at
  // arbitrary remote URLs and we don't want next/image's domain
  // whitelist to gate them. onError swap to Google's s2 favicon
  // service as a graceful degrade.
  let initialSrc = url;
  if (!initialSrc) {
    try {
      const host = new URL(fallback).host;
      initialSrc = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    } catch {
      initialSrc = null;
    }
  }
  if (!initialSrc) {
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "var(--s-surface-alt)",
          border: "0.5px solid var(--s-border)",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={initialSrc}
      alt=""
      width={32}
      height={32}
      style={{
        width: 32,
        height: 32,
        objectFit: "contain",
        background: "#ffffff",
        borderRadius: 6,
        border: "0.5px solid var(--s-border)",
        flexShrink: 0,
        padding: 2,
      }}
    />
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: "left",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
        borderBottom: "0.5px solid var(--s-border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: "10px 14px",
        fontSize: 13,
        color: "var(--s-text)",
        fontFamily: mono
          ? "var(--s-font-mono, ui-monospace, monospace)"
          : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
