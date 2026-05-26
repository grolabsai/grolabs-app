import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { RescanPageClient } from "../../_client";

export const dynamic = "force-dynamic";

type Page = {
  prospect_page_id: number;
  prospect_id: number;
  url: string;
  page_type: string;
  label: string | null;
  created_at: string;
};
type Prospect = {
  prospect_id: number;
  url: string;
  display_name: string | null;
};
type Scan = {
  scan_id: number;
  run_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  overall_score: number | null;
  est_annual_uplift_usd: number | null;
  error_message: string | null;
};
type Finding = {
  finding_id: number;
  page_scan_id: number | null;
  diagnostic_check_id: number;
  score: number | null;
  result_status: "pass" | "fail" | "partial" | "na" | "error";
  notes: string | null;
};
type Check = {
  diagnostic_check_id: number;
  check_code: string;
  check_name: string;
};

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ prospectId: string; pageId: string }>;
}) {
  const { prospectId: pidParam, pageId: pageIdParam } = await params;
  const prospectId = parseInt(pidParam, 10);
  const pageId = parseInt(pageIdParam, 10);
  if (Number.isNaN(prospectId) || Number.isNaN(pageId)) notFound();

  const t = await getTranslations("prospects.page");
  const instanceId = await currentInstanceId();
  if (instanceId === null) notFound();

  const supabase = await createClient();

  const [{ data: pageRaw }, { data: prospectRaw }, { data: scansRaw }] = await Promise.all([
    supabase
      .from("prospect_page")
      .select("prospect_page_id, prospect_id, url, page_type, label, created_at")
      .eq("prospect_page_id", pageId)
      .maybeSingle(),
    supabase
      .from("prospect")
      .select("prospect_id, url, display_name")
      .eq("prospect_id", prospectId)
      .maybeSingle(),
    supabase
      .from("page_scan")
      .select(
        "scan_id, run_id, status, started_at, completed_at, overall_score, est_annual_uplift_usd, error_message",
      )
      .eq("prospect_page_id", pageId)
      .order("started_at", { ascending: false }),
  ]);

  if (!pageRaw || !prospectRaw) notFound();
  const page = pageRaw as Page;
  const prospect = prospectRaw as Prospect;
  if (page.prospect_id !== prospect.prospect_id) notFound();

  const scans: Scan[] = (scansRaw ?? []) as Scan[];

  // Compare: latest vs second-to-latest (the two most recent completed scans)
  const completedScans = scans.filter((s) => s.status === "completed");
  const latest = completedScans[0] ?? null;
  const previous = completedScans[1] ?? null;

  // Findings for both scans (if any)
  const scanIdsToLoad = [latest, previous]
    .filter((s): s is Scan => s !== null)
    .map((s) => s.scan_id);
  const [{ data: findingsRaw }, { data: checksRaw }] = await Promise.all([
    scanIdsToLoad.length > 0
      ? supabase
          .from("finding")
          .select(
            "finding_id, page_scan_id, diagnostic_check_id, score, result_status, notes",
          )
          .in("page_scan_id", scanIdsToLoad)
      : Promise.resolve({ data: [] as Finding[] }),
    supabase
      .from("diagnostic_check")
      .select("diagnostic_check_id, check_code, check_name"),
  ]);
  const findings: Finding[] = (findingsRaw ?? []) as Finding[];
  const checks: Check[] = (checksRaw ?? []) as Check[];
  const checkById = new Map(checks.map((c) => [c.diagnostic_check_id, c]));

  // Pivot findings into a check_id → { latest, previous } map for the
  // compare table.
  type ComparisonRow = {
    check_id: number;
    check_name: string;
    check_code: string;
    latest: { score: number | null; status: string } | null;
    previous: { score: number | null; status: string } | null;
  };
  const comparison = new Map<number, ComparisonRow>();
  for (const f of findings) {
    const isLatest = latest && f.page_scan_id === latest.scan_id;
    const isPrev = previous && f.page_scan_id === previous.scan_id;
    if (!isLatest && !isPrev) continue;
    const check = checkById.get(f.diagnostic_check_id);
    if (!check) continue;
    const row =
      comparison.get(f.diagnostic_check_id) ??
      {
        check_id: f.diagnostic_check_id,
        check_name: check.check_name,
        check_code: check.check_code,
        latest: null,
        previous: null,
      };
    if (isLatest)
      row.latest = { score: f.score, status: f.result_status };
    else if (isPrev)
      row.previous = { score: f.score, status: f.result_status };
    comparison.set(f.diagnostic_check_id, row);
  }
  const comparisonRows = Array.from(comparison.values()).sort((a, b) =>
    a.check_code.localeCompare(b.check_code),
  );

  return (
    <div className="s-content">
      <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginBottom: 4 }}>
        <Link
          href={`/prospects/${prospect.prospect_id}` as never}
          style={{ color: "var(--s-text-tertiary)" }}
        >
          ← {prospect.display_name ?? prospect.url}
        </Link>
      </div>
      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div className="s-title-inner">
          <h1
            className="s-title"
            style={{
              fontFamily: "var(--s-font-mono)",
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            {shortenUrl(page.url)}
          </h1>
          <p className="s-subtitle">
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--scout-accent)",
                marginRight: 8,
              }}
            >
              {page.page_type}
            </span>
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--s-text-secondary)", textDecoration: "underline" }}
            >
              {t("openPage")}
            </a>
          </p>
        </div>
        <RescanPageClient prospectPageId={page.prospect_page_id} />
      </div>

      {/* Latest-vs-previous comparison */}
      {latest && (
        <div
          style={{
            background: "var(--s-surface)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-lg)",
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--s-text-tertiary)",
              marginBottom: 12,
            }}
          >
            {t("comparison")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: previous ? "1fr 1fr 1fr" : "1fr",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <ScoreCard
              label={t("latestScan")}
              when={latest.completed_at ?? latest.started_at}
              score={latest.overall_score}
              uplift={latest.est_annual_uplift_usd}
              accent
            />
            {previous && (
              <>
                <ScoreCard
                  label={t("previousScan")}
                  when={previous.completed_at ?? previous.started_at}
                  score={previous.overall_score}
                  uplift={previous.est_annual_uplift_usd}
                />
                <DeltaCard
                  label={t("delta")}
                  latestScore={latest.overall_score}
                  previousScore={previous.overall_score}
                  latestUplift={latest.est_annual_uplift_usd}
                  previousUplift={previous.est_annual_uplift_usd}
                />
              </>
            )}
          </div>

          {previous && comparisonRows.length > 0 && (
            <div
              style={{
                border: "0.5px solid var(--s-border)",
                borderRadius: "var(--s-radius-md)",
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--s-surface-alt)" }}>
                    <Th>{t("compareTable.check")}</Th>
                    <Th>{t("compareTable.previous")}</Th>
                    <Th>{t("compareTable.latest")}</Th>
                    <Th>{t("compareTable.delta")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((r) => (
                    <ComparisonRow key={r.check_id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Scan history table */}
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
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("scanHistory")} ({scans.length})
        </div>
        {scans.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--s-text-tertiary)",
              fontSize: 13,
            }}
          >
            {t("noScansYet")}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("scanTable.when")}</Th>
                <Th>{t("scanTable.status")}</Th>
                <Th>{t("scanTable.score")}</Th>
                <Th>{t("scanTable.uplift")}</Th>
                <Th>{t("scanTable.openRun")}</Th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.scan_id} style={{ borderTop: "1px solid var(--s-border)" }}>
                  <Td>
                    {s.started_at ? formatDateTime(s.started_at) : "—"}
                  </Td>
                  <Td>
                    <StatusBadge status={s.status} />
                  </Td>
                  <Td mono>{s.overall_score ?? ""}</Td>
                  <Td mono>
                    {s.est_annual_uplift_usd != null
                      ? `$${Math.round(s.est_annual_uplift_usd).toLocaleString()}`
                      : ""}
                  </Td>
                  <Td>
                    <Link
                      href={`/prospects/runs/${s.run_id}` as never}
                      style={{
                        fontSize: 11,
                        color: "var(--scout-accent)",
                        textDecoration: "none",
                      }}
                    >
                      {t("scanTable.view")} →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  when,
  score,
  uplift,
  accent,
}: {
  label: string;
  when: string | null;
  score: number | null;
  uplift: number | null;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: accent ? "rgba(250,225,148,0.06)" : "var(--s-surface-alt)",
        border: `0.5px solid ${accent ? "rgba(250,225,148,0.3)" : "var(--s-border)"}`,
        borderRadius: "var(--s-radius-md)",
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent ? "var(--scout-accent)" : "var(--s-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: "var(--s-font-mono)",
          color: "var(--s-text)",
        }}
      >
        {score ?? "—"}
      </div>
      <div style={{ fontSize: 12, color: "var(--s-text-secondary)" }}>
        {uplift != null ? `$${Math.round(uplift).toLocaleString()} uplift` : "—"}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--s-text-tertiary)",
          marginTop: 4,
          fontFamily: "var(--s-font-mono)",
        }}
      >
        {when ? formatDateTime(when) : ""}
      </div>
    </div>
  );
}

function DeltaCard({
  label,
  latestScore,
  previousScore,
  latestUplift,
  previousUplift,
}: {
  label: string;
  latestScore: number | null;
  previousScore: number | null;
  latestUplift: number | null;
  previousUplift: number | null;
}) {
  const scoreDelta =
    latestScore != null && previousScore != null
      ? latestScore - previousScore
      : null;
  const upliftDelta =
    latestUplift != null && previousUplift != null
      ? latestUplift - previousUplift
      : null;
  const positive = (scoreDelta ?? 0) > 0;
  const negative = (scoreDelta ?? 0) < 0;
  const color = positive
    ? "var(--s-success)"
    : negative
      ? "var(--s-danger)"
      : "var(--s-text-secondary)";
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div
      style={{
        background: "var(--s-surface-alt)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
        padding: 14,
      }}
    >
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
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: "var(--s-font-mono)",
          color,
        }}
      >
        {scoreDelta != null ? sign(scoreDelta) : "—"}
      </div>
      <div style={{ fontSize: 12, color, fontFamily: "var(--s-font-mono)" }}>
        {upliftDelta != null
          ? `${upliftDelta > 0 ? "+" : ""}$${Math.round(Math.abs(upliftDelta)).toLocaleString()} uplift`
          : "—"}
      </div>
    </div>
  );
}

function ComparisonRow({
  row,
}: {
  row: {
    check_name: string;
    check_code: string;
    latest: { score: number | null; status: string } | null;
    previous: { score: number | null; status: string } | null;
  };
}) {
  const ps = row.previous?.score ?? null;
  const ls = row.latest?.score ?? null;
  const delta = ps != null && ls != null ? ls - ps : null;
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  const color =
    delta == null
      ? "var(--s-text-tertiary)"
      : delta > 0
        ? "var(--s-success)"
        : delta < 0
          ? "var(--s-danger)"
          : "var(--s-text-secondary)";
  return (
    <tr style={{ borderTop: "1px solid var(--s-border)" }}>
      <td style={{ padding: "8px 12px", fontSize: 12 }}>
        <div style={{ fontWeight: 500 }}>{row.check_name}</div>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            fontFamily: "var(--s-font-mono)",
          }}
        >
          {row.check_code}
        </div>
      </td>
      <td style={cellStyle()}>
        {row.previous ? (
          <ScoreCell score={row.previous.score} status={row.previous.status} />
        ) : (
          ""
        )}
      </td>
      <td style={cellStyle()}>
        {row.latest ? (
          <ScoreCell score={row.latest.score} status={row.latest.status} />
        ) : (
          ""
        )}
      </td>
      <td
        style={{
          ...cellStyle(),
          color,
          fontFamily: "var(--s-font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {delta != null ? sign(delta) : ""}
      </td>
    </tr>
  );
}

function ScoreCell({
  score,
  status,
}: {
  score: number | null;
  status: string;
}) {
  const color: Record<string, string> = {
    pass: "var(--s-success)",
    partial: "var(--s-warning-text)",
    fail: "var(--s-danger)",
    na: "var(--s-text-tertiary)",
    error: "var(--s-danger)",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: color[status] ?? "var(--s-text-tertiary)",
          minWidth: 50,
        }}
      >
        {status}
      </span>
      <span
        style={{
          fontFamily: "var(--s-font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {score ?? ""}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "var(--s-success)"
      : status === "failed"
        ? "var(--s-danger)"
        : "var(--s-text-tertiary)";
  return (
    <span
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

function cellStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    fontSize: 12,
    color: "var(--s-text)",
  };
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 12px",
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
        padding: "10px 12px",
        fontSize: 13,
        color: "var(--s-text)",
        fontFamily: mono
          ? "var(--s-font-mono, ui-monospace, monospace)"
          : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}
