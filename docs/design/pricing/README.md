> **⚠️ SUPERSEDED**
>
> This document is preserved for historical reference only. Its framing (pricing as a WordPress plugin with its own MySQL tables) directly contradicts ratified Constitution Articles 1, 2, and 9.
>
> Current authoritative sources:
> - **Architecture**: docs/module-map.md §5 (Pricing module, GroLabs-native)
> - **Scope discussion**: docs/backlog.md → "Pricing parity with WooCommerce"
>
> The domain thinking captured below remains useful as input for the pricing-parity Discussion. Do not implement anything described here without first reconciling with the authoritative sources above.
>
> ---

# Handoff: Pricing Module for WooCommerce

## Overview
This is a comprehensive pricing management module for a pet supplies e-commerce business using WooCommerce. The module allows users to import cost price lists from multiple providers, apply intelligent pricing policies (charm pricing, margin targets, MAP rules), detect violations, and sync final prices to WooCommerce.

## About the Design Files
The files in this bundle are **design references created in HTML** — high-fidelity prototypes showing the intended look, behavior, and data structures. These are **not production code to copy directly**. Your task is to **recreate these designs as a WordPress/WooCommerce plugin** using PHP, React (for the admin UI), and the WooCommerce/WordPress APIs. The HTML files serve as a pixel-perfect reference for what the final UI should look like and how it should behave.

## Fidelity
**High-fidelity (hifi)**: These are pixel-perfect mockups with final colors, typography, spacing, interactions, and data structures. Recreate the UI precisely using the design tokens provided below. The data model (see ERD.html and DATA_MODEL.md) should be implemented exactly as specified.

## Architecture
This should be built as a **WordPress plugin** that extends WooCommerce:
- **Backend**: PHP with custom database tables (see data model)
- **Admin UI**: React SPA embedded in WordPress admin area (similar to WooCommerce Analytics)
- **Integration**: Sync final prices to WooCommerce product variants via WP REST API
- **File handling**: PHP handles CSV/Excel import; React handles UI
- **Agent panel**: Prepare infrastructure for LLM-based observations (Phase 1: passive only)

## Data Model

### Database Tables
See `ERD.html` for visual diagram and `DATA_MODEL.md` for complete schema. Key tables:

1. **`wp_pricing_providers`** — Provider legal entities
2. **`wp_pricing_brands`** — Product brands (manufacturers)
3. **`wp_pricing_provider_brands`** — Many-to-many join table
4. **`wp_pricing_categories`** — Product categories with margin targets
5. **`wp_pricing_product_variants`** — Master catalog of sellable SKUs
6. **`wp_pricing_price_lists`** — Imported cost sheets from providers
7. **`wp_pricing_price_list_items`** — Individual cost entries
8. **`wp_pricing_map_rules`** — Polymorphic pricing rules (brand or provider source)
9. **`wp_pricing_batches`** — Price change worksheets
10. **`wp_pricing_batch_items`** — Individual variant pricing calculations

### Critical Implementation Notes
- **ProductVariant = WooCommerce product variation** (map via SKU)
- **MAPRule is polymorphic**: `source_type` enum ('brand'|'provider') + `source_id` UUID
- **Violation detection runs server-side** when batch items are created/updated
- **Status field** on batch items is computed, not manual: 'ok' | 'warning' | 'critical'

## Screens / Views

### 1. Overview (Dashboard)
**File**: `Overview.html`  
**Route**: `/wp-admin/admin.php?page=pricing-module`

**Purpose**: High-level dashboard showing import history, active batches, and violation summaries.

**Layout**:
- Full-width container with max-width 1600px, centered
- Header: Title + "Importar lista" button (top-right)
- Grid: 3 stat cards across (equal width, gap 16px)
- Table: Recent imports list below stats

**Components**:

**Stat Cards** (3 across):
- Background: `#FFFFFF`
- Border: `1px solid rgba(0,0,0,0.08)`
- Border-radius: `8px`
- Padding: `20px`
- Each card has:
  - Label (14px, #5F5E5A, 500 weight, margin-bottom 4px)
  - Value (32px, #1A1A1A, 600 weight, margin-bottom 8px)
  - Subtext (13px, #888780)

**Import History Table**:
- Columns: Proveedor, Archivo, Fecha, Productos, Estado
- Row height: 48px
- Header: 13px uppercase, #888780, 500 weight, letter-spacing 0.5px
- Cells: 14px, #1A1A1A, padding 12px 16px
- Hover: background `rgba(0,0,0,0.02)`
- Status pills: same as worksheet

### 2. Providers
**File**: `Providers.html`  
**Route**: `/wp-admin/admin.php?page=pricing-module&tab=providers`

**Purpose**: Manage provider entities and view which brands they distribute.

**Layout**:
- Header with search bar (400px wide) and "Agregar proveedor" button
- Grid: 3 cards across, auto rows, gap 20px

**Provider Cards**:
- Background: `#FFFFFF`
- Border: `1px solid rgba(0,0,0,0.08)`
- Border-radius: `10px`
- Padding: `24px`
- Hover: `box-shadow: 0 4px 12px rgba(0,0,0,0.08)`, `border-color: rgba(55,138,221,0.3)`

**Card Structure**:
- Provider name: 18px, #1A1A1A, 600 weight
- Contact info: 13px, #888780, margin-top 4px
- Payment terms chip: background #F5F5F4, padding 4px 10px, border-radius 4px, 12px text
- Brands section: "Marcas representadas" label (12px uppercase, #888780, margin-top 16px)
- Brand pills: background #E6F1FB, color #0C447C, padding 4px 10px, border-radius 12px, 12px, gap 6px wrap

### 3. Policies
**File**: `Policies.html`  
**Route**: `/wp-admin/admin.php?page=pricing-module&tab=policies`

**Purpose**: Configure charm pricing rules, margin targets by category, and global max price change %.

**Layout**:
- Three sections stacked vertically, gap 24px
- Each section: white card, border-radius 10px, padding 24px

**Section 1: Charm Pricing Rules**:
- Title: 18px, #1A1A1A, 600 weight
- Toggle switch: enabled by default
- Table of charm price ranges:
  - Columns: Desde, Hasta, Precio encanto
  - Input fields: border `1px solid rgba(0,0,0,0.12)`, border-radius 6px, padding 8px 12px, font-size 14px
  - Focus: border-color #378ADD, box-shadow `0 0 0 3px rgba(55,138,221,0.1)`
  - Rows have "Delete" icon button on right (trash icon, hover shows red)

**Section 2: Márgenes por Categoría**:
- Table with columns: Categoría, Margen objetivo, Margen mínimo
- Each row has category name + two input fields (percentage)
- Visual: Target margin input has green accent, min margin has orange accent

**Section 3: Cambio Máximo de Precio**:
- Toggle + percentage input
- Description text: "Detectar cambios de precio superiores a X% como advertencia"
- Default: 5%

### 4. Price Changes Worksheet
**File**: `Price Changes Worksheet.html`  
**Route**: `/wp-admin/admin.php?page=pricing-module&batch=<uuid>`

**Purpose**: Main workspace for reviewing/editing price calculations and resolving violations.

**Layout**:
- Header bar: Editable batch name, status pill, action buttons row
- Filter bar: Category/Brand/Provider/Status chips + "Solo cambios" toggle
- Violation banners (warning + critical) when applicable
- Main table with product rows
- Right sidebar: Agent panel (300px wide, sticky)

**Header**:
- Batch name: 24px, editable inline (click to edit, enter to save)
- Status pills:
  - `borrador`: background #F5F5F4, color #5F5E5A
  - `listo`: background #ECFDF5, color #15803D
  - `sincronizado`: background #E6F1FB, color #0C447C
- Action buttons: "Marcar como listo" (primary blue), "Sincronizar con WooCommerce" (only if listo)

**Violation Banners**:
- **Warning**: background #FFF7ED, border-left 4px solid #F59E0B, padding 16px 20px
- **Critical**: background #FEF2F2, border-left 4px solid #DC2626, padding 16px 20px
- Icon + count + description + quick action button

**Table Structure**:
- Sticky header
- Columns: [Checkbox] Producto, Costo, Precio actual, Precio gancho, Precio final, Margen final, Estado, [Actions]
- Row height: auto (min 56px)
- Border-bottom: `1px solid rgba(0,0,0,0.06)`
- Hover: background `rgba(0,0,0,0.02)`

**Producto Column**:
- Product name: 14px, #1A1A1A, 500 weight
- Brand + Provider: 12px, #888780, margin-top 2px

**Costo Column**:
- Current → New with delta percentage
- Format: "Q1,250 → Q1,380 (+10.4%)"
- Delta: green if decrease, red if increase, inline with smaller font

**Precio gancho Column**:
- Shows calculated charm price
- If manually overridden: strikethrough + lock icon
- Editable on click

**Precio final Column**:
- Bold, 15px
- Editable on click
- Lock icon if manually set

**Margen final Column**:
- Chip with percentage
- Colors:
  - Green (#ECFDF5, #15803D) if ≥ target
  - Yellow (#FFF7ED, #F59E0B) if ≥ min but < target
  - Red (#FEF2F2, #DC2626) if < min

**Estado Column**:
- Pills:
  - `ok`: background #ECFDF5, color #15803D
  - `warning`: background #FFF7ED, color #F59E0B, border-left 3px solid #F59E0B
  - `critical`: background #FEF2F2, color #DC2626, border-left 3px solid #DC2626

**Bulk Actions Toolbar** (appears when rows selected):
- Fixed bottom bar, background white, box-shadow `0 -2px 12px rgba(0,0,0,0.08)`
- Height 64px, padding 0 24px
- Shows: "X productos seleccionados" + action buttons (Aprobar, Marcar como crítico, Eliminar)

**Agent Panel** (right sidebar):
- Width: 300px
- Background: #FAFAF9
- Border-left: 1px solid rgba(0,0,0,0.08)
- Padding: 20px
- Title: "Observaciones del Agente" (14px, 600 weight)
- Cards: stacked, gap 12px
  - Background white, border-radius 6px, padding 12px
  - Icon + title (13px, 600 weight)
  - Description (12px, #5F5E5A, line-height 1.5)
  - Types: `info` (blue), `warning` (orange), `suggestion` (purple)

### 5. Violations
**File**: `Violations.html`  
**Route**: `/wp-admin/admin.php?page=pricing-module&tab=violations`

**Purpose**: Centralized view of all pricing violations across batches, with quick resolution actions.

**Layout**:
- Header: Title + filters (Tipo, Gravedad, Estado)
- Tabbed view: "MAP Rules" | "Margin Violations" | "Price Change Limits"
- Each tab shows table of violations with batch context

**Violation Row**:
- Columns: Producto, Lote, Tipo de violación, Valor actual, Límite, Acción
- Severity indicator: colored left border (orange/red)
- Inline quick actions: "Ajustar precio" | "Aplicar excepción" | "Ver en lote"

### 6. Sync
**File**: `Sync.html`  
**Route**: `/wp-admin/admin.php?page=pricing-module&tab=sync`

**Purpose**: Review sync history and trigger manual syncs to WooCommerce.

**Layout**:
- Header with "Sincronizar ahora" button
- Sync log table: Date, Batch, Products updated, Status, Duration
- Expandable rows showing per-product sync results

## Interactions & Behavior

### Import Wizard Flow
**Trigger**: "Importar lista" button on Overview or Worksheet header

**Steps**:
1. **Upload**: Drag-drop or file picker for CSV/Excel
2. **Map Columns**: Auto-detect or manual mapping (SKU, Cost, Product Name columns)
3. **Select Provider**: Dropdown of existing providers or "Create new"
4. **Set Effective Date**: Date picker (defaults to today)
5. **Review**: Show preview of first 10 rows
6. **Import**: Progress bar → creates PriceList + PriceListItems → redirects to new batch

**Modal**: 600px wide, centered, box-shadow `0 20px 60px rgba(0,0,0,0.15)`

### Inline Editing
- Click product name → editable input, save on Enter/blur
- Click charm price → input field, recalculates margin/status on change
- Click final price → input field, marks as manual override (lock icon appears)
- Batch name in header → inline edit mode with subtle outline

### Violation Detection (Server-side)
When a `PriceBatchItem` is created or updated:
1. Fetch new cost from latest `PriceListItem`
2. Calculate charm price from policies
3. Apply manual overrides if present
4. Query applicable MAP rules (brand + provider)
5. Check final price against rules, margin targets, max change %
6. Populate `status_reasons` JSON array
7. Set `status` enum based on most severe violation

### Status Transitions
**Batch states**:
- `borrador` → `listo`: User clicks "Marcar como listo" (validates all items are ok/warning)
- `listo` → `sincronizado`: User clicks "Sincronizar" → triggers WooCommerce API update
- `sincronizado` → immutable (can't edit)

**Item states**:
- Auto-computed on every price change
- Can be manually overridden by user (adds flag)

### Filtering & Search
- **Worksheet filters**: Client-side filter on category_id, brand_id, provider_id, status
- **"Solo cambios" toggle**: Hides rows where `current_cost === new_cost`
- **Provider search**: Filters provider cards by name (instant, case-insensitive)

### Bulk Selection
- Checkbox column in table
- "Select all" in header (respects current filters)
- Toolbar appears at bottom when ≥1 selected
- Actions apply to all selected rows, batch update server-side

## State Management

### React State
```javascript
// Worksheet screen
{
  batch: {id, name, status, created_at, created_by},
  items: [{id, variant, current_cost, new_cost, charm_price, final_price, margin, status, status_reasons, manual_override}],
  filters: {category: null, brand: null, provider: null, status: null, showOnlyChanges: false},
  selectedIds: Set<uuid>,
  agentObservations: [{type, title, description, severity}]
}

// Overview
{
  stats: {total_imports, active_batches, pending_violations},
  recent_imports: [{id, provider, file_name, date, product_count, status}]
}

// Providers
{
  providers: [{id, name, contact_info, payment_terms, brands: []}],
  searchQuery: string
}

// Policies
{
  charm_rules: [{min, max, charm_price}],
  category_margins: [{category_id, target, min}],
  max_change_enabled: boolean,
  max_change_percent: number
}
```

### API Endpoints (WordPress REST API)
```
GET    /wp-json/pricing/v1/batches
POST   /wp-json/pricing/v1/batches
GET    /wp-json/pricing/v1/batches/:id
PATCH  /wp-json/pricing/v1/batches/:id
DELETE /wp-json/pricing/v1/batches/:id

GET    /wp-json/pricing/v1/batches/:id/items
PATCH  /wp-json/pricing/v1/batch-items/:id

POST   /wp-json/pricing/v1/price-lists (import)
GET    /wp-json/pricing/v1/providers
POST   /wp-json/pricing/v1/providers
PATCH  /wp-json/pricing/v1/providers/:id

GET    /wp-json/pricing/v1/policies/charm
PUT    /wp-json/pricing/v1/policies/charm
GET    /wp-json/pricing/v1/policies/margins
PUT    /wp-json/pricing/v1/policies/margins
GET    /wp-json/pricing/v1/policies/max-change
PUT    /wp-json/pricing/v1/policies/max-change

POST   /wp-json/pricing/v1/batches/:id/sync (to WooCommerce)
GET    /wp-json/pricing/v1/sync/history
```

## Design Tokens

### Colors
```css
/* Primary */
--primary-blue: #378ADD;
--primary-blue-light: #E6F1FB;
--primary-blue-dark: #0C447C;

/* Neutrals */
--neutral-50: #FAFAF9;
--neutral-100: #F5F5F4;
--neutral-200: #E7E6E3;
--neutral-300: #D4D3CF;
--neutral-400: #A8A69F;
--neutral-500: #888780;
--neutral-600: #5F5E5A;
--neutral-700: #3C3B37;
--neutral-800: #29261B;
--neutral-900: #1A1A1A;

/* Status */
--status-success-bg: #ECFDF5;
--status-success-text: #15803D;
--status-success-border: #22C55E;

--status-warning-bg: #FFF7ED;
--status-warning-text: #F59E0B;
--status-warning-border: #F59E0B;

--status-critical-bg: #FEF2F2;
--status-critical-text: #DC2626;
--status-critical-border: #DC2626;

--status-info-bg: #E6F1FB;
--status-info-text: #0C447C;
--status-info-border: #378ADD;

/* Borders */
--border-light: rgba(0,0,0,0.06);
--border-medium: rgba(0,0,0,0.08);
--border-dark: rgba(0,0,0,0.12);
```

### Typography
```css
--font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;

/* Sizes */
--text-xs: 11px;
--text-sm: 12px;
--text-base: 13px;
--text-md: 14px;
--text-lg: 15px;
--text-xl: 18px;
--text-2xl: 24px;
--text-3xl: 32px;

/* Weights */
--weight-normal: 400;
--weight-medium: 500;
--weight-semibold: 600;
--weight-bold: 700;

/* Line heights */
--leading-tight: 1.25;
--leading-normal: 1.5;
--leading-relaxed: 1.6;
```

### Spacing
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
```

### Border Radius
```css
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-xl: 10px;
--radius-2xl: 12px;
--radius-full: 9999px;
```

### Shadows
```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 12px rgba(0,0,0,0.08);
--shadow-lg: 0 10px 30px rgba(0,0,0,0.12);
--shadow-xl: 0 20px 60px rgba(0,0,0,0.15);
```

## Assets
- **Icons**: Using Heroicons (https://heroicons.com/) in the HTML prototypes
  - Implement via `@wordpress/icons` package or inline SVG
  - All icons are 20×20px, stroke-width 2
- **Logo**: No custom logo in this module; uses WordPress admin branding
- **Empty states**: Placeholder illustrations are simple SVG graphics (included inline)

## Files
This handoff package includes:

```
design_handoff_pricing_module/
├── README.md (this file)
├── ERD.html (interactive entity relationship diagram)
├── DATA_MODEL.md (complete database schema + sample queries)
├── Overview.html (dashboard prototype)
├── Providers.html (provider management prototype)
├── Policies.html (policy configuration prototype)
├── Price Changes Worksheet.html (main worksheet prototype)
├── Violations.html (violations view prototype)
└── Sync.html (sync history prototype)
```

## Implementation Checklist

### Phase 1: Database & Models
- [ ] Create custom database tables (use `dbDelta` for schema)
- [ ] Create PHP model classes for each entity
- [ ] Implement polymorphic MAP rule queries
- [ ] Add indexes on foreign keys and frequently queried fields

### Phase 2: REST API
- [ ] Register custom REST API endpoints
- [ ] Implement authentication/authorization (WordPress capabilities)
- [ ] Add validation and error handling
- [ ] Write unit tests for critical endpoints (batch calculations, sync)

### Phase 3: Admin UI
- [ ] Set up React app in plugin admin area
- [ ] Implement routing (React Router)
- [ ] Build reusable components (Table, StatusPill, Modal, etc.)
- [ ] Connect to REST API (use `@wordpress/api-fetch`)
- [ ] Add loading states and error handling

### Phase 4: Import & Sync
- [ ] Build CSV/Excel parser (PHP backend)
- [ ] Implement column mapping logic
- [ ] Create WooCommerce sync function (update product variation prices)
- [ ] Add sync error recovery and logging

### Phase 5: Agent Infrastructure (Future)
- [ ] Design agent observation data structure
- [ ] Add webhook endpoint for LLM to post observations
- [ ] Implement real-time updates (WebSocket or polling)
- [ ] Build agent interaction UI (Phase 2)

## Notes for Developer

1. **WordPress Standards**: Follow WordPress coding standards (WPCS) and use `wp_` table prefix
2. **Security**: Use nonces, sanitize inputs, escape outputs, check capabilities
3. **Localization**: All user-facing strings should be wrapped in `__()` or `_e()` for i18n
4. **Performance**: Batch item calculations can be expensive; consider background processing (WP-Cron) for large imports
5. **Testing**: Write unit tests for violation detection logic (most critical business logic)
6. **Accessibility**: Follow WCAG 2.1 AA standards; table must be keyboard-navigable
7. **Responsive**: Admin UI should work on tablets (min-width 768px); mobile not required
8. **Browser Support**: Modern browsers only (Chrome/Firefox/Safari/Edge last 2 versions)

## Questions?
If any design details are ambiguous, refer to the HTML prototypes for visual reference. The DATA_MODEL.md file has complete SQL schemas and sample queries for the database layer.
