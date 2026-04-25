export default function TextImportPage() {
  return (
    <div style={{ padding: "28px 32px", maxWidth: 760 }}>
      <h1
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--s-text, #23211d)",
          marginBottom: 8,
        }}
      >
        Texto rápido
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--s-muted, #73726c)",
          marginBottom: 24,
        }}
      >
        Escriba o pegue una línea de texto describiendo un producto. El sistema
        lo interpretará y propondrá la estructura.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
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

      <div
        style={{
          padding: 20,
          background: "var(--s-surface, #f5f2eb)",
          borderRadius: 8,
          textAlign: "center" as const,
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: "var(--s-muted, #73726c)",
            margin: 0,
          }}
        >
          El parser de texto se habilitará cuando se complete CI-11
          (fn_parse_product_text).
        </p>
      </div>
    </div>
  );
}
