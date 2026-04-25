export default function CategoriesIndexPage() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      minHeight: 400,
      color: "var(--s-text-tertiary, #818b98)",
      fontSize: 14,
    }}>
      <div style={{ textAlign: "center" }}>
        <svg width="40" height="40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 12, opacity: 0.4 }}>
          <path d="M2 4a1 1 0 011-1h3l1 2h6a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
        </svg>
        <p style={{ fontWeight: 500, marginBottom: 4 }}>Seleccioná una categoría</p>
        <p style={{ fontSize: 12 }}>Elegí del árbol a la izquierda para ver sus detalles.</p>
      </div>
    </div>
  );
}
