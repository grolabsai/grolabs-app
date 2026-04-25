"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string | null;
  label: string;
  icon: React.ReactNode;
  badge?: string;
};

type NavGroup = {
  title: string | null;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    title: "Catálogo",
    items: [
      { href: "/catalog/products", label: "Productos", icon: <Ico d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /> },
      { href: "/catalog/categories", label: "Categorías", icon: <Ico d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /> },
      { href: null, label: "Marcas", icon: <Ico d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /> },
      { href: null, label: "Atributos", icon: <Ico d="M4 6h16M4 10h16M4 14h16M4 18h16" /> },
      { href: null, label: "Especies", icon: <Ico d="M12 21C8 17 4 13 4 9a8 8 0 0116 0c0 4-4 8-8 12z" /> },
      { href: null, label: "Etiquetas", icon: <Ico d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581a2.25 2.25 0 003.182 0l4.318-4.318a2.25 2.25 0 000-3.182L11.16 3.66A2.25 2.25 0 009.568 3z" /> },
    ],
  },
  {
    title: "Importar",
    items: [
      { href: "/import", label: "Inicio", icon: <Ico d="M12 4v16m8-8H4" /> },
      { href: "/import/text", label: "Texto rápido", icon: <Ico d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /> },
      { href: null, label: "Excel / CSV", icon: <Ico d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /> },
      { href: null, label: "Migración", icon: <Ico d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /> },
      { href: null, label: "Revisión", icon: <Ico d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /> },
      { href: null, label: "Calidad", icon: <Ico d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /> },
    ],
  },
  {
    title: "Configuración",
    items: [
      { href: null, label: "SKU", icon: <Ico d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /> },
      { href: null, label: "Exportar", icon: <Ico d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /> },
    ],
  },
];

function Ico({ d }: { d: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export function Sidebar({ instanceName }: { instanceName: string }) {
  const pathname = usePathname();
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

  return (
    <aside className="s-sidebar">
      {/* Brand */}
      <div className="s-sidebar-brand">
        <Link href="/catalog/products" style={{ textDecoration: "none", color: "inherit" }}>
          Scout
        </Link>
      </div>

      {/* Navigation */}
      <nav className="s-nav">
        {NAV.map((group) => (
          <div key={group.title ?? "root"} className="s-nav-group">
            {group.title ? <p className="s-nav-section">{group.title}</p> : null}
            {group.items.map((item) => {
              const isActive = item.href ? pathname.startsWith(item.href) : false;
              const disabled = item.href === null;

              if (disabled) {
                return (
                  <div key={item.label} className="s-nav-item s-nav-item--disabled">
                    <span className="s-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                );
              }

              return (
                <Link
                  key={item.label}
                  href={item.href!}
                  className={`s-nav-item ${isActive ? "s-nav-item--active" : ""}`}
                >
                  <span className="s-nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && <span className="s-nav-badge">{item.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Instance + version */}
      <div className="s-sidebar-footer">
        <p className="s-nav-section" style={{ marginBottom: 4 }}>
          Instancia
        </p>
        <div style={{ fontSize: 13, color: "var(--s-text)" }}>{instanceName}</div>
        <div style={{ fontSize: 10, color: "var(--s-muted)", marginTop: 8 }}>
          scout-admin v{version}
        </div>
      </div>
    </aside>
  );
}
