-- Add a logo_url column to prospect so we can show a visual badge in
-- the list + detail views. Populated by sample-discovery on the next
-- scan: it parses the homepage for Organization JSON-LD logo,
-- apple-touch-icon, the highest-resolution <link rel="icon">,
-- og:image, or falls back to Google's s2 favicon service.
alter table public.prospect
  add column if not exists logo_url text;
