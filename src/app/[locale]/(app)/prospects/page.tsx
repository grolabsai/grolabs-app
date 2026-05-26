import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

type ProspectRow = {
  prospect_id: number;
  url: string;
  display_name: string | null;
  vertical_id: number | null;
  platform_detected: string | null;
  engine_detected: string | null;
  est_annual_traffic: number | null;
  created_at: string;
  updated_at: string;
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
  const { data: prospectsRaw } = await supabase
    .from("prospect")
    .select(
      "prospect_id, url, display_name, vertical_id, platform_detected, engine_detected, est_annual_traffic, created_at, updated_at",
    )
    .order("updated_at", { ascending: false });

  const prospects: ProspectRow[] = (prospectsRaw ?? []) as ProspectRow[];

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

      {prospects.length === 0 ? (
        <div
          style={{
            background: "var(--s-surface)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-lg)",
            padding: 48,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 14, color: "var(--s-text)", marginBottom: 8 }}>
            {t("empty.title")}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              maxWidth: 520,
              margin: "0 auto 16px",
              lineHeight: 1.5,
            }}
          >
            {t("empty.description")}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
            <Link href="/prospects/rubric" className="s-btn s-btn-primary">
              {t("empty.editRubric")}
            </Link>
          </div>
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
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ background: "var(--s-surface-alt)" }}>
                <Th>{t("table.url")}</Th>
                <Th>{t("table.platform")}</Th>
                <Th>{t("table.engine")}</Th>
                <Th>{t("table.traffic")}</Th>
                <Th>{t("table.updated")}</Th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr
                  key={p.prospect_id}
                  style={{ borderBottom: "0.5px solid var(--s-border)" }}
                >
                  <Td>
                    <div style={{ fontWeight: 500 }}>
                      {p.display_name ?? p.url}
                    </div>
                    {p.display_name && (
                      <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                        {p.url}
                      </div>
                    )}
                  </Td>
                  <Td>{p.platform_detected ?? ""}</Td>
                  <Td>{p.engine_detected ?? ""}</Td>
                  <Td mono>
                    {p.est_annual_traffic != null
                      ? p.est_annual_traffic.toLocaleString()
                      : ""}
                  </Td>
                  <Td>{p.updated_at.slice(0, 10)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
