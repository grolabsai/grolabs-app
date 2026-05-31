import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { AddProspectPageForm, ProspectActions, RescanPageClient } from "./_client";
import { LocalTime } from "@/components/ui/LocalTime";

export const dynamic = "force-dynamic";

type Prospect = {
  prospect_id: number;
  url: string;
  display_name: string | null;
  logo_url: string | null;
  vertical_id: number | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_position: string | null;
  contact_email: string | null;
  platform_detected: string | null;
  engine_detected: string | null;
  est_annual_traffic: number | null;
  est_aov_usd: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Page = {
  prospect_page_id: number;
  url: string;
  page_type: string;
  label: string | null;
  is_featured: boolean;
  is_active: boolean;
  discovered_via: string | null;
  created_at: string;
};

type ScanRow = {
  scan_id: number;
  prospect_page_id: number;
  run_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  overall_score: number | null;
  est_annual_uplift_usd: number | null;
};

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  const { prospectId: idParam } = await params;
  const prospectId = parseInt(idParam, 10);
  if (Number.isNaN(prospectId)) notFound();

  const t = await getTranslations("prospects.detail");
  const instanceId = await currentInstanceId();
  if (instanceId === null) notFound();

  const supabase = await createClient();

  const { data: prospectRaw } = await supabase
    .from("prospect")
    .select(
      "prospect_id, url, display_name, logo_url, vertical_id, contact_first_name, contact_last_name, contact_position, contact_email, platform_detected, engine_detected, est_annual_traffic, est_aov_usd, notes, created_at, updated_at",
    )
    .eq("prospect_id", prospectId)
    .maybeSingle();
  if (!prospectRaw) notFound();
  const prospect = prospectRaw as Prospect;

  const [{ data: pagesRaw }, { data: scansRaw }] = await Promise.all([
    supabase
      .from("prospect_page")
      .select(
        "prospect_page_id, url, page_type, label, is_featured, is_active, discovered_via, created_at",
      )
      .eq("prospect_id", prospectId)
      .order("page_type")
      .order("created_at"),
    supabase
      .from("page_scan")
      .select(
        "scan_id, prospect_page_id, run_id, status, started_at, completed_at, overall_score, est_annual_uplift_usd",
      )
      .in(
        "prospect_page_id",
        (await supabase
          .from("prospect_page")
          .select("prospect_page_id")
          .eq("prospect_id", prospectId)
        ).data?.map((p) => p.prospect_page_id) ?? [],
      )
      .order("started_at", { ascending: false }),
  ]);

  const pages: Page[] = (pagesRaw ?? []) as Page[];
  const scans: ScanRow[] = (scansRaw ?? []) as ScanRow[];

  // Latest scan per page
  const latestScanByPage = new Map<number, ScanRow>();
  for (const s of scans) {
    if (!latestScanByPage.has(s.prospect_page_id)) {
      latestScanByPage.set(s.prospect_page_id, s);
    }
  }
  // Scan counts per page
  const scanCountByPage = new Map<number, number>();
  for (const s of scans) {
    scanCountByPage.set(
      s.prospect_page_id,
      (scanCountByPage.get(s.prospect_page_id) ?? 0) + 1,
    );
  }

  return (
    <div className="s-content">
      <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginBottom: 4 }}>
        <Link href="/prospects" style={{ color: "var(--s-text-tertiary)" }}>
          ← {t("backToList")}
        </Link>
      </div>
      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div
          className="s-title-inner"
          style={{ display: "flex", alignItems: "center", gap: 16 }}
        >
          <ProspectLogoBig url={prospect.logo_url} fallback={prospect.url} />
          <div>
            <h1 className="s-title">{prospect.display_name ?? prospect.url}</h1>
            <p className="s-subtitle">
              <a
                href={prospect.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--s-text-secondary)", textDecoration: "underline" }}
              >
                {prospect.url}
              </a>
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            href={`/prospects/${prospect.prospect_id}/vocabulary` as never}
            className="s-btn"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {t("vocabularyButton")}
          </Link>
          <ProspectActions
            prospectId={prospect.prospect_id}
            hasPages={pages.length > 0}
          />
        </div>
      </div>

      {/* Contact + platform card */}
      <div
        style={{
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          padding: 20,
          marginBottom: 20,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 24,
        }}
      >
        <div>
          <SectionLabel>{t("contact")}</SectionLabel>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--s-text)" }}>
            {[prospect.contact_first_name, prospect.contact_last_name]
              .filter(Boolean)
              .join(" ") || "—"}
          </div>
          {prospect.contact_position && (
            <div style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
              {prospect.contact_position}
            </div>
          )}
          {prospect.contact_email && (
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text-secondary)",
                marginTop: 2,
                fontFamily: "var(--s-font-mono)",
              }}
            >
              {prospect.contact_email}
            </div>
          )}
        </div>
        <div>
          <SectionLabel>{t("platform")}</SectionLabel>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {prospect.platform_detected ?? "—"}
          </div>
          {prospect.engine_detected && (
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text-secondary)",
                fontFamily: "var(--s-font-mono)",
              }}
            >
              {prospect.engine_detected}
            </div>
          )}
        </div>
        <div>
          <SectionLabel>{t("economics")}</SectionLabel>
          <div style={{ fontSize: 13 }}>
            {prospect.est_annual_traffic ? (
              <>
                {Number(prospect.est_annual_traffic).toLocaleString()} {t("trafficUnit")}
              </>
            ) : (
              <span style={{ color: "var(--s-text-tertiary)" }}>—</span>
            )}
          </div>
          <div style={{ fontSize: 13 }}>
            {prospect.est_aov_usd ? (
              <>
                ${Number(prospect.est_aov_usd).toFixed(2)} {t("aovSuffix")}
              </>
            ) : (
              <span style={{ color: "var(--s-text-tertiary)" }}>—</span>
            )}
          </div>
        </div>
      </div>

      {/* Pages */}
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
            padding: "12px 16px",
            borderBottom: "0.5px solid var(--s-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("pagesTitle")} ({pages.length})
          </div>
        </div>

        {pages.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--s-text-tertiary)",
              fontSize: 13,
            }}
          >
            {t("noPagesYet")}
          </div>
        ) : null}
        <AddProspectPageForm prospectId={prospect.prospect_id} />
        {pages.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("pageTable.type")}</Th>
                <Th>{t("pageTable.url")}</Th>
                <Th>{t("pageTable.scans")}</Th>
                <Th>{t("pageTable.latestScore")}</Th>
                <Th>{t("pageTable.latestUplift")}</Th>
                <Th>{t("pageTable.lastScanned")}</Th>
                <Th>{t("pageTable.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const latest = latestScanByPage.get(p.prospect_page_id);
                const count = scanCountByPage.get(p.prospect_page_id) ?? 0;
                return (
                  <tr
                    key={p.prospect_page_id}
                    style={{ borderTop: "1px solid var(--s-border)" }}
                  >
                    <Td>
                      <PageTypeBadge type={p.page_type} />
                    </Td>
                    <Td>
                      <Link
                        href={
                          `/prospects/${prospect.prospect_id}/pages/${p.prospect_page_id}` as never
                        }
                        style={{
                          color: "var(--s-text)",
                          textDecoration: "none",
                          fontFamily: "var(--s-font-mono)",
                          fontSize: 12,
                        }}
                      >
                        {shortenUrl(p.url)}
                      </Link>
                    </Td>
                    <Td mono>{count}</Td>
                    <Td mono>{latest?.overall_score ?? ""}</Td>
                    <Td mono>
                      {latest?.est_annual_uplift_usd != null
                        ? `$${Math.round(latest.est_annual_uplift_usd).toLocaleString()}`
                        : ""}
                    </Td>
                    <Td>
                      <LocalTime iso={latest?.started_at ?? null} />
                    </Td>
                    <Td>
                      <RescanPageClient prospectPageId={p.prospect_page_id} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ProspectLogoBig({
  url,
  fallback,
}: {
  url: string | null;
  fallback: string;
}) {
  let src = url;
  if (!src) {
    try {
      const host = new URL(fallback).host;
      src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    } catch {
      src = null;
    }
  }
  if (!src) {
    return (
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
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
      src={src}
      alt=""
      width={56}
      height={56}
      style={{
        width: 56,
        height: 56,
        objectFit: "contain",
        background: "#ffffff",
        borderRadius: 10,
        border: "0.5px solid var(--s-border)",
        flexShrink: 0,
        padding: 4,
      }}
    />
  );
}

function PageTypeBadge({ type }: { type: string }) {
  const palette: Record<string, { bg: string; color: string }> = {
    homepage: { bg: "rgba(250,225,148,0.12)", color: "var(--rre-accent)" },
    pdp: { bg: "var(--s-surface-alt)", color: "var(--s-text-secondary)" },
    category: { bg: "var(--s-surface-alt)", color: "var(--s-text-secondary)" },
  };
  const p = palette[type] ?? palette.pdp;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        background: p.bg,
        color: p.color,
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {type}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + (u.search || "");
    return path === "/" ? u.host : `${u.host}${path}`;
  } catch {
    return url;
  }
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
