import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import {
  ChevronRight,
  Search,
  Plus,
  Trash2,
  Settings,
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";

export const metadata = { title: "Estilo — GroLabs" };

const COLORS: { label: string; token: string; hex: string }[] = [
  // Accent
  { label: "Accent", token: "--scout-accent", hex: "#378ADD" },
  { label: "Accent hover", token: "--scout-accent-hover", hex: "#185FA5" },
  { label: "Accent 50", token: "--scout-accent-50", hex: "#E6F1FB" },
  { label: "Accent 100", token: "--scout-accent-100", hex: "#B5D4F4" },
  // Surfaces
  { label: "BG", token: "--s-bg", hex: "#FAFAF9" },
  { label: "Surface", token: "--s-surface", hex: "#FFFFFF" },
  { label: "Surface alt", token: "--s-surface-alt", hex: "#F5F5F4" },
  { label: "Surface hover", token: "--s-surface-hover", hex: "#EFEFEE" },
  // Text
  { label: "Text", token: "--s-text", hex: "#1A1A1A" },
  { label: "Text secondary", token: "--s-text-secondary", hex: "#5F5E5A" },
  { label: "Text tertiary", token: "--s-text-tertiary", hex: "#888780" },
  { label: "Text muted", token: "--s-text-muted", hex: "#B4B2A9" },
  // Semantic
  { label: "Success", token: "--s-success", hex: "#1D9E75" },
  { label: "Success bg", token: "--s-success-bg", hex: "#E1F5EE" },
  { label: "Danger", token: "--s-danger", hex: "#A32D2D" },
  { label: "Danger bg", token: "--s-danger-bg", hex: "#FCEBEB" },
];

const RADII: { label: string; token: string; px: string }[] = [
  { label: "sm", token: "--s-radius-sm", px: "6px" },
  { label: "md", token: "--s-radius-md", px: "8px" },
  { label: "lg", token: "--s-radius-lg", px: "12px" },
  { label: "xl", token: "--s-radius-xl", px: "16px" },
];

const SECTIONS = [
  "Colores",
  "Tipografía",
  "Espaciado",
  "Superficies",
  "Botones",
  "Inputs",
  "Iconos",
  "Estados",
  "Patrones de notas",
];

export default function StyleguidePage() {
  return (
    <div className="flex gap-8 p-8 max-w-[1200px]">
      {/* Sticky TOC */}
      <aside className="w-44 shrink-0">
        <div className="sticky top-8 flex flex-col gap-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">
            Secciones
          </p>
          {SECTIONS.map((s) => (
            <a
              key={s}
              href={`#${s.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-[13px] text-[var(--s-text-secondary)] hover:text-[var(--s-text)] transition-colors"
            >
              {s}
            </a>
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-12">

        {/* ── 1. Colores ──────────────────────────────────────────────────── */}
        <section id="colores">
          <h2 className="text-lg font-semibold mb-4">Colores</h2>
          <div className="grid grid-cols-4 gap-3">
            {COLORS.map((c) => (
              <div key={c.token} className="flex flex-col gap-1.5">
                <div
                  className="h-12 rounded-md border border-[var(--s-border)]"
                  style={{ background: c.hex }}
                />
                <div className="text-[11px] font-medium text-[var(--s-text)]">{c.label}</div>
                <div className="text-[10px] font-mono text-[var(--s-text-tertiary)]">{c.hex}</div>
                <div className="text-[9px] font-mono text-[var(--s-text-muted)] leading-tight">{c.token}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 2. Tipografía ───────────────────────────────────────────────── */}
        <section id="tipografía">
          <h2 className="text-lg font-semibold mb-4">Tipografía</h2>
          <div className="flex flex-col gap-4 p-6 border border-[var(--s-border)] rounded-lg">
            <div>
              <p style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: "var(--s-text)" }}>
                Título grande — 24/700
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">24px · 700 · #1A1A1A</code>
            </div>
            <div>
              <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3, color: "var(--s-text)" }}>
                Título de sección — 18/600
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">18px · 600 · #1A1A1A</code>
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: "var(--s-text)" }}>
                Cuerpo de formulario — 15/500 (input content)
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">15px · 500 · #000</code>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.5, color: "var(--s-text)" }}>
                Cuerpo estándar — 13/400
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">13px · 400 · --s-text</code>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.5, color: "var(--s-text-secondary)" }}>
                Secundario — 13/400
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">13px · 400 · --s-text-secondary</code>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.5, color: "var(--s-text-tertiary)" }}>
                Terciario / metadatos — 12/400
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">12px · 400 · --s-text-tertiary</code>
            </div>
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--s-text-tertiary)",
                }}
              >
                Etiqueta de campo / sección — 10/500 uppercase
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">10px · 500 · uppercase · tracking-0.06em</code>
            </div>
            <div>
              <p style={{ fontSize: 12, fontFamily: "var(--s-font-mono)", color: "var(--s-text)" }}>
                Mono — SHA · 2026-04-26
              </p>
              <code className="text-[10px] text-[var(--s-text-tertiary)]">12px · mono · --s-font-mono</code>
            </div>
          </div>
        </section>

        {/* ── 3. Espaciado / Radio ────────────────────────────────────────── */}
        <section id="espaciado">
          <h2 className="text-lg font-semibold mb-4">Espaciado — radio</h2>
          <div className="flex gap-6 flex-wrap">
            {RADII.map((r) => (
              <div key={r.token} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 bg-[var(--scout-accent-50)] border border-[var(--scout-accent-100)]"
                  style={{ borderRadius: r.px }}
                />
                <div className="text-[12px] font-medium text-[var(--s-text)]">{r.label}</div>
                <div className="text-[10px] font-mono text-[var(--s-text-tertiary)]">{r.px}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. Superficies ──────────────────────────────────────────────── */}
        <section id="superficies">
          <h2 className="text-lg font-semibold mb-4">Superficies</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">
                Card (shadcn)
              </p>
              <Card>
                <CardHeader>
                  <CardTitle>Título</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-[var(--s-text-secondary)]">Contenido de la card.</p>
                </CardContent>
              </Card>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">
                Surface alt
              </p>
              <div className="rounded-lg border border-[var(--s-border)] bg-[var(--s-surface-alt)] p-4">
                <p className="text-sm text-[var(--s-text-secondary)]">Superficie alternativa para filas alternas o paneles de detalle secundario.</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">
                Surface hover
              </p>
              <div className="rounded-lg border border-[var(--s-border)] bg-[var(--s-surface-hover)] p-4">
                <p className="text-sm text-[var(--s-text-secondary)]">Estado hover de filas de tabla y ítems de lista.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 5. Botones ──────────────────────────────────────────────────── */}
        <section id="botones">
          <h2 className="text-lg font-semibold mb-4">Botones</h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Button variant="default">Guardar</Button>
              <Button variant="secondary">Cancelar</Button>
              <Button variant="outline">
                <Icon icon={Plus} size={14} />
                Agregar
              </Button>
              <Button variant="destructive">
                <Icon icon={Trash2} size={14} />
                Eliminar
              </Button>
              <Button variant="ghost">
                <Icon icon={Settings} size={14} />
                Configurar
              </Button>
              <Button variant="link">Ver más</Button>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <Button size="sm">Pequeño</Button>
              <Button size="default">Mediano</Button>
              <Button size="lg">Grande</Button>
              <Button size="icon" variant="outline"><Icon icon={Search} size={16} /></Button>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <Button disabled>Deshabilitado</Button>
              <Button variant="outline" disabled>Deshabilitado outline</Button>
            </div>
            {/* s-btn legacy classes */}
            <div className="flex flex-wrap gap-3 items-center">
              <button className="s-btn s-btn-primary">s-btn-primary</button>
              <button className="s-btn s-btn-secondary">s-btn-secondary</button>
              <button className="s-btn s-btn-danger">s-btn-danger</button>
            </div>
          </div>
        </section>

        {/* ── 6. Inputs ───────────────────────────────────────────────────── */}
        <section id="inputs">
          <h2 className="text-lg font-semibold mb-4">Inputs</h2>
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-1.5 block">
                  shadcn Input (default)
                </label>
                <Input placeholder="Escribí algo..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-1.5 block">
                  shadcn Input (disabled)
                </label>
                <Input placeholder="Deshabilitado" disabled />
              </div>
              <div>
                <FloatingLabelInput
                  id="sg-name"
                  label="Nombre del producto"
                  placeholder="Ej: Alimento perro adulto"
                />
              </div>
              <div>
                <FloatingLabelInput
                  id="sg-slug"
                  label="Slug"
                  placeholder="alimento-perro-adulto"
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-1.5 block">
                  s-input (legacy)
                </label>
                <input className="s-input" placeholder="s-input placeholder" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-1.5 block">
                  s-textarea (legacy)
                </label>
                <textarea className="s-textarea" placeholder="s-textarea placeholder" rows={3} />
              </div>
              <div className="flex items-center gap-3">
                <Switch id="sg-switch" />
                <label htmlFor="sg-switch" className="text-sm text-[var(--s-text)]">Switch activado</label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="sg-switch-off" defaultChecked={false} />
                <label htmlFor="sg-switch-off" className="text-sm text-[var(--s-text-secondary)]">Switch desactivado</label>
              </div>
            </div>
          </div>
        </section>

        {/* ── 7. Iconos ───────────────────────────────────────────────────── */}
        <section id="iconos">
          <h2 className="text-lg font-semibold mb-4">Iconos</h2>
          <div className="flex flex-col gap-4 p-6 border border-[var(--s-border)] rounded-lg">
            <p className="text-[11px] text-[var(--s-text-tertiary)] mb-2">
              Siempre usar el wrapper <code className="font-mono">&lt;Icon&gt;</code> — nunca Lucide directo sin size + strokeWidth.
            </p>
            <div className="flex items-end gap-6">
              <div className="flex flex-col items-center gap-2">
                <Icon icon={ChevronRight} size={12} />
                <code className="text-[9px] text-[var(--s-text-tertiary)]">12px</code>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon icon={ChevronRight} size={14} />
                <code className="text-[9px] text-[var(--s-text-tertiary)]">14px</code>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon icon={ChevronRight} size={16} />
                <code className="text-[9px] text-[var(--s-text-tertiary)]">16px (default)</code>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon icon={ChevronRight} size={20} />
                <code className="text-[9px] text-[var(--s-text-tertiary)]">20px</code>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon icon={ChevronRight} size={24} />
                <code className="text-[9px] text-[var(--s-text-tertiary)]">24px</code>
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2">
              {[Search, Plus, Trash2, Settings, AlertTriangle, Info, CheckCircle, XCircle, Loader2].map(
                (Ic) => (
                  <Icon key={Ic.displayName} icon={Ic} size={16} />
                )
              )}
            </div>
          </div>
        </section>

        {/* ── 8. Estados ──────────────────────────────────────────────────── */}
        <section id="estados">
          <h2 className="text-lg font-semibold mb-4">Estados</h2>
          <div className="flex flex-col gap-4">
            {/* Empty state */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Empty state</p>
              <div className="flex flex-col items-center justify-center gap-3 py-12 rounded-lg border border-dashed border-[var(--s-border)]">
                <Icon icon={Search} size={24} />
                <p className="text-sm font-medium text-[var(--s-text)]">No hay resultados</p>
                <p className="text-[13px] text-[var(--s-text-secondary)] text-center max-w-xs">
                  Intentá con otros filtros o creá el primer elemento.
                </p>
                <Button variant="outline" size="sm">
                  <Icon icon={Plus} size={14} />
                  Crear
                </Button>
              </div>
            </div>

            {/* Error strip */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Error strip</p>
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-md text-sm"
                style={{ background: "var(--s-danger-bg)", color: "var(--s-danger-text)" }}
              >
                <Icon icon={XCircle} size={16} />
                No se pudo guardar. Verificá los campos e intentá de nuevo.
              </div>
            </div>

            {/* Success strip */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Success strip</p>
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-md text-sm"
                style={{ background: "var(--s-success-bg)", color: "var(--s-success-text)" }}
              >
                <Icon icon={CheckCircle} size={16} />
                Cambios guardados correctamente.
              </div>
            </div>

            {/* Loading skeleton */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Loading skeleton</p>
              <div className="flex flex-col gap-2">
                {[160, 240, 200].map((w) => (
                  <div
                    key={w}
                    className="h-4 rounded animate-pulse bg-[var(--s-surface-hover)]"
                    style={{ width: w }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 9. Patrones de notas ────────────────────────────────────────── */}
        <section id="patrones-de-notas">
          <h2 className="text-lg font-semibold mb-4">Patrones de notas</h2>
          <div className="flex flex-col gap-4">
            {/* Info banner */}
            <div
              className="flex items-start gap-3 px-4 py-3 rounded-md text-sm"
              style={{ background: "var(--scout-accent-50)", color: "var(--scout-accent-800)" }}
            >
              <Icon icon={Info} size={16} />
              <div>
                <span className="font-medium">Nota de parsing</span>
                <span className="ml-1">— esta categoría hereda los atributos de &ldquo;Alimentos&rdquo; y agrega &ldquo;Sabor&rdquo; como eje de variante propio.</span>
              </div>
            </div>

            {/* Warning banner */}
            <div
              className="flex items-start gap-3 px-4 py-3 rounded-md text-sm"
              style={{ background: "#FEF9EC", color: "#7A5204" }}
            >
              <Icon icon={AlertTriangle} size={16} />
              <div>
                <span className="font-medium">Sin atributos propios</span>
                <span className="ml-1">— esta categoría hereda todos los atributos de su padre. Agregá atributos específicos si corresponde.</span>
              </div>
            </div>

            {/* Agent note */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)]">
                Nota del agente (reservado)
              </p>
              <div className="rounded-md border border-[var(--scout-accent-100)] bg-[var(--scout-accent-50)] px-4 py-3 text-sm text-[var(--scout-accent-800)]">
                Detecté que este producto tiene 3 variantes de peso (100g, 250g, 500g) sin eje de variante configurado. ¿Querés que configure &ldquo;Peso&rdquo; como eje?
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
