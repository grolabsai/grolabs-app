import { Link } from "@/i18n/routing";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { formatRelative } from "@/lib/format";
import { FilePlus, Sheet, Globe } from "lucide-react";

/**
 * Import dashboard. Entry point for all catalog import flows:
 *   - Quick text entry (single product, paste-and-go)
 *   - Excel / CSV upload (bulk, column mapping)
 *   - Migration import (WooCommerce, Shopify, etc.)
 *
 * Shows recent import jobs from import_job table.
 * Text import is the only active path in Phase 1 (CI-11).
 * Excel and migration are shown as disabled cards pending M3/M4.
 */

export const dynamic = "force-dynamic";

type ImportJob = {
  import_job_id: number;
  source_type: string;
  source_label: string | null;
  status: string;
  total_rows: number | null;
  rows_promoted: number | null;
  rows_rejected: number | null;
  created_at: string;
  completed_at: string | null;
};

export default async function ImportPage() {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();

  if (instanceId === null) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">Sesión expirada</span>
          <span className="s-strip-text">Volvé a iniciar sesión.</span>
        </div>
      </div>
    );
  }

  // Fetch recent import jobs
  const { data: jobs } = await supabase
    .from("import_job")
    .select(
      "import_job_id, source_type, source_label, status, total_rows, rows_promoted, rows_rejected, created_at, completed_at",
    )
    .eq("instance_id", instanceId)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<ImportJob[]>();

  const recentJobs = jobs ?? [];

  return (
    <div className="s-content">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          paddingBottom: 14,
          borderBottom: "0.5px solid var(--s-border)",
        }}
      >
        <div className="s-breadcrumb">
          <span>Importar</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">Importar productos</h1>
          <p className="s-meta">
            Ingresá productos manualmente, desde un archivo, o desde tu tienda.
          </p>
        </div>
      </div>

      {/* ── Import method cards ── */}
      <div className="s-import-methods">
        {/* Text entry — active */}
        <Link
          href={"/import/text" as Route}
          className="s-import-card"
          style={{ textDecoration: "none" }}
        >
          <div className="s-import-card-icon">
            <FilePlus size={24} strokeWidth={1.5} />
          </div>
          <div className="s-import-card-text">
            <div className="s-import-card-title">Entrada de texto</div>
            <div className="s-import-card-desc">
              Pegá el nombre, marca y precio de un producto. El agente lo
              parsea, detecta variantes y lo clasifica.
            </div>
          </div>
          <div className="s-import-card-status active">Disponible</div>
        </Link>

        {/* Excel/CSV — wizard */}
        <Link
          href={"/import/wizard" as Route}
          className="s-import-card"
          style={{ textDecoration: "none" }}
        >
          <div className="s-import-card-icon">
            <Sheet size={24} strokeWidth={1.5} />
          </div>
          <div className="s-import-card-text">
            <div className="s-import-card-title">Excel / CSV</div>
            <div className="s-import-card-desc">
              Subí un archivo con columnas de producto. Mapeo de columnas
              asistido por IA.
            </div>
          </div>
          <div className="s-import-card-status active">Disponible</div>
        </Link>

        {/* Migration — WooCommerce active, others coming soon */}
        <Link
          href={"/import/woocommerce" as Route}
          className="s-import-card"
          style={{ textDecoration: "none" }}
        >
          <div className="s-import-card-icon">
            <Globe size={24} strokeWidth={1.5} />
          </div>
          <div className="s-import-card-text">
            <div className="s-import-card-title">WooCommerce</div>
            <div className="s-import-card-desc">
              Importá categorías y productos desde tu tienda WooCommerce.
              Re-ejecutable y sin duplicados.
            </div>
          </div>
          <div className="s-import-card-status active">Disponible</div>
        </Link>
      </div>

      {/* ── Recent imports ── */}
      {recentJobs.length > 0 ? (
        <div className="s-card" style={{ padding: 0, marginTop: 32 }}>
          <div
            style={{
              padding: "12px 20px",
              borderBottom: "0.5px solid var(--s-border)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Importaciones recientes
          </div>
          <div className="s-table-wrap">
            <table className="s-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Fuente</th>
                  <th>Tipo</th>
                  <th className="text-center">Productos</th>
                  <th className="text-center">Promovidos</th>
                  <th className="text-center">Rechazados</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => {
                  const statusMap: Record<string, { dot: string; label: string }> = {
                    completed: { dot: "success", label: "Completado" },
                    in_progress: { dot: "accent", label: "En progreso" },
                    failed: { dot: "danger", label: "Error" },
                    pending: { dot: "neutral", label: "Pendiente" },
                  };
                  const st = statusMap[job.status] ?? {
                    dot: "neutral",
                    label: job.status,
                  };
                  const typeLabels: Record<string, string> = {
                    single_text: "Texto",
                    excel: "Excel",
                    csv: "CSV",
                    bulk_migration: "Migración",
                    url: "URL",
                  };

                  return (
                    <tr key={job.import_job_id}>
                      <td style={{ paddingLeft: 20, fontSize: 13, fontWeight: 500 }}>
                        {job.source_label ?? "—"}
                      </td>
                      <td>
                        <span className="s-tag s-tag-accent">
                          {typeLabels[job.source_type] ?? job.source_type}
                        </span>
                      </td>
                      <td className="text-center tabular" style={{ fontSize: 12 }}>
                        {job.total_rows ?? "—"}
                      </td>
                      <td
                        className="text-center tabular"
                        style={{ fontSize: 12, color: "var(--s-success)" }}
                      >
                        {job.rows_promoted ?? "—"}
                      </td>
                      <td
                        className="text-center tabular"
                        style={{
                          fontSize: 12,
                          color:
                            (job.rows_rejected ?? 0) > 0
                              ? "var(--s-danger)"
                              : "var(--s-text-muted)",
                        }}
                      >
                        {job.rows_rejected ?? "—"}
                      </td>
                      <td>
                        <div className="s-dot-row">
                          <div className={`s-dot ${st.dot}`} />
                          <span style={{ fontSize: 12 }}>{st.label}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--s-text-muted)" }}>
                        {formatRelative(job.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="s-card" style={{ marginTop: 32 }}>
          <div className="s-empty">
            <div className="s-empty-title">Sin importaciones aún</div>
            <div className="s-empty-sub">
              Usá cualquiera de los métodos de arriba para importar tu primer
              producto.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
