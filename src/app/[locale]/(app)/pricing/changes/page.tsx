import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/icon";
import { ClipboardList } from "lucide-react";
import { currentInstanceId } from "@/lib/instance";
import {
  listBatches,
  listPendingPriceLists,
} from "@/lib/actions/pricing";
import { CreateBatchButton } from "@/components/pricing/CreateBatchButton";
import { ImportListButton } from "@/components/pricing/ImportListButton";
import { formatRelative } from "@/lib/format";

/**
 * `/pricing/changes` — entry point for the worksheet flow.
 *
 * Two sections:
 *   1. Listas de precios pendientes — recently imported price_list rows
 *      that the user can convert into a calculated price_batch.
 *   2. Lotes recientes — every batch on the instance with status pill,
 *      item / warning / critical counts.
 *
 * Click "Crear lote" on a price list → server action populates a batch
 * and redirects to /pricing/changes/[batch_id]. Click any batch row →
 * worksheet detail (read-only landing for now; W2 ships filters,
 * recompute, and status transitions).
 */

export const dynamic = "force-dynamic";

export default async function PricingChangesPage() {
  const t = await getTranslations("pricing.changesPage");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const [batchesRes, listsRes] = await Promise.all([
    listBatches(),
    listPendingPriceLists(),
  ]);
  const batches = batchesRes.ok ? batchesRes.batches : [];
  const lists = listsRes.ok ? listsRes.lists : [];

  return (
    <>
      {/* Pending price lists ----------------------------------------- */}
      <section className="pricing-section" style={{ marginBottom: 24 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--s-text)",
                marginBottom: 4,
              }}
            >
              {t("pendingLists.title")}
            </h2>
            <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
              {t("pendingLists.subtitle")}
            </p>
          </div>
          <ImportListButton />
        </header>

        {lists.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--s-text-tertiary)",
            }}
          >
            {t("pendingLists.empty")}
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
                  <Th>{t("pendingLists.cols.provider")}</Th>
                  <Th>{t("pendingLists.cols.file")}</Th>
                  <Th>{t("pendingLists.cols.imported")}</Th>
                  <Th>{t("pendingLists.cols.effective")}</Th>
                  <Th align="right">{t("pendingLists.cols.items")}</Th>
                  <Th>{" "}</Th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr
                    key={l.price_list_id}
                    style={{ borderBottom: "1px solid var(--s-border)" }}
                  >
                    <Td>
                      <span style={{ fontWeight: 500, color: "var(--s-text)" }}>
                        {l.provider_name}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--s-text-secondary)" }}>
                        {l.file_name ?? ""}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--s-text-secondary)" }}>
                        {formatRelative(l.import_date)}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--s-text-secondary)" }}>
                        {l.effective_date ?? ""}
                      </span>
                    </Td>
                    <Td align="right">
                      <span
                        style={{
                          fontFamily: "var(--s-font-mono)",
                          fontSize: 12,
                          color: "var(--s-text)",
                        }}
                      >
                        {l.item_count}
                      </span>
                    </Td>
                    <Td align="right">
                      <CreateBatchButton priceListId={l.price_list_id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent batches ---------------------------------------------- */}
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
            {t("batches.title")}
          </h2>
          <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
            {t("batches.subtitle")}
          </p>
        </header>

        {batches.length === 0 ? (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
            }}
          >
            <Icon icon={ClipboardList} size={28} strokeWidth={1.5} />
            <p
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--s-text)",
                marginTop: 12,
                marginBottom: 6,
              }}
            >
              {t("batches.empty.title")}
            </p>
            <p
              style={{
                fontSize: 13,
                color: "var(--s-text-tertiary)",
                maxWidth: 480,
                margin: "0 auto",
              }}
            >
              {t("batches.empty.text")}
            </p>
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
                  <Th>{t("batches.cols.name")}</Th>
                  <Th>{t("batches.cols.status")}</Th>
                  <Th align="right">{t("batches.cols.items")}</Th>
                  <Th align="right">{t("batches.cols.warnings")}</Th>
                  <Th align="right">{t("batches.cols.criticals")}</Th>
                  <Th>{t("batches.cols.updated")}</Th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.price_batch_id}
                    style={{ borderBottom: "1px solid var(--s-border)" }}
                  >
                    <Td>
                      <Link
                        href={`/pricing/changes/${b.price_batch_id}`}
                        style={{
                          color: "var(--rre-accent-800)",
                          fontWeight: 500,
                          textDecoration: "none",
                        }}
                      >
                        {b.batch_name}
                      </Link>
                    </Td>
                    <Td>
                      <span className={`pricing-status-pill ${b.status}`}>
                        {t(`status.${b.status}`)}
                      </span>
                    </Td>
                    <Td align="right">
                      <Mono>{b.item_count}</Mono>
                    </Td>
                    <Td align="right">
                      <Mono color={b.warning_count > 0 ? "warn" : "muted"}>
                        {b.warning_count}
                      </Mono>
                    </Td>
                    <Td align="right">
                      <Mono color={b.critical_count > 0 ? "critical" : "muted"}>
                        {b.critical_count}
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
                  </tr>
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
  color?: "default" | "muted" | "warn" | "critical";
}) {
  const c =
    color === "muted"
      ? "var(--s-text-tertiary)"
      : color === "warn"
        ? "#B45309"
        : color === "critical"
          ? "var(--s-danger)"
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

