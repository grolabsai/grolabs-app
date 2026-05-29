import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface BrandSystem {
  instance_id: number;
  display_name: string;
  tagline: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  primary_color: string;
  background_color: string;
  text_color: string;
  muted_color: string;
  accent_color: string;
  heading_font: string;
  body_font: string;
  illustration_style: "realistic" | "conceptual" | "isometric" | "flat" | "line";
  voice_guide: string;
}

/**
 * Load the brand_system row for a given instance. Falls back to
 * instance 0 (GroLabs template) when the instance has no row.
 * Service-role read because this gets called from anon-facing public
 * surfaces (reading page, OG image, sitemap) — `brand_system` is
 * world-readable per RLS, but using service role avoids a JWT round
 * trip and keeps the helper callable from any server context.
 */
export async function getBrandSystem(
  instanceId: number | null,
): Promise<BrandSystem> {
  const supabase = createServiceRoleClient();
  const ids = instanceId === null || instanceId === 0 ? [0] : [instanceId, 0];
  const { data } = await supabase
    .from("brand_system")
    .select("*")
    .in("instance_id", ids)
    .order("instance_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) {
    // Defensive — seed migration ensures instance 0 always has a row.
    return {
      instance_id: 0,
      display_name: "",
      tagline: null,
      logo_url: null,
      logo_dark_url: null,
      primary_color: "#9C5530",
      background_color: "#F4F1EA",
      text_color: "#1A1612",
      muted_color: "#5C5247",
      accent_color: "#9C5530",
      heading_font: 'Georgia, "Times New Roman", serif',
      body_font: "system-ui, -apple-system, sans-serif",
      illustration_style: "realistic",
      voice_guide: "",
    };
  }
  return data as BrandSystem;
}

/**
 * Render a `<style>` block scoping the brand colors + fonts to a
 * wrapper class. Inject once at the top of any themed page; the
 * inner content references the CSS custom properties.
 */
export function brandCssBlock(brand: BrandSystem, scopeClass = "blog-themed"): string {
  return `.${scopeClass}{
  --blog-primary:${brand.primary_color};
  --blog-bg:${brand.background_color};
  --blog-text:${brand.text_color};
  --blog-muted:${brand.muted_color};
  --blog-accent:${brand.accent_color};
  --blog-heading-font:${brand.heading_font};
  --blog-body-font:${brand.body_font};
  background:${brand.background_color};
  color:${brand.text_color};
  font-family:${brand.body_font};
}
.${scopeClass} h1,
.${scopeClass} h2,
.${scopeClass} h3,
.${scopeClass} h4{font-family:${brand.heading_font};color:${brand.text_color};}
.${scopeClass} a{color:${brand.primary_color};}
.${scopeClass} .prose{color:${brand.text_color};}
.${scopeClass} .prose h1,
.${scopeClass} .prose h2,
.${scopeClass} .prose h3,
.${scopeClass} .prose h4{color:${brand.text_color};font-family:${brand.heading_font};}
.${scopeClass} .prose a{color:${brand.primary_color};}
.${scopeClass} .prose strong{color:${brand.text_color};}
.${scopeClass} .prose blockquote{border-color:${brand.accent_color};color:${brand.muted_color};}
.${scopeClass} time,
.${scopeClass} .text-muted-foreground{color:${brand.muted_color};}
`;
}
