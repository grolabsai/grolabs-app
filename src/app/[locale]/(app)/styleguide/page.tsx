import { Icon } from "@/components/ui/icon";
import { HintIcon } from "@/components/ui/hint-icon";
import {
  ChevronDown,
  Check,
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
  Search,
  Plus,
  Trash2,
  Settings,
  Stethoscope,
  ListChecks,
  Gauge,
  Sparkles,
} from "lucide-react";

export const metadata = { title: "Estilo — GroLabs" };

/**
 * Scout — design system styleguide.
 *
 * Engineered Luxury palette (matches grolabs-landing). Every component
 * is rendered twice: once in the default DARK theme and once inside a
 * `.scout-light` wrapper that flips the tokens to LIGHT. Side-by-side
 * so the design can be assessed without clicking through pages.
 *
 * The .scout-light class overrides all --s-* + shadcn HSL variables.
 * Everything below uses tokens (no hardcoded colors); add a swatch
 * here first, then anywhere else.
 */

const ACCENT: { label: string; token: string; hex: string }[] = [
  { label: "Accent (yellow)", token: "--scout-accent", hex: "#fae194" },
  { label: "Accent hover", token: "--scout-accent-hover", hex: "#fcebab" },
  { label: "Accent 50", token: "--scout-accent-50", hex: "#fff8e0" },
  { label: "Accent 100", token: "--scout-accent-100", hex: "#fdeec4" },
  { label: "Accent 600 (gold)", token: "--scout-accent-600", hex: "#d4af37" },
];

const SURFACES_DARK = [
  { label: "Canvas (bg)", token: "--s-bg", hex: "#131316" },
  { label: "Canvas deeper", token: "--s-bg-deeper", hex: "#0E0E11" },
  { label: "Surface", token: "--s-surface", hex: "#1c1d24" },
  { label: "Surface alt", token: "--s-surface-alt", hex: "#16171c" },
  { label: "Surface hover", token: "--s-surface-hover", hex: "#22232a" },
];
const SURFACES_LIGHT = [
  { label: "Canvas (bg)", token: "--s-bg", hex: "#FAFAF9" },
  { label: "Canvas deeper", token: "--s-bg-deeper", hex: "#F2F2F0" },
  { label: "Surface", token: "--s-surface", hex: "#FFFFFF" },
  { label: "Surface alt", token: "--s-surface-alt", hex: "#F7F7F6" },
  { label: "Surface hover", token: "--s-surface-hover", hex: "#EFEFEE" },
];

const TEXT_DARK = [
  { label: "Text strong", token: "--s-text-strong", hex: "#FFFFFF" },
  { label: "Text (bone)", token: "--s-text", hex: "#EDEAE0" },
  { label: "Text secondary", token: "--s-text-secondary", hex: "rgba(237,234,224,.6)" },
  { label: "Text tertiary", token: "--s-text-tertiary", hex: "rgba(237,234,224,.4)" },
  { label: "Text muted", token: "--s-text-muted", hex: "rgba(237,234,224,.28)" },
];
const TEXT_LIGHT = [
  { label: "Text strong", token: "--s-text-strong", hex: "#000000" },
  { label: "Text", token: "--s-text", hex: "#1A1A1A" },
  { label: "Text secondary", token: "--s-text-secondary", hex: "#5F5E5A" },
  { label: "Text tertiary", token: "--s-text-tertiary", hex: "#888780" },
  { label: "Text muted", token: "--s-text-muted", hex: "#B4B2A9" },
];

const SEMANTIC = [
  { label: "Success", token: "--s-success" },
  { label: "Danger", token: "--s-danger" },
  { label: "Warning", token: "--s-warning" },
];

const RADII = [
  { label: "sm", token: "--s-radius-sm", px: "6px" },
  { label: "md", token: "--s-radius-md", px: "8px" },
  { label: "lg", token: "--s-radius-lg", px: "12px" },
  { label: "xl", token: "--s-radius-xl", px: "16px" },
];

export default function StyleguidePage() {
  return (
    <div className="s-content" style={{ paddingBottom: 80 }}>
      <Header />

      {/* Type — single panel; type ramp is mode-independent */}
      <Section title="Typography">
        <TypeRamp />
      </Section>

      {/* Colors — paired dark / light */}
      <Section title="Accent — Kinetic Yellow">
        <PaletteGrid items={ACCENT} />
      </Section>

      <Pair title="Surfaces">
        <PaletteGrid items={SURFACES_DARK} />
        <PaletteGrid items={SURFACES_LIGHT} />
      </Pair>

      <Pair title="Text">
        <PaletteGrid items={TEXT_DARK} />
        <PaletteGrid items={TEXT_LIGHT} />
      </Pair>

      <Section title="Semantic + Radii">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
          <PaletteGrid items={SEMANTIC.map((s) => ({ ...s, hex: "" }))} />
          <div style={radiiCardStyle}>
            <Label>Radii</Label>
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              {RADII.map((r) => (
                <div key={r.label} style={{ textAlign: "center", flex: 1 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      background: "var(--scout-accent)",
                      borderRadius: `var(${r.token})`,
                      margin: "0 auto 6px",
                    }}
                  />
                  <div style={tokenStyle}>{r.label}</div>
                  <div style={hexStyle}>{r.px}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Components — paired dark / light side-by-side */}
      <Pair title="Buttons">
        <ButtonsDemo />
        <ButtonsDemo />
      </Pair>

      <Pair title="Inputs">
        <InputsDemo />
        <InputsDemo />
      </Pair>

      <Pair title="Selects & dropdowns">
        <SelectsDemo />
        <SelectsDemo />
      </Pair>

      <Pair title="Checkboxes, radios & toggles">
        <ChecksDemo />
        <ChecksDemo />
      </Pair>

      <Pair title="Cards">
        <CardsDemo />
        <CardsDemo />
      </Pair>

      <Pair title="Tables">
        <TableDemo />
        <TableDemo />
      </Pair>

      <Pair title="Badges & chips">
        <BadgesDemo />
        <BadgesDemo />
      </Pair>

      <Pair title="Status banners">
        <BannersDemo />
        <BannersDemo />
      </Pair>

      <Pair title="Nav (active state)">
        <NavDemo />
        <NavDemo />
      </Pair>

      <Pair title="Section heading + eyebrow">
        <HeadingDemo />
        <HeadingDemo />
      </Pair>
    </div>
  );
}

// ─── Section shells ──────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontFamily: "var(--s-font-mono)",
          fontSize: 11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--scout-accent)",
          marginBottom: 8,
        }}
      >
        GroLabs · Engineered Luxury
      </div>
      <h1
        style={{
          fontFamily: "var(--s-font-brand)",
          fontSize: 36,
          color: "var(--s-text-strong)",
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          margin: 0,
        }}
      >
        Scout design system
      </h1>
      <p
        style={{
          color: "var(--s-text-secondary)",
          fontSize: 14,
          margin: "8px 0 0",
          maxWidth: 720,
          lineHeight: 1.6,
        }}
      >
        Every component is shown twice — on the left in the default dark
        Engineered Luxury theme, on the right inside a <code style={codeStyle}>.scout-light</code>{" "}
        wrapper that flips the tokens to light. Anything not yet tokenized
        will look identical in both columns &mdash; that&rsquo;s a bug, not a feature.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <SectionTitle title={title} />
      <div style={sectionBodyStyle}>{children}</div>
    </section>
  );
}

function Pair({ title, children }: { title: string; children: React.ReactNode }) {
  const [dark, light] = Array.isArray(children) ? children : [children, children];
  return (
    <section style={{ marginBottom: 36 }}>
      <SectionTitle title={title} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div style={paneDarkStyle}>
          <PaneLabel>Dark</PaneLabel>
          {dark}
        </div>
        <div className="scout-light" style={paneLightStyle}>
          <PaneLabel light>Light</PaneLabel>
          {light}
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontFamily: "var(--s-font-brand)",
        fontSize: 18,
        color: "var(--s-text-strong)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        margin: "0 0 14px",
      }}
    >
      {title}
    </h2>
  );
}

function PaneLabel({ light, children }: { light?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--s-font-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: light ? "#888" : "var(--scout-accent)",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

const sectionBodyStyle: React.CSSProperties = {
  background: "var(--s-surface)",
  border: "1px solid var(--s-border)",
  borderRadius: "var(--s-radius-lg)",
  padding: 20,
};

const paneDarkStyle: React.CSSProperties = {
  background: "#131316",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--s-radius-lg)",
  padding: 20,
  color: "#EDEAE0",
};

const paneLightStyle: React.CSSProperties = {
  background: "#FAFAF9",
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: "var(--s-radius-lg)",
  padding: 20,
  color: "#1A1A1A",
};

// ─── Pieces ──────────────────────────────────────────────────────────────

function TypeRamp() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <RampRow
        label="Brand mark — Permanent Marker"
        fontFamily="var(--s-font-brand)"
        fontSize={42}
        textTransform="uppercase"
      >
        GroLabs Scout
      </RampRow>
      <RampRow
        label="H1 / Page title — Hanken Grotesk 600"
        fontFamily="var(--s-font)"
        fontSize={28}
        fontWeight={600}
      >
        Page title
      </RampRow>
      <RampRow
        label="H2 / Section heading — Permanent Marker uppercase"
        fontFamily="var(--s-font-brand)"
        fontSize={22}
        textTransform="uppercase"
      >
        Section heading
      </RampRow>
      <RampRow
        label="H3 / Card title — Hanken Grotesk 600"
        fontFamily="var(--s-font)"
        fontSize={16}
        fontWeight={600}
      >
        Card title
      </RampRow>
      <RampRow
        label="Body — Hanken Grotesk 400"
        fontFamily="var(--s-font)"
        fontSize={14}
      >
        A long paragraph of body copy that uses Hanken Grotesk at 14px. It sets
        the rhythm for every administrative screen — readable, calm, no
        ornament.
      </RampRow>
      <RampRow
        label="Eyebrow / label — mono uppercase tracked"
        fontFamily="var(--s-font-mono)"
        fontSize={11}
        textTransform="uppercase"
        letterSpacing="0.18em"
        color="var(--scout-accent)"
      >
        Eyebrow label
      </RampRow>
      <RampRow
        label="Caption — Hanken Grotesk 400 muted"
        fontFamily="var(--s-font)"
        fontSize={12}
        color="var(--s-text-secondary)"
      >
        Caption / helper text
      </RampRow>
    </div>
  );
}

function RampRow({
  label,
  children,
  ...style
}: {
  label: string;
  children: React.ReactNode;
} & React.CSSProperties) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--s-font-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--s-text-tertiary)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color: "var(--s-text)", ...style }}>{children}</div>
    </div>
  );
}

function PaletteGrid({
  items,
}: {
  items: { label: string; token: string; hex: string }[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((s) => (
        <div
          key={s.token}
          style={{
            background: "var(--s-surface)",
            border: "1px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              width: "100%",
              height: 56,
              background: `var(${s.token})`,
              border: "1px solid var(--s-border)",
              borderRadius: "var(--s-radius-sm)",
            }}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--s-text)" }}>
              {s.label}
            </div>
            <div style={tokenStyle}>{s.token}</div>
            {s.hex && <div style={hexStyle}>{s.hex}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ButtonsDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ButtonRow label="Primary">
        <button className="s-btn s-btn-primary">Save</button>
        <button className="s-btn s-btn-primary" disabled>
          Disabled
        </button>
      </ButtonRow>
      <ButtonRow label="Secondary">
        <button className="s-btn">Cancel</button>
        <button className="s-btn" disabled>
          Disabled
        </button>
      </ButtonRow>
      <ButtonRow label="With icon">
        <button className="s-btn s-btn-primary">
          <Icon icon={Plus} size={14} />
          New
        </button>
        <button className="s-btn">
          <Icon icon={Settings} size={14} />
          Settings
        </button>
      </ButtonRow>
      <ButtonRow label="Danger">
        <button
          className="s-btn"
          style={{
            borderColor: "var(--s-danger)",
            color: "var(--s-danger)",
          }}
        >
          <Icon icon={Trash2} size={14} />
          Delete
        </button>
      </ButtonRow>
    </div>
  );
}

function ButtonRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 110, ...labelInlineStyle }}>{label}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function InputsDemo() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="s-field">
        <label className="s-field-label">Required field</label>
        <div className="s-input-wrap">
          <input className="s-input" type="text" placeholder=" " />
          <HintIcon hint="example.com" required />
        </div>
        <div className="s-field-hint">
          Yellow circle = mandatory. Tooltip on hover shows the hint;
          the icon disappears once the field has content.
        </div>
      </div>
      <div className="s-field">
        <label className="s-field-label">Optional field</label>
        <div className="s-input-wrap">
          <input className="s-input" type="text" placeholder=" " />
          <HintIcon hint="A few sentences about your store" />
        </div>
      </div>
      <div className="s-field">
        <label className="s-field-label">Pre-filled (icon hidden)</label>
        <div className="s-input-wrap">
          <input
            className="s-input"
            type="text"
            placeholder=" "
            defaultValue="wazu.com"
          />
          <HintIcon hint="example.com" required />
        </div>
        <div className="s-field-hint">
          The hint icon hides automatically once the input has a value.
        </div>
      </div>
      <div className="s-field">
        <label className="s-field-label">Search</label>
        <div style={{ position: "relative" }}>
          <Icon
            icon={Search}
            size={14}
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              color: "var(--s-text-tertiary)",
              pointerEvents: "none",
            }}
          />
          <input
            className="s-input"
            type="search"
            placeholder=" "
            style={{ paddingLeft: 36 }}
          />
        </div>
      </div>
      <div className="s-field">
        <label className="s-field-label">Number</label>
        <input className="s-input" type="number" defaultValue={1200} placeholder=" " />
      </div>
      <div className="s-field">
        <label className="s-field-label">Textarea</label>
        <textarea
          className="s-textarea"
          rows={3}
          placeholder=" "
          style={{ resize: "vertical", minHeight: 60 }}
        />
      </div>
      <div className="s-field">
        <label className="s-field-label">Disabled</label>
        <input
          className="s-input"
          type="text"
          defaultValue="Read only"
          placeholder=" "
          disabled
        />
      </div>
      <div className="s-field">
        <label className="s-field-label">Invalid</label>
        <input
          className="s-input"
          type="text"
          defaultValue="bad@input"
          placeholder=" "
          style={{ borderColor: "var(--s-danger)" }}
        />
        <div style={{ fontSize: 11, color: "var(--s-danger-text)", marginTop: 6 }}>
          That doesn&rsquo;t look like a valid email.
        </div>
      </div>
    </div>
  );
}

function SelectsDemo() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="s-field">
        <label className="s-field-label">Native select</label>
        <select className="s-select" defaultValue="pet_retail">
          <option value="pet_retail">Pet retail</option>
          <option value="fashion">Fashion</option>
          <option value="electronics">Electronics</option>
          <option value="generic">Generic</option>
        </select>
      </div>
      <div>
        <Label>Custom dropdown (preview)</Label>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "var(--s-surface)",
            border: "1px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            padding: "8px 12px",
            minWidth: 200,
            color: "var(--s-text)",
            fontSize: 14,
            marginTop: 10,
          }}
        >
          <span style={{ flex: 1 }}>Pet retail</span>
          <Icon icon={ChevronDown} size={14} style={{ color: "var(--s-text-tertiary)" }} />
        </div>
        <div
          style={{
            marginTop: 6,
            background: "var(--s-surface)",
            border: "1px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            padding: 6,
            width: 240,
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
          }}
        >
          {["Pet retail", "Fashion", "Electronics", "Generic"].map((o, i) => (
            <div
              key={o}
              style={{
                padding: "8px 10px",
                borderRadius: "var(--s-radius-sm)",
                color: "var(--s-text)",
                fontSize: 13,
                cursor: "pointer",
                background:
                  i === 0 ? "rgba(250,225,148,0.10)" : "transparent",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {i === 0 && (
                <Icon icon={Check} size={12} style={{ color: "var(--scout-accent)" }} />
              )}
              <span style={{ marginLeft: i === 0 ? 0 : 20 }}>{o}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChecksDemo() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Row>
        <Label>Checkbox</Label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--s-text)" }}>
          <input type="checkbox" defaultChecked /> Active
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--s-text)" }}>
          <input type="checkbox" /> Inactive
        </label>
      </Row>
      <Row>
        <Label>Radio</Label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--s-text)" }}>
          <input type="radio" name="r1" defaultChecked /> Option A
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--s-text)" }}>
          <input type="radio" name="r1" /> Option B
        </label>
      </Row>
      <Row>
        <Label>Toggle</Label>
        <button
          type="button"
          style={{
            width: 38,
            height: 22,
            borderRadius: 999,
            background: "var(--scout-accent)",
            position: "relative",
            border: "none",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 3,
              right: 3,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#131316",
            }}
          />
        </button>
      </Row>
    </div>
  );
}

function CardsDemo() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ ...labelInlineStyle, marginBottom: 6 }}>Surface — default</div>
        <div style={{ color: "var(--s-text)", fontSize: 13 }}>
          The default card surface. Most content lives here.
        </div>
      </div>
      <div style={{ ...cardStyle, background: "var(--s-surface-alt)" }}>
        <div style={{ ...labelInlineStyle, marginBottom: 6 }}>Surface alt</div>
        <div style={{ color: "var(--s-text)", fontSize: 13 }}>
          Slightly recessed — used inside cards for table headers and side rails.
        </div>
      </div>
      <div
        style={{
          ...cardStyle,
          background: "rgba(250,225,148,0.06)",
          borderColor: "rgba(250,225,148,0.3)",
        }}
      >
        <div style={{ ...labelInlineStyle, marginBottom: 6, color: "var(--scout-accent)" }}>
          Highlighted
        </div>
        <div style={{ color: "var(--s-text)", fontSize: 13 }}>
          Yellow-tinted card for the headline takeaway (uplift estimates, etc.).
        </div>
      </div>
    </div>
  );
}

function TableDemo() {
  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "1px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--s-surface-alt)" }}>
            <Th>Site</Th>
            <Th>Status</Th>
            <Th>Score</Th>
            <Th>Uplift</Th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderTop: "1px solid var(--s-border)" }}>
            <Td>wazu.com</Td>
            <Td>
              <span style={{ color: "var(--s-success-text)" }}>completed</span>
            </Td>
            <Td mono>72</Td>
            <Td mono>$48,200</Td>
          </tr>
          <tr style={{ borderTop: "1px solid var(--s-border)" }}>
            <Td>acmepets.com</Td>
            <Td>
              <span style={{ color: "var(--s-text-tertiary)" }}>running</span>
            </Td>
            <Td mono>—</Td>
            <Td mono>—</Td>
          </tr>
          <tr style={{ borderTop: "1px solid var(--s-border)" }}>
            <Td>fashionco.com</Td>
            <Td>
              <span style={{ color: "var(--s-danger-text)" }}>failed</span>
            </Td>
            <Td mono>—</Td>
            <Td mono>—</Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BadgesDemo() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <Badge label="Default" />
      <Badge label="Active" tone="success" />
      <Badge label="Pending" tone="warning" />
      <Badge label="Failed" tone="danger" />
      <Badge label="Beta" tone="accent" />
      <Badge label="3" small />
    </div>
  );
}

function Badge({
  label,
  tone,
  small,
}: {
  label: string;
  tone?: "success" | "warning" | "danger" | "accent";
  small?: boolean;
}) {
  const palettes = {
    default: {
      bg: "var(--s-surface-alt)",
      color: "var(--s-text-secondary)",
      border: "var(--s-border)",
    },
    success: {
      bg: "var(--s-success-bg)",
      color: "var(--s-success-text)",
      border: "transparent",
    },
    warning: {
      bg: "var(--s-warning-bg)",
      color: "var(--s-warning-text)",
      border: "transparent",
    },
    danger: {
      bg: "var(--s-danger-bg)",
      color: "var(--s-danger-text)",
      border: "transparent",
    },
    accent: {
      bg: "rgba(250,225,148,0.12)",
      color: "var(--scout-accent)",
      border: "rgba(250,225,148,0.3)",
    },
  };
  const p = palettes[tone ?? "default"];
  return (
    <span
      style={{
        padding: small ? "1px 7px" : "3px 10px",
        background: p.bg,
        color: p.color,
        border: `1px solid ${p.border}`,
        borderRadius: 999,
        fontSize: small ? 10 : 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
        textTransform: small ? "none" : undefined,
        fontFamily: small ? "var(--s-font-mono)" : "var(--s-font)",
      }}
    >
      {label}
    </span>
  );
}

function BannersDemo() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Banner icon={CheckCircle} tone="success" title="Saved" text="Your changes were saved." />
      <Banner
        icon={Info}
        tone="info"
        title="Reminder"
        text="This run is anonymous. Share the URL to let others view the report."
      />
      <Banner
        icon={AlertTriangle}
        tone="warning"
        title="Heads up"
        text="GLPIM is not reachable — PDP findings will be reported as errors."
      />
      <Banner
        icon={XCircle}
        tone="danger"
        title="Failed"
        text="The diagnostic couldn’t fetch the homepage. Check the URL."
      />
    </div>
  );
}

function Banner({
  icon,
  tone,
  title,
  text,
}: {
  icon: typeof Info;
  tone: "success" | "info" | "warning" | "danger";
  title: string;
  text: string;
}) {
  const palettes = {
    success: { bg: "var(--s-success-bg)", color: "var(--s-success-text)" },
    info: { bg: "rgba(250,225,148,0.12)", color: "var(--scout-accent)" },
    warning: { bg: "var(--s-warning-bg)", color: "var(--s-warning-text)" },
    danger: { bg: "var(--s-danger-bg)", color: "var(--s-danger-text)" },
  };
  const p = palettes[tone];
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        background: p.bg,
        borderRadius: "var(--s-radius-md)",
        border: "1px solid var(--s-border)",
      }}
    >
      <Icon icon={icon} size={16} style={{ color: p.color, flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: p.color }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--s-text-secondary)", marginTop: 2 }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function NavDemo() {
  const items: { icon: typeof Stethoscope; label: string; active?: boolean }[] = [
    { icon: Stethoscope, label: "Lista", active: true },
    { icon: ListChecks, label: "Rúbrica" },
    { icon: Gauge, label: "Benchmarks" },
    { icon: Sparkles, label: "Vocabulario" },
  ];
  return (
    <div
      style={{
        background: "var(--nav-surface, #131316)",
        border: "1px solid var(--nav-border, rgba(255,255,255,0.06))",
        borderRadius: "var(--s-radius-md)",
        padding: 12,
        width: 220,
      }}
    >
      <div
        style={{
          fontFamily: "var(--s-font-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(237,234,224,0.4)",
          padding: "0 10px",
          marginBottom: 6,
        }}
      >
        Prospectos
      </div>
      {items.map((it) => (
        <a
          key={it.label}
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            borderRadius: "var(--s-radius-md)",
            background: it.active ? "rgba(250,225,148,0.10)" : "transparent",
            /* Every item reads in the logo-white tone. Active state is
               signaled by the yellow icon + tinted background. */
            color: "#FFFFFF",
            fontWeight: it.active ? 500 : 400,
            fontSize: 13,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          <Icon
            icon={it.icon}
            size={14}
            style={{
              color: it.active ? "var(--scout-accent)" : "#FFFFFF",
            }}
          />
          {it.label}
        </a>
      ))}
    </div>
  );
}

function HeadingDemo() {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--s-font-mono)",
          fontSize: 11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--scout-accent)",
          marginBottom: 8,
        }}
      >
        Conversion Funnel
      </div>
      <h2
        style={{
          fontFamily: "var(--s-font-brand)",
          fontSize: 28,
          color: "var(--s-text-strong)",
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          margin: "0 0 10px",
        }}
      >
        Revenue leaks
      </h2>
      <p style={{ color: "var(--s-text-secondary)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
        Revenue leakage is the gap between the revenue a business has earned and the
        revenue it actually captures, caused by preventable friction.
      </p>
    </div>
  );
}

// ─── Small atoms ─────────────────────────────────────────────────────────

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={labelInlineStyle}>{children}</div>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        textAlign: "left",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: "10px 12px",
        fontSize: 12,
        color: "var(--s-text)",
        fontFamily: mono ? "var(--s-font-mono)" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}

const tokenStyle: React.CSSProperties = {
  fontFamily: "var(--s-font-mono)",
  fontSize: 10,
  color: "var(--s-text-tertiary)",
};

const hexStyle: React.CSSProperties = {
  fontFamily: "var(--s-font-mono)",
  fontSize: 10,
  color: "var(--s-text-muted)",
  marginTop: 2,
};

const labelInlineStyle: React.CSSProperties = {
  fontFamily: "var(--s-font-mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--s-text-tertiary)",
  fontWeight: 600,
};

const codeStyle: React.CSSProperties = {
  background: "rgba(250,225,148,0.12)",
  color: "var(--scout-accent)",
  padding: "1px 6px",
  borderRadius: 4,
  fontFamily: "var(--s-font-mono)",
  fontSize: 12,
};

const cardStyle: React.CSSProperties = {
  background: "var(--s-surface)",
  border: "1px solid var(--s-border)",
  borderRadius: "var(--s-radius-md)",
  padding: 14,
};

const radiiCardStyle: React.CSSProperties = {
  background: "var(--s-surface)",
  border: "1px solid var(--s-border)",
  borderRadius: "var(--s-radius-lg)",
  padding: 14,
};
