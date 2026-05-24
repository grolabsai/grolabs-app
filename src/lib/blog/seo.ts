import { headers } from "next/headers";
import type { BrandSystem } from "./brand";

/**
 * SEO + AEO building blocks for the blog surface.
 *
 * Centralizes the per-page concerns that every page renders:
 *   - origin from the request host (multi-tenant, per-instance domain)
 *   - canonical absolute URL
 *   - publisher / author / breadcrumb / blog-root JSON-LD
 *
 * Every helper takes the brand + (where needed) the request origin, so
 * the same logic works on the post page, tag page, blog index, and the
 * preview page.
 */

export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const rawHost = h.get("host") ?? h.get("x-forwarded-host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${rawHost}`;
}

export function canonicalUrl(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

// ──────────────────────────────────────────────────────────────────────
// JSON-LD builders
// ──────────────────────────────────────────────────────────────────────

export interface AuthorInfo {
  name: string;
  email?: string | null;
  url?: string | null;
}

export function publisherSchema(brand: BrandSystem, origin: string) {
  const node: Record<string, unknown> = {
    "@type": "Organization",
    name: brand.display_name || "Blog",
  };
  if (brand.logo_url) {
    node.logo = {
      "@type": "ImageObject",
      url: brand.logo_url.startsWith("http")
        ? brand.logo_url
        : `${origin}${brand.logo_url}`,
    };
  }
  return node;
}

export function authorSchema(
  author: AuthorInfo | null,
  brand: BrandSystem,
  origin: string,
) {
  // Single-author blogs: fall back to the brand identity. When
  // multi-author UI lands, an actual Person row replaces this.
  if (!author || !author.name) {
    return {
      "@type": "Person",
      name: brand.display_name || "Author",
      url: origin,
    };
  }
  const node: Record<string, unknown> = {
    "@type": "Person",
    name: author.name,
  };
  if (author.url) node.url = author.url;
  return node;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function blogRootSchema(brand: BrandSystem, origin: string) {
  const name = brand.display_name || "Blog";
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name,
      url: origin,
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${origin}/blog?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: `${name} — Blog`,
      url: `${origin}/blog`,
      description: brand.tagline ?? undefined,
      publisher: publisherSchema(brand, origin),
    },
  ];
}

/**
 * Inline `<script type="application/ld+json">` content for a list of
 * schema objects. Stringifies + escapes `</script>` so the payload
 * can't end the script tag.
 */
export function jsonLdScriptContent(schemas: unknown[]): string {
  return schemas
    .map((s) => JSON.stringify(s).replace(/<\/script/gi, "<\\/script"))
    .join("\n");
}
