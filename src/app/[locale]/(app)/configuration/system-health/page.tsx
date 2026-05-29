import { getTranslations } from "next-intl/server";
import { runHealthChecks, type HealthCheck, type HealthStatus } from "@/lib/health/checks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SystemHealthPage() {
  const t = await getTranslations("configuration.systemHealth");
  const checks = await runHealthChecks();

  const counts = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<HealthStatus, number>,
  );

  const overall: HealthStatus =
    counts.error && counts.error > 0
      ? "error"
      : counts.warn && counts.warn > 0
        ? "warn"
        : "ok";

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
        <OverallBadge status={overall} t={t} />
      </div>

      <div
        style={{
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          overflow: "hidden",
        }}
      >
        {checks.map((c, i) => (
          <CheckRow key={c.id} check={c} isLast={i === checks.length - 1} />
        ))}
      </div>

      <p
        style={{
          marginTop: 16,
          fontSize: 11,
          color: "var(--s-text-tertiary)",
          fontFamily: "var(--s-font-mono)",
        }}
      >
        {t("footer", { count: checks.length })}
      </p>
    </div>
  );
}

function OverallBadge({
  status,
  t,
}: {
  status: HealthStatus;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const palette = paletteFor(status);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: "var(--s-radius-pill)",
        background: palette.bg,
        color: palette.color,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: palette.dot,
        }}
      />
      {t(`overall.${status}`)}
    </div>
  );
}

function CheckRow({ check, isLast }: { check: HealthCheck; isLast: boolean }) {
  const palette = paletteFor(check.status);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 1fr) 1fr auto",
        gap: 16,
        padding: "14px 18px",
        borderBottom: isLast ? "none" : "0.5px solid var(--s-border)",
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: palette.dot,
            flexShrink: 0,
            marginTop: 4,
          }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--s-text)" }}>
            {check.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: palette.color,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            {check.status}
            {check.latencyMs != null && (
              <span
                style={{
                  marginLeft: 6,
                  color: "var(--s-text-tertiary)",
                  fontFamily: "var(--s-font-mono)",
                  textTransform: "none",
                  letterSpacing: 0,
                  fontWeight: 400,
                }}
              >
                · {check.latencyMs}ms
              </span>
            )}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, color: "var(--s-text)" }}>{check.summary}</div>
        {check.detail && (
          <div
            style={{
              fontSize: 12,
              color: "var(--s-text-secondary)",
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            {check.detail}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          alignItems: "flex-end",
        }}
      >
        {check.envVars.map((v) => (
          <div
            key={v.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              fontFamily: "var(--s-font-mono)",
              color: v.set ? "var(--s-text-secondary)" : "var(--s-danger)",
            }}
          >
            <span style={{ opacity: 0.7 }}>{v.set ? "✓" : v.required ? "✗" : "—"}</span>
            {v.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function paletteFor(status: HealthStatus): {
  bg: string;
  color: string;
  dot: string;
} {
  switch (status) {
    case "ok":
      return {
        bg: "rgba(34, 197, 94, 0.10)",
        color: "var(--s-success-text, #16a34a)",
        dot: "var(--s-success, #22c55e)",
      };
    case "warn":
      return {
        bg: "rgba(250, 204, 21, 0.12)",
        color: "var(--s-warning-text, #ca8a04)",
        dot: "var(--s-warning, #facc15)",
      };
    case "error":
      return {
        bg: "rgba(239, 68, 68, 0.10)",
        color: "var(--s-danger-text, #dc2626)",
        dot: "var(--s-danger, #ef4444)",
      };
    case "disabled":
      return {
        bg: "rgba(148, 163, 184, 0.10)",
        color: "var(--s-text-tertiary)",
        dot: "var(--s-text-tertiary)",
      };
  }
}
