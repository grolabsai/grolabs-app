# Scout

**Catalog management platform for ecommerce.** Scout is a GroLabs product that helps merchants manage their product catalog, enrich it with external data, push it to their ecommerce platform (Medusa / WooCommerce / Shopify), index it into Algolia search, and close the loop with search-performance feedback.

## Status

**Phase 1 in active development.** Foundation work: database schema, multi-tenant infrastructure, first tenant (Wazú pet shop) migration.

## What Scout is (six-layer scope)

1. **Catalog management core** — products, variants, categories, attributes, species, types, pricing, media, services
2. **Enrichment inbound** — fetch data from external sources to fill gaps
3. **Agentic readiness** — prepare catalog for AI agent consumption
4. **Push to ecommerce** — sync to Medusa / WooCommerce / Shopify
5. **Push to Algolia** — index the catalog into search
6. **Read-back loop** — consume search analytics, recommend catalog and search tweaks

Phase 1 scope: layer 1 only, plus architectural foundations to support layers 2-6.

## Architecture at a glance

- **Multi-tenant SaaS** — one deployment serves many customers, each isolated by `tenant_id` with row-level security
- **Copy-on-signup templates** — new tenants start with vertical-specific reference data (pet shop template first, pharmacy/café/hardware later)
- **Multi-language from day one** — translation tables alongside every translatable entity, BCP 47 locale codes (e.g. `es-GT`, `en-US`), primary-locale value in base tables with translations as overlays
- **Database**: Supabase (PostgreSQL 17)
- **Frontend**: TBD — leaning toward Next.js + TypeScript
- **Deployment target**: TBD

## Repository structure

```
scout/
├── supabase/
│   ├── config.toml                    # Supabase CLI configuration
│   ├── migrations/                    # Database migrations, version-controlled
│   │   └── 20260422000001_initial_schema.sql
│   ├── seed.sql                       # Seed data (later)
│   └── functions/                     # Edge functions (later)
├── apps/                              # Application code (coming soon)
├── docs/
│   ├── inventory.md                   # Phase 1 entity × field × screen inventory
│   ├── decisions.md                   # Running decision log
│   └── design-prompt.md               # Claude Design prompt for UI generation
├── .gitignore
├── LICENSE
└── README.md
```

## Getting started

### Prerequisites

- Node.js 20+
- Supabase CLI (`npm i -g supabase` or `brew install supabase/tap/supabase`)
- Docker (for local Supabase)

### Local development setup

```bash
# Clone the repo
git clone https://github.com/grolabsai/scout.git
cd scout

# Link to the Scout Supabase project
supabase login
supabase link --project-ref ixbbhwtpnebrhquunege

# Pull the latest schema from cloud
supabase db pull

# Or start a local Supabase instance
supabase start
```

### Running migrations

```bash
# Apply all migrations to the linked project
supabase db push

# Create a new migration
supabase migration new my_change_name
```

## Key decisions

See [`docs/decisions.md`](./docs/decisions.md) for the full running log. Highlights:

- **Multi-tenant from day one** to avoid a painful rewrite later
- **Templates as SQL seed scripts** committed to the repo
- **Translation tables, not JSONB** — matches Medusa and Shopify API shapes directly
- **Phase 1 UI defers locale switcher** — schema foundation only, tab switcher UI comes later

## Tenancy model

Each customer is a `tenant`. Currently one tenant: Wazú (the first pet shop). Future tenants may include FastCap (hardware retail), plus partner-managed customers via the growth partner program.

Tenants share the Scout infrastructure but their data is fully isolated via `tenant_id` columns and Postgres Row Level Security policies. Enterprise customers who require dedicated infrastructure can later run the same codebase against their own Supabase project — same code, different database.

## License

Proprietary. See [LICENSE](./LICENSE).

## Contact

GroLabs · info@grolabs.ai (or wherever your actual contact is)
