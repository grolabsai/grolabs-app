/**
 * Shared chrome for the three legal pages (privacy / terms / security).
 * Renders a centered max-width column with consistent typography and
 * a small header showing the page title + last-updated date.
 *
 * Server component — pages call <LegalLayout title="…" updated="…">
 * and pass JSX content as children.
 */
import Link from "next/link";

export function LegalLayout({
  title,
  subtitle,
  updated,
  altLink,
  children,
}: {
  title: string;
  subtitle: string;
  updated: string;
  /** Quick link to the other-language version of this page. */
  altLink: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px 96px",
        color: "var(--s-text)",
        fontSize: 14.5,
        lineHeight: 1.7,
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <Link
          href="/"
          style={{
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            textDecoration: "none",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          ← GroLabs
        </Link>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: "12px 0 4px",
            color: "var(--s-text-strong)",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--s-text-secondary)",
            margin: "0 0 8px",
          }}
        >
          {subtitle}
        </p>
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            fontFamily: "var(--s-font-mono)",
          }}
        >
          <span>{updated}</span>
          <Link
            href={altLink.href}
            style={{ color: "var(--s-text-tertiary)" }}
          >
            {altLink.label}
          </Link>
        </div>
      </header>
      <article>{children}</article>
      <footer
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: "0.5px solid var(--s-border)",
          fontSize: 11,
          color: "var(--s-text-tertiary)",
          display: "flex",
          gap: 16,
        }}
      >
        <Link href="/legal/privacy" style={{ color: "var(--s-text-tertiary)" }}>
          Privacy
        </Link>
        <Link href="/legal/terms" style={{ color: "var(--s-text-tertiary)" }}>
          Terms
        </Link>
        <Link href="/legal/security" style={{ color: "var(--s-text-tertiary)" }}>
          Security
        </Link>
      </footer>
    </div>
  );
}

/** Small shared building blocks for consistent section styling. */
export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 17,
        fontWeight: 600,
        color: "var(--s-text-strong)",
        margin: "32px 0 8px",
      }}
    >
      {children}
    </h2>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 12px" }}>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul
      style={{
        margin: "0 0 12px",
        paddingLeft: 22,
        listStyle: "disc",
      }}
    >
      {children}
    </ul>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: "16px 0",
        padding: "12px 14px",
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderLeft: "2px solid var(--rre-accent)",
        borderRadius: "var(--s-radius-md)",
        fontSize: 13,
        color: "var(--s-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}
