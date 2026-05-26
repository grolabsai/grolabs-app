import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { RescanPageClient } from "../../_client";
import { ComparisonTable, type ComparisonRow as ComparisonRowData } from "./_comparison-table";
import { ScanStatusBadge } from "./_scan-status";
import { LocalTime } from "@/components/ui/LocalTime";

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
  evidence: Record<string, unknown> | null;
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
            "finding_id, page_scan_id, diagnostic_check_id, score, result_status, notes, evidence",
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
  const comparison = new Map<number, ComparisonRowData>();
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
    const cell = {
      score: f.score,
      status: f.result_status,
      notes: f.notes,
      evidence: f.evidence,
    };
    if (isLatest) row.latest = cell;
    else if (isPrev) row.previous = cell;
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
            <ComparisonTable
              rows={comparisonRows}
              latestAt={latest.completed_at ?? latest.started_at}
              previousAt={previous.completed_at ?? previous.started_at}
            />
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
                    <LocalTime iso={s.started_at} fallback="—" />
                  </Td>
                  <Td>
                    <ScanStatusBadge
                      status={s.status}
                      errorMessage={s.error_message}
                      startedAt={s.started_at}
                    />
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
        <LocalTime iso={when} />
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

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
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
