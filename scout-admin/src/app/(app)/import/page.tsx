import Link from "next/link";

export default function ImportDashboardPage() {
  return (
    <div style={{ padding: "28px 32px", maxWidth: 760 }}>
      <h1
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--s-text, #23211d)",
          marginBottom: 20,
        }}
      >
        Importar
      </h1>

      {/* Quick entry */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--s-muted, #73726c)",
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            display: "block",
            marginBottom: 8,
          }}
        >
          Entrada rápida
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Royal Canin Medium Adult 15kg saco alimento seco perros"
            disabled
            style={{
              flex: 1,
              fontSize: 13,
              padding: "8px 12px",
              border: "1px solid var(--s-border, #e5e2da)",
              borderRadius: 6,
              background: "var(--s-bg, #fff)",
              color: "var(--s-text, #23211d)",
              fontFamily: "inherit",
            }}
          />
          <button
            disabled
            style={{
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              background: "var(--s-accent, #378ADD)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "not-allowed",
              opacity: 0.5,
              fontFamily: "inherit",
            }}
          >
            Parsear
          </button>
        </div>
        <p
          style={{
            fontSize: 11,
            color: "var(--s-muted, #73726c)",
            marginTop: 4,
          }}
        >
          Próximamente — UC1 texto rápido (CI-11)
        </p>
      </div>

      {/* Import cards */}
      <label
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--s-muted, #73726c)",
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          display: "block",
          marginBottom: 8,
        }}
      >
        Opciones de importación
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 24,
        }}
      >
        <Link
          href="/import/text"
          style={{
            background: "var(--s-bg, #fff)",
            border: "1px solid var(--s-border, #e5e2da)",
            borderRadius: 8,
            padding: "14px 16px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--s-text, #23211d)",
              marginBottom: 2,
            }}
          >
            Texto rápido
          </div>
          <div style={{ fontSize: 11, color: "var(--s-muted, #73726c)" }}>
            Un producto, una línea
          </div>
        </Link>
        <div
          style={{
            background: "var(--s-bg, #fff)",
            border: "1px solid var(--s-border, #e5e2da)",
            borderRadius: 8,
            padding: "14px 16px",
            opacity: 0.5,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--s-text, #23211d)",
              marginBottom: 2,
            }}
          >
            Excel / CSV
          </div>
          <div style={{ fontSize: 11, color: "var(--s-muted, #73726c)" }}>
            Próximamente (M3)
          </div>
        </div>
        <div
          style={{
            background: "var(--s-bg, #fff)",
            border: "1px solid var(--s-border, #e5e2da)",
            borderRadius: 8,
            padding: "14px 16px",
            opacity: 0.5,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--s-text, #23211d)",
              marginBottom: 2,
            }}
          >
            Migración completa
          </div>
          <div style={{ fontSize: 11, color: "var(--s-muted, #73726c)" }}>
            Próximamente (M4)
          </div>
        </div>
      </div>
    </div>
  );
}
