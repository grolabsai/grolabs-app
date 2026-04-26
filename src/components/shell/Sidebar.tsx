"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Route } from "next";
import {
  Package,
  LayoutList,
  SlidersHorizontal,
  Building2,
  Shapes,
  Tag,
  GitMerge,
  PawPrint,
  Rabbit,
  UserRound,
  Settings,
  Search,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Scout sidebar navigation.
 *
 * Rebuilt on shadcn conventions (cn(), lucide-react icons, no inline SVGs).
 * Visual layout is identical to the previous version — same sections, same
 * sizes, same active/disabled states.
 *
 * Icons use lucide-react stroke style. Sizes match the original 14×14 SVGs.
 *
 * TODO (follow-up): swap plain next/link for @/i18n/routing Link once all
 * hrefs are migrated to locale-aware navigation.
 */

type NavItem = {
  href: Route | null; // null = not yet implemented
  label: string;
  icon: React.ElementType;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

export function Sidebar({ instanceName }: { instanceName: string }) {
  const pathname = usePathname();
  const t = useTranslations("configuration.algolia");

  const NAV: NavGroup[] = [
    {
      title: "Catálogo",
      items: [
        { href: "/catalog/products", label: "Productos", icon: Package },
        { href: "/catalog/categories" as Route, label: "Categorías", icon: LayoutList },
        { href: null, label: "Atributos", icon: SlidersHorizontal },
        { href: null, label: "Marcas", icon: Building2 },
        { href: null, label: "Tipos de producto", icon: Shapes },
        { href: null, label: "Etiquetas", icon: Tag },
        { href: null, label: "Reglas de coincidencia", icon: GitMerge },
      ],
    },
    {
      title: "Datos",
      items: [
        { href: "/import" as Route, label: "Importar", icon: Download },
      ],
    },
    {
      title: "Referencias",
      items: [
        { href: null, label: "Especies", icon: PawPrint },
        { href: null, label: "Razas", icon: Rabbit },
        { href: null, label: "Atributos de perfil", icon: UserRound },
      ],
    },
    {
      title: "Configuración",
      items: [
        { href: "/configuration/algolia" as Route, label: t("navLabel"), icon: Search },
        { href: null, label: "Ajustes de la tienda", icon: Settings },
      ],
    },
  ];

  return (
    <nav className="s-nav">
      {/* Brand mark */}
      <div className="s-brand">
        <div className="s-brand-mark" />
        <span className="s-brand-name">Scout</span>
      </div>

      {/* Nav groups */}
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="s-nav-section">{group.title}</p>

          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = item.href
              ? pathname === item.href ||
                pathname.startsWith(item.href + "/")
              : false;

            if (!item.href) {
              return (
                <div
                  key={item.label}
                  className="s-nav-item"
                  style={{ opacity: 0.45, cursor: "not-allowed" }}
                  title="Próximamente"
                >
                  <Icon
                    className="s-nav-icon"
                    size={14}
                    strokeWidth={1.5}
                  />
                  {item.label}
                  <span className="s-nav-badge">···</span>
                </div>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn("s-nav-item", isActive && "active")}
              >
                <Icon
                  className="s-nav-icon"
                  size={14}
                  strokeWidth={1.5}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}

      {/* Instance badge */}
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
      </div>
    </nav>
  );
}
