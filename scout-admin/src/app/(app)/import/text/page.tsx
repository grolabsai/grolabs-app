import Link from "next/link";
import type { Route } from "next";

/**
 * UC1 — Single text import.
 *
 * Phase 1 placeholder. When CI-11 is implemented, this page will have:
 *   - A textarea for pasting product text (name, brand, price, description)
 *   - A "Parse" button that calls fn_parse_product_text
 *   - Staging preview showing parsed fields
 *   - Category assignment (auto-suggested, user-confirmable)
 *   - Variant detection results (using category's default_variant_axes)
 *   - "Promote to catalog" button
 */

export default function TextImportPage() {
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
          <Link href={"/import" as Route}>Importar</Link>
          <span style={{ margin: "0 6px", color: "var(--s-text-muted)" }}>
            /
          </span>
          <span>Entrada de texto</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">Importar desde texto</h1>
          <p className="s-meta">
            Pegá la información de un producto. El agente lo parsea, detecta
            variantes y sugiere categoría.
          </p>
        </div>
      </div>

      <div className="s-card">
        <div style={{ padding: 24 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--s-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            Texto del producto
          </label>
          <textarea
            className="s-input"
            rows={6}
            placeholder={`Ej: Royal Canin Medium Adult 15kg - Alimento seco para perros adultos de raza mediana. Q945.00`}
            disabled
            style={{
              width: "100%",
              resize: "vertical",
              fontFamily: "var(--s-font-mono)",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 16,
              alignItems: "center",
            }}
          >
            <button
              className="s-btn s-btn-primary"
              type="button"
              disabled
              title="Pendiente de implementación (CI-11)"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M7 2v10M2 7h10" />
              </svg>
              Parsear producto
            </button>
            <span
              style={{
                fontSize: 12,
                color: "var(--s-text-muted)",
              }}
            >
              Parser de texto pendiente — CI-11
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
