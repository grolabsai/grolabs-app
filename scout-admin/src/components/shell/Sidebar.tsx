"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

/**
 * Scout sidebar navigation. Adopts the Bloom IA visually (dense, 13px,
 * cream surface) but reflects the Scout feature set instead:
 *
 *   Catálogo (the user works here daily)
 *     Productos, Categorías, Atributos, Marcas, Tipos de producto, Etiquetas,
 *     Reglas de coincidencia
 *
 *   Referencias (pet-shop-specific data modeling)
 *     Especies, Razas, Atributos de perfil
 *
 *   Configuración
 *     Ajustes de la tienda
 *
 * Routes not yet implemented are marked with `disabled` and render as a
 * dimmed row — user can see what's coming without clicking into a 404.
 */

type NavItem = {
  href: Route | null; // null = not yet implemented (disabled row)
  label: string;
  icon: React.ReactNode;
  badge?: string;
};

type NavGroup = { title?: string; items: NavItem[] };

// Tiny 16×16 inline icons — intentionally simple, designed to match Bloom's
// stroke-only icon vocabulary. Each is 1.5px stroke, currentColor.
const i = (d: string) => (
  <svg
    className="s-nav-icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    dangerouslySetInnerHTML={{ __html: d }}
  />
);

const NAV: NavGroup[] = [
  {
    title: "Catálogo",
    items: [
      {
        href: "/catalog/products",
        label: "Productos",
        icon: i(
          '<path d="M2 5l6-3 6 3v6l-6 3-6-3V5z"/><path d="M2 5l6 3 6-3"/><path d="M8 8v6"/>',
        ),
      },
      {
        href: "/catalog/categories",
        label: "Categorías",
        icon: i(
          '<path d="M2 4a1 1 0 011-1h3l1 2h6a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/>',
        ),
      },
      {
        href: null,
        label: "Marcas",
        icon: i(
          '<path d="M2 7V2h5l7 7-5 5z"/><circle cx="5" cy="5" r="1"/>',
        ),
      },
      {
        href: null,
        label: "Atributos",
        icon: i(
          '<rect x="2" y="2" width="5" height="12" rx="1"/><rect x="9" y="2" width="5" height="6" rx="1"/>',
        ),
      },
      {
        href: null,
        label: "Especies",
        icon: i(
          '<circle cx="6" cy="4" r="2"/><circle cx="11" cy="5" r="1.5"/><path d="M4 14c0-3 2-5 4-5s4 2 4 5"/>',
        ),
      },
      {
        href: null,
        label: "Etiquetas",
        icon: i(
          '<path d="M2 7V2h5l7 7-5 5z"/><circle cx="5" cy="5" r="1"/>',
        ),
      },
    ],
  },
  {
    title: "Importar",
    items: [
      {
        href: "/import",
        label: "Inicio",
        icon: i('<path d="M8 2v12M4 8l4 4 4-4"/>'),
      },
      {
        href: "/import/text",
        label: "Texto rápido",
        icon: i(
          '<path d="M7 13H4a1 1 0 01-1-1V4a1 1 0 011-1h5.586a1 1 0 01.707.293L13 6v6a1 1 0 01-1 1h-2"/><path d="M6 9h4"/>',
        ),
      },
      {
        href: null,
        label: "Excel / CSV",
        icon: i(
          '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 6h4M6 9h4"/>',
        ),
      },
      {
        href: null,
        label: "Migración",
        icon: i(
          '<path d="M3 5c0-1.1 2.2-2 5-2s5 .9 5 2v6c0 1.1-2.2 2-5 2s-5-.9-5-2V5z"/><path d="M3 5c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
        ),
      },
      {
        href: null,
        label: "Revisión",
        icon: i(
          '<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M6 8l1.5 1.5L10 7"/>',
        ),
      },
      {
        href: null,
        label: "Calidad",
        icon: i(
          '<path d="M4 12V8a1 1 0 011-1h2a1 1 0 011 1v4"/><path d="M8 12V5a1 1 0 011-1h2a1 1 0 011 1v7"/>',
        ),
      },
    ],
  },
  {
    title: "Configuración",
    items: [
      {
        href: null,
        label: "SKU",
        icon: i('<path d="M4 4h2v8H4zM8 4h1v8H8zM11 4h3v8h-3zM7 4h0.5v8H7"/>'),
      },
      {
        href: null,
        label: "Exportar",
        icon: i(
          '<path d="M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2"/><path d="M8 10V3M5 6l3-3 3 3"/>',
        ),
      },
    ],
  },
];

export function Sidebar({ instanceName }: { instanceName: string }) {
  const pathname = usePathname();

  return (
    <nav className="s-nav">
      <div className="s-brand">
        <div className="s-brand-mark" />
        <span className="s-brand-name">Scout</span>
      </div>

      {NAV.map((group) => (
        <div key={group.title ?? "_"}>
          {group.title ? <p className="s-nav-section">{group.title}</p> : null}
          {group.items.map((item) => {
            const isActive = item.href
              ? pathname === item.href || pathname.startsWith(item.href + "/")
              : false;

            if (!item.href) {
              return (
                <div
                  key={item.label}
                  className="s-nav-item"
                  style={{ opacity: 0.45, cursor: "not-allowed" }}
                  title="Próximamente"
                >
                  {item.icon}
                  {item.label}
                  <span className="s-nav-badge">···</span>
                </div>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`s-nav-item${isActive ? " active" : ""}`}
              >
                {item.icon}
                {item.label}
                {item.badge ? (
                  <span className="s-nav-badge">{item.badge}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}

      <div style={{ marginTop: 24, padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 4,
          }}
        >
          Instancia
        </div>
        <div style={{ fontSize: 13, color: "var(--s-text)" }}>{instanceName}</div>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-muted)",
            marginTop: 8,
            fontFamily: "var(--s-font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          scout-admin v{process.env.NEXT_PUBLIC_APP_VERSION ?? "?.?.?"}
        </div>
      </div>
    </nav>
  );
}
