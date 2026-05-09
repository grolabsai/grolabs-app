import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { ChevronLeft, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { currentInstanceId } from "@/lib/instance";
import { getBatchDetail } from "@/lib/actions/pricing";
import { formatGTQ, formatRelative } from "@/lib/format";

/**
 * Minimal batch landing — read-only worksheet (W1).
 *
 * W2 will replace this with the full editable worksheet (filters,
 * recompute, status transitions, inline editing, violation banners).
 * For now the page closes the loop after batch creation: the user can
 * see what the engine produced and click around to verify the math.
 */

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batch_id: string }>;
}) {
  const t = await getTranslations("pricing.batchDetail");

  const { batch_id: idParam } = await params;
  const batchId = Number(idParam);
  if (!Number.isFinite(batchId)) notFound();

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const res = await getBatchDetail(batchId);
  if (!res.ok) notFound();
  const batch = res.batch;

  return (
    <>
      {/* Header — name, status, summary counts, back link */}
      <div style={{ marginTop: -56, marginBottom: 16 }}>
        <Link
          href="/pricing/changes"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: "var(--s-text-tertiary)",
            textDecoration: "none",
          }}
        >
          <Icon icon={ChevronLeft} size={14} strokeWidth={2} />
          {t("back")}
        </Link>
      </div>

      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "var(--s-text)",
              marginBottom: 6,
            }}
          >
            {batch.batch_name}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              color: "var(--s-text-tertiary)",
            }}
          >
            <span className={`pricing-status-pill ${batch.status}`}>
              {t(`status.${batch.status}`)}
            </span>
            <span>·</span>
            <span>
              {t("itemCount", { n: batch.item_count })}
            </span>
            <span>·</span>
            <span>{formatRelative(batch.updated_at)}</span>
          </div>
        </div>
      </header>

      {/* Status-count pills */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <CountCard
          icon={CheckCircle2}
          label={t("counts.neutral")}
          value={batch.neutral_count}
          tone="neutral"
        />
        <CountCard
          icon={AlertTriangle}
          label={t("counts.warning")}
          value={batch.warning_count}
          tone="warn"
        />
        <CountCard
          icon={AlertCircle}
          label={t("counts.critical")}
          value={batch.critical_count}
          tone="critical"
        />
      </div>

      {/* Items table */}
      <section
        style={{
          background: "var(--s-surface)",
          border: "1px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                background: "var(--s-surface-alt)",
                borderBottom: "1px solid var(--s-border)",
              }}
            >
              <Th>{t("cols.product")}</Th>
              <Th align="right">{t("cols.cost")}</Th>
              <Th align="right">{t("cols.currentPrice")}</Th>
              <Th align="right">{t("cols.charmPrice")}</Th>
              <Th align="right">{t("cols.finalPrice")}</Th>
              <Th align="right">{t("cols.margin")}</Th>
              <Th>{t("cols.status")}</Th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((it) => (
              <tr
                key={it.price_batch_item_id}
                style={{ borderBottom: "1px solid var(--s-border)" }}
              >
                <Td>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--s-text)",
                    }}
                  >
                    {it.variant_label}
                  </div>
                  {it.brand_name ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--s-text-tertiary)",
                      }}
                    >
                      {it.brand_name}
                    </div>
                  ) : null}
                </Td>
                <Td align="right">
                  <Mono>{formatGTQ(it.new_cost)}</Mono>
                </Td>
                <Td align="right">
                  <Mono color="muted">{formatGTQ(it.current_price)}</Mono>
                </Td>
                <Td align="right">
                  <Mono color="muted">{formatGTQ(it.charm_price)}</Mono>
                </Td>
                <Td align="right">
                  <Mono>{formatGTQ(it.final_price)}</Mono>
                </Td>
                <Td align="right">
                  <Mono>
                    {it.margin_percent === null
                      ? "—"
                      : `${it.margin_percent.toFixed(1)}%`}
                  </Mono>
                </Td>
                <Td>
                  <StatusBadge status={it.status} reasons={it.status_reasons} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {batch.items.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("emptyItems")}
          </div>
        ) : null}
      </section>

      {/* W2 placeholder note ----------------------------------------- */}
      <p
        style={{
          marginTop: 16,
          fontSize: 12,
          color: "var(--s-text-tertiary)",
          textAlign: "center",
        }}
      >
        {t("w1Notice")}
      </p>
    </>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 12px",
        fontWeight: 500,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--s-text-tertiary)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px 12px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function Mono({
  children,
  color = "default",
}: {
  children: React.ReactNode;
  color?: "default" | "muted";
}) {
  return (
    <span
      style={{
        fontFamily: "var(--s-font-mono)",
        fontSize: 12,
        color: color === "muted" ? "var(--s-text-tertiary)" : "var(--s-text)",
      }}
    >
      {children}
    </span>
  );
}

function CountCard({
  icon: IconCmp,
  label,
  value,
  tone,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number;
  tone: "neutral" | "warn" | "critical";
}) {
  const palette = {
    neutral: { fg: "var(--s-success-text)", bg: "var(--s-success-bg)" },
    warn: { fg: "#B45309", bg: "#FFF7ED" },
    critical: { fg: "var(--s-danger-text)", bg: "var(--s-danger-bg)" },
  }[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: palette.bg,
        borderRadius: "var(--s-radius-md)",
      }}
    >
      <Icon icon={IconCmp} size={20} strokeWidth={2} />
      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: palette.fg,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: palette.fg,
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  reasons,
}: {
  status: "neutral" | "warning" | "critical";
  reasons: string[];
}) {
  const palette = {
    neutral: { bg: "var(--s-success-bg)", fg: "var(--s-success-text)" },
    warning: { bg: "#FFF7ED", fg: "#B45309" },
    critical: { bg: "var(--s-danger-bg)", fg: "var(--s-danger-text)" },
  }[status];
  return (
    <span
      title={reasons.length > 0 ? reasons.join(", ") : undefined}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {status}
    </span>
  );
}
