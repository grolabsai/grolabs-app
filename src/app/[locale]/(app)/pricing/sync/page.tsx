import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { CheckCircle2, AlertCircle, AlertTriangle, ShoppingBag } from "lucide-react";
import { currentInstanceId } from "@/lib/instance";
import {
  listReadyBatches,
  listSyncHistory,
  isWoocommerceConfigured,
  type SyncHistoryRow,
} from "@/lib/actions/pricing";
import { SyncBatchButton } from "@/components/pricing/SyncBatchButton";
import { formatRelative } from "@/lib/format";

/**
 * `/pricing/sync` — push ready batches to WooCommerce + see history.
 *
 * Layout matches the rest of the pricing module: cards stacked top to
 * bottom. WooCommerce credentials gate everything; if the integration
 * isn't configured we show a single CTA pointing at the configuration
 * screen rather than dead UI.
 */

export const dynamic = "force-dynamic";

export default async function PricingSyncPage() {
  const t = await getTranslations("pricing.syncPage");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const wcReady = await isWoocommerceConfigured();
  if (!wcReady) {
    return (
      <section
        className="pricing-section"
        style={{ textAlign: "center", padding: 60 }}
      >
        <Icon icon={ShoppingBag} size={32} strokeWidth={1.5} />
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--s-text)",
            marginTop: 12,
            marginBottom: 8,
          }}
        >
          {t("notConfigured.title")}
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "var(--s-text-tertiary)",
            maxWidth: 460,
            margin: "0 auto 20px",
          }}
        >
          {t("notConfigured.text")}
        </p>
        <Link
          href="/configuration/woocommerce"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            background: "var(--scout-accent)",
            color: "white",
            fontSize: 14,
            fontWeight: 500,
            borderRadius: "var(--s-radius-md)",
            textDecoration: "none",
          }}
        >
          {t("notConfigured.cta")}
        </Link>
      </section>
    );
  }

  const [readyRes, historyRes] = await Promise.all([
    listReadyBatches(),
    listSyncHistory(),
  ]);
  const ready = readyRes.ok ? readyRes.batches : [];
  const history = historyRes.ok ? historyRes.rows : [];

  return (
    <>
      {/* Ready batches --------------------------------------------- */}
      <section className="pricing-section" style={{ marginBottom: 24 }}>
        <header style={{ marginBottom: 16 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--s-text)",
              marginBottom: 4,
            }}
          >
            {t("ready.title")}
          </h2>
          <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
            {t("ready.subtitle")}
          </p>
        </header>

        {ready.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("ready.empty")}
          </div>
        ) : (
          <div
            style={{
              border: "1px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
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
                  <Th>{t("ready.cols.name")}</Th>
                  <Th align="right">{t("ready.cols.items")}</Th>
                  <Th align="right">{t("ready.cols.warnings")}</Th>
                  <Th>{t("ready.cols.updated")}</Th>
                  <Th>{" "}</Th>
                </tr>
              </thead>
              <tbody>
                {ready.map((b) => (
                  <tr
                    key={b.price_batch_id}
                    style={{ borderBottom: "1px solid var(--s-border)" }}
                  >
                    <Td>
                      <Link
                        href={`/pricing/changes/${b.price_batch_id}`}
                        style={{
                          color: "var(--scout-accent-800)",
                          fontWeight: 500,
                          textDecoration: "none",
                        }}
                      >
                        {b.batch_name}
                      </Link>
                    </Td>
                    <Td align="right">
                      <Mono>{b.item_count}</Mono>
                    </Td>
                    <Td align="right">
                      <Mono color={b.warning_count > 0 ? "warn" : "muted"}>
                        {b.warning_count}
                      </Mono>
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--s-text-tertiary)",
                        }}
                      >
                        {formatRelative(b.updated_at)}
                      </span>
                    </Td>
                    <Td align="right">
                      <SyncBatchButton batchId={b.price_batch_id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* History --------------------------------------------------- */}
      <section className="pricing-section">
        <header style={{ marginBottom: 16 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--s-text)",
              marginBottom: 4,
            }}
          >
            {t("history.title")}
          </h2>
          <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
            {t("history.subtitle")}
          </p>
        </header>

        {history.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("history.empty")}
          </div>
        ) : (
          <div
            style={{
              border: "1px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
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
                  <Th width={32}>{" "}</Th>
                  <Th>{t("history.cols.batch")}</Th>
                  <Th align="right">{t("history.cols.total")}</Th>
                  <Th align="right">{t("history.cols.ok")}</Th>
                  <Th align="right">{t("history.cols.failed")}</Th>
                  <Th>{t("history.cols.started")}</Th>
                  <Th>{t("history.cols.duration")}</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <HistoryRow key={r.sync_log_id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

function HistoryRow({ row }: { row: SyncHistoryRow }) {
  const duration =
    row.ended_at && row.started_at
      ? Math.max(
          0,
          Math.round(
            (new Date(row.ended_at).getTime() -
              new Date(row.started_at).getTime()) /
              1000,
          ),
        )
      : null;
  return (
    <tr style={{ borderBottom: "1px solid var(--s-border)" }}>
      <Td>
        <StatusGlyph status={row.status} />
      </Td>
      <Td>
        {row.price_batch_id !== null ? (
          <Link
            href={`/pricing/changes/${row.price_batch_id}`}
            style={{
              color: "var(--scout-accent-800)",
              textDecoration: "none",
            }}
          >
            {row.batch_name ?? `#${row.price_batch_id}`}
          </Link>
        ) : (
          <span style={{ color: "var(--s-text-tertiary)" }}>—</span>
        )}
        {row.error_message ? (
          <div
            title={row.error_message}
            style={{
              fontSize: 11,
              color: "var(--s-danger-text)",
              marginTop: 2,
              maxWidth: 320,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.error_message}
          </div>
        ) : null}
      </Td>
      <Td align="right">
        <Mono>{row.products_count}</Mono>
      </Td>
      <Td align="right">
        <Mono color={row.succeeded_count > 0 ? "ok" : "muted"}>
          {row.succeeded_count}
        </Mono>
      </Td>
      <Td align="right">
        <Mono color={row.failed_count > 0 ? "critical" : "muted"}>
          {row.failed_count}
        </Mono>
      </Td>
      <Td>
        <span style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
          {formatRelative(row.started_at)}
        </span>
      </Td>
      <Td>
        <Mono color="muted">
          {duration === null ? "—" : `${duration}s`}
        </Mono>
      </Td>
    </tr>
  );
}

function StatusGlyph({ status }: { status: SyncHistoryRow["status"] }) {
  if (status === "running")
    return <Mono color="muted">…</Mono>;
  if (status === "success")
    return (
      <Icon
        icon={CheckCircle2}
        size={16}
        strokeWidth={2}
        className="text-green-600"
      />
    );
  if (status === "partial")
    return (
      <Icon
        icon={AlertTriangle}
        size={16}
        strokeWidth={2}
        className="text-amber-500"
      />
    );
  return (
    <Icon
      icon={AlertCircle}
      size={16}
      strokeWidth={2}
      className="text-red-600"
    />
  );
}

function Th({
  children,
  align = "left",
  width,
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  width?: number;
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
        width: width !== undefined ? `${width}px` : undefined,
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
  color?: "default" | "muted" | "ok" | "warn" | "critical";
}) {
  const c =
    color === "muted"
      ? "var(--s-text-tertiary)"
      : color === "ok"
        ? "var(--s-success-text)"
        : color === "warn"
          ? "#B45309"
          : color === "critical"
            ? "var(--s-danger-text)"
            : "var(--s-text)";
  return (
    <span
      style={{
        fontFamily: "var(--s-font-mono)",
        fontSize: 12,
        color: c,
      }}
    >
      {children}
    </span>
  );
}
