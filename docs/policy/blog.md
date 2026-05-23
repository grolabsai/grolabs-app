---
Status: Active policy
Owner: Tuncho
Scope: Multi-tenant blog (write, publish, public reading) for any GroLabs instance — Wazú, GroLabs marketing site, UX-Economics, future tenants.
Audience: Anyone touching `/content/posts`, `/blog`, the `post` table, the `blog-images` bucket, or any future AI-assisted writing or image pipeline.
---

# Blog — policy

A native, multi-tenant blog surface. Writing happens in Scout admin
(`/content/posts`); reading happens on a public URL (`/blog/[slug]`)
served from the same Next.js app. No subscriptions, no paywall, no
monetization in scope. Ghost is the visual + UX reference; nothing about
Ghost's data model or infra is replicated.

This doc covers v1 (shipped), v2/v3 (roadmap), and the AI/brand backlog
(directional, not committed).

---

## 1. Why native, not headless Ghost

Decided in PR #121.

- Multi-tenant: one Scout instance → one blog. Hosting one Ghost per
  tenant is operationally annoying; one Ghost shared across tenants
  requires building a tenant-isolation layer that doesn't exist in Ghost.
- Integration: writing posts will eventually be triggered by the agent
  panel (`AgentPanel`). The agent calls server actions, not a third-party
  HTTP API.
- Cost: $0/mo on infra we already pay for.
- Editor gap: closed ~80% with Tiptap (v2) and ~95% with Tiptap AI
  Toolkit (backlog). The remaining gap is not worth a monthly fee.

If a future requirement breaks this (e.g. needing Ghost's membership +
newsletter system), reopen the decision — don't fork the policy.

---

## 2. Data model

**One table.** Tags, comments, revisions, and authors-as-an-entity are
explicitly out of scope until a feature requires them.

```
post (
  post_id          bigserial PK
  instance_id      → instance(instance_id)   -- RLS perimeter
  author_id        → auth.users(id)
  slug             text
  title            text
  summary          text                       -- doubles as meta description
  content          text                       -- markdown in v1, JSONB in v2
  cover_image_url  text
  status           'draft' | 'published'
  published_at     timestamptz
  created_at, updated_at
)
UNIQUE (instance_id, slug)
```

`(instance_id, slug)` is unique — slugs collide *across* instances are
fine and expected (`wazu.com/blog/hello` and `grolabs.com/blog/hello`
coexist).

**RLS:**

- `post_select_published` — `anon` + `authenticated` can `SELECT` any
  row with `status = 'published'`. This is what makes the public reading
  surface work without auth.
- `post_member_all` — `authenticated` members of `post.instance_id` can
  do everything else (read drafts, write, delete).

**Storage:** `blog-images` bucket, public-read. Writes gated by
`storage.foldername(name)[1]` matching the writer's `instance_id`. Path
convention: `{instance_id}/{cover|inline}/{timestamp}-{filename}`.

---

## 3. Routing

| Surface | Route | Auth |
|---|---|---|
| Admin list | `/content/posts` | inside `(app)` group, gated |
| Admin new | `/content/posts/new` | inside `(app)` group, gated |
| Admin edit | `/content/posts/[id]` | inside `(app)` group, gated |
| Public index | `/blog` | anonymous OK |
| Public read | `/blog/[slug]` | anonymous OK |

Public routes deliberately live *outside* `src/app/[locale]/(app)/` so
the auth gate in `(app)/layout.tsx` doesn't apply.

**Multi-tenant domain routing is v3.** v1 ignores the host header — the
public `/blog` page lists every published post across every instance.
This works because there is exactly one writer right now (Tuncho). When
a second tenant publishes, resolve domain → instance at the edge
(middleware) and filter by `instance_id` before the v2-shipped index
page becomes wrong.

---

## 4. SEO + AEO surface

**Per-post (`/blog/[slug]`):**

- `<title>` — post title
- `<meta name="description">` — `summary` field
- OpenGraph `og:type=article`, `og:image=cover_image_url`, `og:title`,
  `og:description`, `article:published_time`
- Twitter card (`summary_large_image` when cover present)
- JSON-LD `Article` schema (headline, description, image, datePublished)

**Site-level (v3):**

- `/sitemap.xml` — auto-generated from `post WHERE status='published'`
- `/rss.xml` — same source, last 50 posts
- `/llms.txt` at site root — short site description + pointer to the
  RSS feed. AEO surface for LLM crawlers.

The `summary` field is the single piece of copy that powers meta
description, OG description, RSS summary, and (later) LLM context. If
it's blank, downstream surfaces degrade gracefully — but the editor
should nudge the writer to fill it.

---

## 5. Roadmap

### v1 — shipped (PR #121)

- 1-table schema, RLS, Storage bucket
- Admin list + new + edit with markdown textarea, live preview, image
  upload (cover + inline), publish/unpublish, delete
- Public `/blog` + `/blog/[slug]` with `prose` typography + per-post
  metadata + JSON-LD `Article`
- i18n: full `blog.*` namespace (es source of truth, en mirrored)

### v2 — shipped

- **Editor: Tiptap** with headings (H1/H2/H3), bold/italic/strike/code,
  bullet + ordered lists, blockquote, links, inline image upload via
  toolbar. Lazy-loaded via `next/dynamic` on `/content/posts/*` so the
  catalog/pricing bundle is unaffected.
- **Content stored as sanitized HTML.** Schema kept `content` as `text`
  and added `content_format` (`'markdown' | 'html'`) so v1 markdown posts
  keep rendering through `react-markdown` while new posts go through
  `DOMPurify.sanitize()` on the public surface. Edit screen detects the
  format and shows the matching editor.
- **Drafts filter + status pills + tag pills** on `/content/posts` list,
  with tabs for all / draft / scheduled / published.
- **Autosave** every 5s while editing (debounced; only when state is
  dirty). Server returns `saved_at` which the editor surfaces inline.
- **Scheduled publish**: third status `'scheduled'`. `schedulePost(id, iso)`
  server action sets `status='scheduled'` + future `published_at`. A
  **Supabase `pg_cron` job** runs every 5 minutes and calls
  `publish_due_posts()` (SECURITY DEFINER) which flips matured rows to
  `'published'`. Why pg_cron and not Vercel cron: the Vercel Hobby tier
  only allows daily crons; 5-minute granularity needs Pro or pg_cron.
  pg_cron runs inside Postgres at no extra cost. The
  `/api/v1/blog/publish-due` route stays in the codebase as a manual
  trigger / debug surface (gated by `CRON_SECRET`) but is not wired to
  `vercel.json`.
- **Tags**: `tags text[]` column + GIN index. Editor UI in the sidebar;
  `/blog?tag=X` filters the public index; rendered as `#tag` chips on
  post + index pages.

### v3 — shipped

- **Word count + reading time** — live in the editor toolbar (Tiptap
  `CharacterCount` extension), and on the public reading page next to
  the date (220 words/min). Server-side count strips HTML before
  counting.
- **Table of contents** — server-side `extractTocAndAnchor()` walks
  the sanitized HTML for `<h2>`/`<h3>`, assigns `id` attributes, and
  builds a TOC. Rendered when a post has ≥3 H2s. Each heading is
  clickable client-side to copy a deep link.
- **`/sitemap.xml`** — Next.js `MetadataRoute.Sitemap`; host-aware
  (filters by `instance.domain` when the request maps to one). Includes
  the index, every published post, and one entry per distinct tag.
- **`/rss.xml`** — host-aware RSS 2.0 feed, last 50 published posts.
  HTML content sanitized before inlining.
- **`/llms.txt`** — host-aware llms.txt format (per llmstxt.org): site
  title, short description, then bulleted `[title](url): summary` for
  each published post.
- **Multi-tenant domain routing**: `instance.domain` column +
  `instanceIdForHost()` server helper. Every public surface (index,
  post, sitemap, RSS, llms.txt) reads the host header, looks up the
  matching instance, and filters posts accordingly. When no domain
  maps (Scout admin URL, preview), the surface shows every published
  post across instances — the working preview behavior. To bind a
  domain: `UPDATE instance SET domain = 'grolabs.com' WHERE …`.

### Deferred from v3 (worth doing if writing reveals the need)

- **Tiptap slash-command menu** (`/image`, `/quote`, `/divider`, `/embed`).
  The toolbar already covers the same surface; the slash menu is a
  power-user convenience, not a feature gap.
- **Drag-handle to reorder blocks** — Tiptap's official extension is
  Pro. A DIY drag handle (~50 lines using HTML5 drag events on `<p>`
  / `<h2>` blocks) is the cheap version when this is worth doing.

---

## 6. Backlog — AI + brand system (directional, not committed)

The features below extend the writing UX into AI-assisted territory.
They are recorded here so the next person planning the feature doesn't
have to rediscover the direction. **Scope and ordering will be revisited
before any of these are picked up.**

### 6.1 Tiptap AI Toolkit integration

Reference: <https://tiptap.dev/product/ai-toolkit>

Slot-in extension on top of the v2 Tiptap editor:

- Continue writing from cursor
- Rewrite selection (shorter, longer, more formal, more casual, fix
  grammar, translate)
- Summarize selection → auto-fills `summary` field
- Generate title from content
- Inline `/ai` slash command for one-shot prompts

Wiring is a Tiptap extension + a single server action that proxies to
the model. Keys live in `instance.integrations_config.ai` (Vault-backed,
following the §7 integrations pattern in CLAUDE.md). User-facing
terminology: never "API key" — show "AI provider".

### 6.2 Brand system per instance

New table — or a new `brand_system` sub-key under
`instance.integrations_config`:

```
brand_system (per instance)
  primary_color, secondary_color, accent_color  -- hex
  background_color, text_color
  heading_font, body_font                       -- font family + Google Fonts URL
  logo_url, logo_dark_url
  icon_style                                    -- 'outline' | 'duotone' | 'flat'
  illustration_style                            -- 'realistic' | 'conceptual' | 'isometric' | 'flat'
  voice_guide                                   -- free text, fed to AI prompts
```

Two consumers:

1. **Public reading page** — CSS custom properties on the `/blog` route
   for the active instance (`--blog-primary`, `--blog-heading-font`,
   etc.). Each instance's blog inherits its brand without per-post work.
2. **AI image pipeline** (§6.3) — the brand system is appended to every
   image-generation prompt as the visual style spec.

### 6.3 Image pipeline with brand-aware AI transforms

The flow the user described, written down so it doesn't drift:

1. Writer uploads a photo or screenshot (existing v1 upload flow).
2. Before inserting into the post, Scout asks: **what do you want to do
   with this image?**
   - Keep as-is (current v1 behavior)
   - Recolor to brand palette (apply `brand_system` colors to dominant
     tones; people/photos stay realistic, surrounding hues shift)
   - Restyle as illustration / conceptual / isometric / flat (per
     `brand_system.illustration_style`)
   - Generate as SVG with brand colors (for diagrams, icons,
     screenshots-as-flowcharts)
   - "Describe what you want" — freeform prompt, brand spec auto-appended
3. The chosen transform runs server-side, the result is uploaded to
   `blog-images` alongside the original (so the original is preserved
   and the transform is re-runnable), and the post gets the transformed
   URL.

Implementation notes for whoever picks this up:

- **Originals are immutable.** A transform always creates a new file —
  never overwrite the upload. Path: `{instance_id}/transform/{original_id}/{variant}-{timestamp}.{ext}`.
- **Cost gate.** Transforms hit a paid API. Surface estimated cost in
  the confirmation step. Cache identical (image_hash, transform_spec)
  pairs aggressively.
- **The "ask the writer" step is non-skippable** at first. Power users
  will want a default-per-post or default-per-instance setting later;
  don't build that until the explicit prompt has been used enough to
  know what the right defaults are.
- **SVG generation** is qualitatively different from raster transforms —
  it requires a model that outputs structured SVG, not pixel art. Keep
  the two transform pipelines separate behind the same UI.

### 6.4 What's *not* in the backlog

Listed so a future session doesn't add them by accident:

- Comments / discussion threads
- Email newsletter / subscriber list (Ghost has this; we explicitly
  don't)
- Membership tiers, paid posts
- Multi-author byline UI — `author_id` will keep tracking the writer,
  but the public page doesn't surface it until a second author exists
- Translation per-post — i18n is for UI chrome, not post content. If a
  post needs to exist in both Spanish and English, that's two `post`
  rows with different slugs (`hello-world`, `hola-mundo`), not one row
  with two language fields.
