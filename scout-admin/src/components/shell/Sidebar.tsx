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
        icon: i('<path d="M3 4h10M3 8h10M3 12h6"/>'),
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
        label: "Marcas",
        icon: i(
          '<path d="M8 1l7 4v6l-7 4-7-4V5l7-4z"/><path d="M5 8l2 2 4-4"/>',
        ),
      },
      {
        href: null,
        label: "Tipos de producto",
        icon: i(
          '<circle cx="8" cy="8" r="6"/><path d="M8 4v8M4 8h8"/>',
        ),
      },
      {
        href: null,
        label: "Etiquetas",
        icon: i(
          '<path d="M2 7V2h5l7 7-5 5z"/><circle cx="5" cy="5" r="1"/>',
        ),
      },
      {
        href: null,
        label: "Reglas de coincidencia",
        icon: i(
          '<circle cx="5" cy="5" r="3"/><circle cx="11" cy="11" r="3"/><path d="M7.5 7.5l1 1"/>',
        ),
      },
    ],
  },
  {
    title: "Datos",
    items: [
      {
        href: "/import",
        label: "Importar",
        icon: i(
          '<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 14v2a1 1 0 001 1h6a1 1 0 001-1v-2"/>',
        ),
      },
    ],
  },
  {
    title: "Referencias",
    items: [
      {
        href: null,
        label: "Especies",
        icon: i(
          '<circle cx="6" cy="4" r="2"/><circle cx="11" cy="5" r="1.5"/><path d="M4 14c0-3 2-5 4-5s4 2 4 5"/>',
        ),
      },
      {
        href: null,
        label: "Razas",
        icon: i(
          '<path d="M3 12l2-6h6l2 6"/><path d="M5 12v-2h6v2"/>',
        ),
      },
      {
        href: null,
        label: "Atributos de perfil",
        icon: i(
          '<circle cx="8" cy="5" r="2"/><path d="M3 14c0-3 2-5 5-5s5 2 5 5"/>',
        ),
      },
    ],
  },
  {
    title: "Configuración",
    items: [
      {
        href: null,
        label: "Ajustes de la tienda",
        icon: i(
          '<circle cx="8" cy="8" r="2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M4 4l1.5 1.5M10.5 10.5L12 12M4 12l1.5-1.5M10.5 5.5L12 4"/>',
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
