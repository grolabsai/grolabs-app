import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { NewRunForm } from "./_new-run-form";

export const dynamic = "force-dynamic";

type ProspectRow = {
  prospect_id: number;
  url: string;
  display_name: string | null;
  platform_detected: string | null;
  engine_detected: string | null;
  updated_at: string;
};

type RunRow = {
  run_id: string;
  prospect_id: number;
  run_status: "queued" | "running" | "completed" | "failed";
  overall_score: number | null;
  maturity_tier: "low" | "medium" | "high" | null;
  est_annual_uplift_usd: number | null;
  started_at: string | null;
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
  const [{ data: prospectsRaw }, { data: runsRaw }, { data: verticalsRaw }] = await Promise.all([
    supabase
      .from("prospect")
      .select("prospect_id, url, display_name, platform_detected, engine_detected, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("diagnostic_run")
      .select(
        "run_id, prospect_id, run_status, overall_score, maturity_tier, est_annual_uplift_usd, started_at, completed_at",
      )
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("vertical")
      .select("vertical_id, vertical_name")
      .order("vertical_name"),
  ]);

  const prospects: ProspectRow[] = (prospectsRaw ?? []) as ProspectRow[];
  const runs: RunRow[] = (runsRaw ?? []) as RunRow[];
  const verticals: VerticalRow[] = (verticalsRaw ?? []) as VerticalRow[];

  const prospectsById = new Map(prospects.map((p) => [p.prospect_id, p]));

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

      {runs.length === 0 && prospects.length === 0 ? (
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
            {t("recentRunsTitle")}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("runTable.site")}</Th>
                <Th>{t("runTable.status")}</Th>
                <Th>{t("runTable.score")}</Th>
                <Th>{t("runTable.tier")}</Th>
                <Th>{t("runTable.started")}</Th>
                <Th>{t("runTable.completed")}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const p = prospectsById.get(r.prospect_id);
                return (
                  <tr
                    key={r.run_id}
                    style={{
                      borderBottom: "0.5px solid var(--s-border)",
                      cursor: "pointer",
                    }}
                  >
                    <Td>
                      <Link
                        href={`/prospects/runs/${r.run_id}` as unknown as `/prospects/runs/${string}`}
                        style={{ color: "var(--s-text)", textDecoration: "none" }}
                      >
                        <div style={{ fontWeight: 500 }}>
                          {p?.display_name ?? p?.url ?? r.prospect_id}
                        </div>
                        {p?.display_name && (
                          <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                            {p.url}
                          </div>
                        )}
                      </Link>
                    </Td>
                    <Td>
                      <StatusBadge status={r.run_status} />
                    </Td>
                    <Td mono>{r.overall_score ?? ""}</Td>
                    <Td>{r.maturity_tier ?? ""}</Td>
                    <Td>{r.started_at ? formatDateTime(r.started_at) : ""}</Td>
                    <Td>{r.completed_at ? formatDateTime(r.completed_at) : ""}</Td>
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
        fontSize: 12,
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
