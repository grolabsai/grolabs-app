"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Combobox } from "@/components/ui/combobox";
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
  Hash,
  List,
  Type,
  Calculator,
  Layers,
} from "lucide-react";

const SECTIONS = [
  "Colores",
  "Tipografía",
  "Superficies",
  "Botones",
  "Inputs",
  "Combobox",
  "Iconos",
  "Estados",
  "Patrones de notas",
];

const COLORS: { label: string; token: string; hex: string }[] = [
  { label: "Accent", token: "--scout-accent", hex: "#378ADD" },
  { label: "Accent 50", token: "--scout-accent-50", hex: "#E6F1FB" },
  { label: "Accent 100", token: "--scout-accent-100", hex: "#B5D4F4" },
  { label: "BG", token: "--s-bg", hex: "#FAFAF9" },
  { label: "Surface", token: "--s-surface", hex: "#FFFFFF" },
  { label: "Surface alt", token: "--s-surface-alt", hex: "#F5F5F4" },
  { label: "Text", token: "--s-text", hex: "#1A1A1A" },
  { label: "Text secondary", token: "--s-text-secondary", hex: "#5F5E5A" },
  { label: "Text tertiary", token: "--s-text-tertiary", hex: "#888780" },
  { label: "Text muted", token: "--s-text-muted", hex: "#B4B2A9" },
  { label: "Success", token: "--s-success", hex: "#1D9E75" },
  { label: "Danger", token: "--s-danger", hex: "#A32D2D" },
];

// ── Combobox demo data ──────────────────────────────────────────────────────

const DATA_TYPE_OPTIONS = [
  { value: "list", label: "Lista", description: "Opciones predefinidas", glyph: <Icon icon={List} size={14} /> },
  { value: "text", label: "Texto", description: "Cadena libre", glyph: <Icon icon={Type} size={14} /> },
  { value: "number", label: "Número", description: "Valor numérico", glyph: <Icon icon={Hash} size={14} /> },
  { value: "quantity", label: "Cantidad", description: "Número + unidad de medida", glyph: <Icon icon={Calculator} size={14} /> },
];

const ATTRIBUTE_OPTIONS = [
  { value: 1, label: "Peso", description: "Cantidad · usado en 12 categorías", glyph: <Icon icon={Calculator} size={14} /> },
  { value: 2, label: "Color", description: "Lista · usado en 8 categorías", glyph: <Icon icon={List} size={14} /> },
  { value: 3, label: "Talla", description: "Lista · usado en 6 categorías", glyph: <Icon icon={List} size={14} /> },
  { value: 4, label: "Sabor", description: "Lista · usado en 4 categorías", glyph: <Icon icon={List} size={14} /> },
  { value: 5, label: "Descripción larga", description: "Texto · usado en 14 categorías", glyph: <Icon icon={Type} size={14} /> },
];

const TAG_OPTIONS = [
  { value: "promo", label: "Promoción" },
  { value: "new", label: "Novedad" },
  { value: "sale", label: "Oferta" },
  { value: "seasonal", label: "Temporada" },
  { value: "bundle", label: "Pack" },
];

const CATEGORY_OPTIONS = [
  { value: 1, label: "Alimentos", glyph: <Icon icon={Layers} size={14} /> },
  { value: 2, label: "Alimentos · Perro", glyph: <Icon icon={Layers} size={14} /> },
  { value: 3, label: "Alimentos · Gato", glyph: <Icon icon={Layers} size={14} /> },
  { value: 4, label: "Accesorios", glyph: <Icon icon={Layers} size={14} /> },
  { value: 5, label: "Higiene", glyph: <Icon icon={Layers} size={14} /> },
];

// ── Page component ──────────────────────────────────────────────────────────

export default function StyleguidePage() {
  const [dataType, setDataType] = useState<string | number | undefined>(undefined);
  const [attribute, setAttribute] = useState<string | number | undefined>(undefined);
  const [tags, setTags] = useState<(string | number)[]>([]);
  const [category, setCategory] = useState<string | number | undefined>(undefined);

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

        {/* ── Colores ─────────────────────────────────────────────────────── */}
        <section id="colores">
          <h2 className="text-lg font-semibold mb-4">Colores</h2>
          <div className="grid grid-cols-4 gap-3">
            {COLORS.map((c) => (
              <div key={c.token} className="flex flex-col gap-1.5">
                <div
                  className="h-10 rounded-md border border-[var(--s-border)]"
                  style={{ background: c.hex }}
                />
                <div className="text-[11px] font-medium text-[var(--s-text)]">{c.label}</div>
                <div className="text-[10px] font-mono text-[var(--s-text-tertiary)]">{c.hex}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Tipografía ──────────────────────────────────────────────────── */}
        <section id="tipografía">
          <h2 className="text-lg font-semibold mb-4">Tipografía</h2>
          <div className="flex flex-col gap-3 p-6 border border-[var(--s-border)] rounded-lg">
            {[
              { label: "24/700 — título grande", size: 24, weight: 700 },
              { label: "18/600 — título de sección", size: 18, weight: 600 },
              { label: "15/500 — contenido de formulario", size: 15, weight: 500 },
              { label: "13/400 — cuerpo estándar", size: 13, weight: 400 },
              { label: "12/400 — metadatos", size: 12, weight: 400, color: "var(--s-text-tertiary)" },
            ].map((t) => (
              <p key={t.label} style={{ fontSize: t.size, fontWeight: t.weight, color: t.color ?? "var(--s-text)" }}>
                {t.label}
              </p>
            ))}
          </div>
        </section>

        {/* ── Superficies ─────────────────────────────────────────────────── */}
        <section id="superficies">
          <h2 className="text-lg font-semibold mb-4">Superficies</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Card</p>
              <Card>
                <CardHeader><CardTitle>Título</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-[var(--s-text-secondary)]">Contenido.</p></CardContent>
              </Card>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Surface alt</p>
              <div className="rounded-lg border border-[var(--s-border)] bg-[var(--s-surface-alt)] p-4">
                <p className="text-sm text-[var(--s-text-secondary)]">Paneles secundarios, filas alternas.</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)] mb-2">Surface hover</p>
              <div className="rounded-lg border border-[var(--s-border)] bg-[var(--s-surface-hover)] p-4">
                <p className="text-sm text-[var(--s-text-secondary)]">Estado hover de filas y listas.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Botones ─────────────────────────────────────────────────────── */}
        <section id="botones">
          <h2 className="text-lg font-semibold mb-4">Botones</h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 items-center">
              <Button variant="default">Guardar</Button>
              <Button variant="secondary">Cancelar</Button>
              <Button variant="outline"><Icon icon={Plus} size={14} />Agregar</Button>
              <Button variant="destructive"><Icon icon={Trash2} size={14} />Eliminar</Button>
              <Button variant="ghost"><Icon icon={Settings} size={14} />Configurar</Button>
              <Button variant="link">Ver más</Button>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <Button size="sm">Pequeño</Button>
              <Button size="default">Mediano</Button>
              <Button size="lg">Grande</Button>
              <Button size="icon" variant="outline"><Icon icon={Search} size={16} /></Button>
              <Button disabled>Deshabilitado</Button>
            </div>
          </div>
        </section>

        {/* ── Inputs ──────────────────────────────────────────────────────── */}
        <section id="inputs">
          <h2 className="text-lg font-semibold mb-4">Inputs</h2>
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-4">
              <Input placeholder="Input estándar..." />
              <Input placeholder="Deshabilitado" disabled />
              <FloatingLabelInput id="sg-name" label="Nombre del producto" placeholder="Ej: Alimento perro adulto" />
            </div>
            <div className="flex flex-col gap-4">
              <FloatingLabelInput id="sg-slug" label="Slug" placeholder="alimento-perro-adulto" className="font-mono text-xs" />
              <div className="flex items-center gap-3">
                <Switch id="sg-sw" />
                <label htmlFor="sg-sw" className="text-sm text-[var(--s-text)]">Switch</label>
              </div>
            </div>
          </div>
        </section>

        {/* ── Combobox ────────────────────────────────────────────────────── */}
        <section id="combobox">
          <h2 className="text-lg font-semibold mb-1">Combobox</h2>
          <p className="text-[13px] text-[var(--s-text-secondary)] mb-6">
            El componente combobox es el estándar de Scout para cualquier selección desde una lista
            respaldada por la base de datos. Soporta búsqueda mientras escribés y exploración con
            clic — no es necesario decidir entre un select y un typeahead.
          </p>

          <div className="grid grid-cols-2 gap-8">
            {/* 1. Single-select simple */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)]">
                1 · Single-select simple
              </p>
              <Combobox
                options={DATA_TYPE_OPTIONS}
                value={dataType}
                onChange={(v) => setDataType(v as string)}
                placeholder="Tipo de dato..."
                searchPlaceholder="Buscar tipo..."
              />
              <p className="text-[11px] text-[var(--s-text-tertiary)]">
                Para enums de DB o listas cortas. Click abre todo; tipear filtra.
              </p>
            </div>

            {/* 2. Single-select con descripción y glifo */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)]">
                2 · Con descripción y glifo (picker de atributos)
              </p>
              <Combobox
                options={ATTRIBUTE_OPTIONS}
                value={attribute}
                onChange={(v) => setAttribute(v as number)}
                placeholder="Seleccionar atributo..."
                searchPlaceholder="Buscar atributo..."
              />
              <p className="text-[11px] text-[var(--s-text-tertiary)]">
                La segunda línea muestra metadatos del tipo y uso. Ideal para atributos, marcas.
              </p>
            </div>

            {/* 3. Multi-select */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)]">
                3 · Multi-select (etiquetas comerciales)
              </p>
              <Combobox
                options={TAG_OPTIONS}
                value={tags}
                onChange={(v) => setTags(v as (string | number)[])}
                multiple
                placeholder="Seleccionar etiquetas..."
                searchPlaceholder="Buscar etiqueta..."
              />
              <p className="text-[11px] text-[var(--s-text-tertiary)]">
                El dropdown permanece abierto entre selecciones. Chips muestran las selecciones.
              </p>
            </div>

            {/* 4. Con affordance de crear nuevo */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--s-text-tertiary)]">
                4 · Con &ldquo;Crear nuevo&rdquo; (categoría con fuga a creación)
              </p>
              <Combobox
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={(v) => setCategory(v as number)}
                placeholder="Seleccionar categoría..."
                searchPlaceholder="Buscar categoría..."
                onCreateNew={(query) => {
                  alert(`Crear nueva categoría: "${query}"`);
                }}
                createNewLabel="+ Crear categoría nueva"
              />
              <p className="text-[11px] text-[var(--s-text-tertiary)]">
                Cuando el usuario escribe algo sin coincidencias, la opción de crear se resalta.
              </p>
            </div>
          </div>
        </section>

        {/* ── Iconos ──────────────────────────────────────────────────────── */}
        <section id="iconos">
          <h2 className="text-lg font-semibold mb-4">Iconos</h2>
          <div className="flex flex-col gap-4 p-6 border border-[var(--s-border)] rounded-lg">
            <p className="text-[11px] text-[var(--s-text-tertiary)]">
              Siempre usar <code className="font-mono">&lt;Icon&gt;</code> — nunca Lucide directo sin size + strokeWidth.
            </p>
            <div className="flex items-end gap-6">
              {[12, 14, 16, 20, 24].map((sz) => (
                <div key={sz} className="flex flex-col items-center gap-2">
                  <Icon icon={ChevronRight} size={sz} />
                  <code className="text-[9px] text-[var(--s-text-tertiary)]">{sz}px</code>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-2">
              {[Search, Plus, Trash2, Settings, AlertTriangle, Info, CheckCircle, XCircle].map((Ic) => (
                <Icon key={Ic.displayName} icon={Ic} size={16} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Estados ─────────────────────────────────────────────────────── */}
        <section id="estados">
          <h2 className="text-lg font-semibold mb-4">Estados</h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 py-10 rounded-lg border border-dashed border-[var(--s-border)]">
              <Icon icon={Search} size={24} />
              <p className="text-sm font-medium">No hay resultados</p>
              <p className="text-[13px] text-[var(--s-text-secondary)]">Intentá con otros filtros.</p>
              <Button variant="outline" size="sm"><Icon icon={Plus} size={14} />Crear</Button>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-md text-sm" style={{ background: "var(--s-danger-bg)", color: "var(--s-danger-text)" }}>
              <Icon icon={XCircle} size={16} />
              No se pudo guardar. Verificá los campos e intentá de nuevo.
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-md text-sm" style={{ background: "var(--s-success-bg)", color: "var(--s-success-text)" }}>
              <Icon icon={CheckCircle} size={16} />
              Cambios guardados correctamente.
            </div>
          </div>
        </section>

        {/* ── Patrones de notas ───────────────────────────────────────────── */}
        <section id="patrones-de-notas">
          <h2 className="text-lg font-semibold mb-4">Patrones de notas</h2>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 px-4 py-3 rounded-md text-sm" style={{ background: "var(--scout-accent-50)", color: "var(--scout-accent-800)" }}>
              <Icon icon={Info} size={16} />
              <div>
                <span className="font-medium">Nota informativa</span>
                <span className="ml-1">— esta categoría hereda los atributos de &ldquo;Alimentos&rdquo; y agrega &ldquo;Sabor&rdquo; como eje de variante propio.</span>
              </div>
            </div>
            <div className="flex items-start gap-3 px-4 py-3 rounded-md text-sm" style={{ background: "#FEF9EC", color: "#7A5204" }}>
              <Icon icon={AlertTriangle} size={16} />
              <div>
                <span className="font-medium">Advertencia</span>
                <span className="ml-1">— sin atributos propios. Agregá atributos específicos si corresponde.</span>
              </div>
            </div>
            <div className="rounded-md border border-[var(--scout-accent-100)] bg-[var(--scout-accent-50)] px-4 py-3 text-sm text-[var(--scout-accent-800)]">
              <span className="font-medium">Nota del agente</span>
              <span className="ml-1">— Detecté que este producto tiene 3 variantes de peso sin eje de variante configurado. ¿Querés que configure &ldquo;Peso&rdquo; como eje?</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
