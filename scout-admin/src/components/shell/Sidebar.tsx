"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  Package,
  LayoutList,
  SlidersHorizontal,
  BadgeCheck,
  CirclePlus,
  Tag,
  GitCompareArrows,
  Download,
  PawPrint,
  Shapes,
  UserCircle,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type NavItem = {
  href: Route | null;
  label: string;
  Icon: LucideIcon;
  badge?: string;
};

type NavGroup = { title?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Catálogo",
    items: [
      { href: "/catalog/products", label: "Productos", Icon: Package },
      { href: "/catalog/categories", label: "Categorías", Icon: LayoutList },
      { href: null, label: "Atributos", Icon: SlidersHorizontal },
      { href: null, label: "Marcas", Icon: BadgeCheck },
      { href: null, label: "Tipos de producto", Icon: CirclePlus },
      { href: null, label: "Etiquetas", Icon: Tag },
      { href: null, label: "Reglas de coincidencia", Icon: GitCompareArrows },
    ],
  },
  {
    title: "Datos",
    items: [
      { href: "/import", label: "Importar", Icon: Download },
    ],
  },
  {
    title: "Referencias",
    items: [
      { href: null, label: "Especies", Icon: PawPrint },
      { href: null, label: "Razas", Icon: Shapes },
      { href: null, label: "Atributos de perfil", Icon: UserCircle },
    ],
  },
  {
    title: "Configuración",
    items: [
      { href: null, label: "Ajustes de la tienda", Icon: Settings },
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
                  <item.Icon size={16} strokeWidth={1.5} className="s-nav-icon" />
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
                <item.Icon size={16} strokeWidth={1.5} className="s-nav-icon" />
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
          scout-admin v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.4.0"}
        </div>
      </div>
    </nav>
  );
}
