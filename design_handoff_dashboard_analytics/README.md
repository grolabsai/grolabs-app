# Dashboard Analytics - Implementation Guide for Claude Code

## Overview

Implement the **Dashboard Analytics** feature for Scout - a multi-tab analytics dashboard showing search metrics, traffic data, GA4 configuration, and searches without results management.

## What You're Implementing

**5 interconnected pages:**
1. **Dashboard Landing** - Main KPI overview with tabs (Resumen, Otros indicadores)
2. **Traffic Detail** - Deep dive into traffic metrics with charts
3. **Traffic Empty State** - Motivational empty state when GA4 not connected
4. **GA4 Configuration** - Before/after connection states for Google Analytics 4
5. **Chart Library Comparison** - Internal reference (already complete)

## Reference Files

All design files are in `dashboard-analytics/` folder:
- `Dashboard Landing.html` - Main dashboard (READ THIS FIRST - contains all working code)
- `Traffic Detail.html` - Traffic deep-dive page
- `Traffic Empty State.html` - GA4 empty state
- `GA4 Configuration.html` - GA4 setup screens
- `Chart Library Comparison.html` - Reference only

**DO NOT copy the HTML code.** These are design prototypes. Recreate using Scout's Next.js patterns, TypeScript, and shadcn/ui components.

## Key Features to Implement

### 1. Dashboard Landing (`/dashboard` or `/analytics`)

**Tab 1: Resumen (Summary)**

Display at the top:
- **Alerts section** (white card with red left-border)
  - Shows active threshold alerts
  - Example: "Sesiones cayeron 23% vs promedio 7 días"
  - Badge with count of active alerts

Then show 6 KPI cards organized in 2 sections:

**Búsqueda (Search Metrics):**
1. **Búsquedas sin resultados** (Searches without results)
   - Value: 23
   - Trend: ↓ 12% (GREEN when going down - this is good!)
   - Mini line chart (SVG sparkline)
   - Threshold: ±15% día a día
   - Badge showing "1" alert if threshold crossed

2. **Conversión desde búsqueda** (Conversion from search)
   - Value: 8.4%
   - Trend: ↑ 3%
   - Mini line chart
   - Threshold: ±2pp día a día

3. **Posición promedio de clicks** (Average click position)
   - Value: 2.8
   - Trend: ↓ 0.3
   - Mini line chart
   - Threshold: ±0.5 día a día

**Tráfico (Traffic Metrics):**
4. **Sesiones** (Sessions)
   - Value: 1,247
   - Trend: ↓ 23% (RED - below threshold)
   - Mini line chart (red line when alert active)
   - Threshold: ±20% día a día
   - Badge showing "1" alert

5. **Tasa de engagement** (Engagement rate)
   - Value: 42.3%
   - Trend: ↑ 5%
   - Mini line chart
   - Threshold: ±5pp día a día

6. **Usuarios** (Users)
   - Value: 892
   - Trend: ↑ 8%
   - **Special breakdown:**
     - Visual bar showing 60% nuevos / 40% recurrentes
     - "534 (60%)" nuevos
     - "358 (40%)" recurrentes
   - Threshold: ±15% día a día

**Additional components:**
- **"Activos ahora" widget** (Live users widget)
  - Shows current active users: "12 activos ahora"
  - Mini sparkline of last 10 minutes
  - Updates every 30 seconds
  - Link to Traffic Detail page

- **Fuentes de Tráfico** (Traffic Sources)
  - Horizontal stacked bar chart with 4 segments:
    - Búsqueda orgánica: 42% (blue #378ADD)
    - Directo: 28% (green #1D9E75)
    - Redes sociales: 18% (orange #D97706)
    - Referidos: 12% (gray #888780)
  - Legend below with counts
  - "Ver detalle" link to Traffic Detail

**Tab 2: Otros indicadores (Other Indicators)**

1. **Searches without results** (top of page)
   - White card with title "Searches without results"
   - Subtitle explaining purpose
   - Time range dropdown (7 days, 30 days, 90 days)
   - Table with columns:
     - Search (term searched)
     - Count (number of searches)
     - With filter (empty for now)
     - Action (button "Add synonym")
   - Sample data:
     - "baño razas ban" - 1 search
     - "aceite" - 1 search
     - "ase" - 1 search
     - "12459839" - 1 search
     - "proplan ou" - 1 search

2. **Top páginas de entrada** (Top entry pages)
   - White card, table format
   - Columns: Página, Entradas, % del total
   - Sample data showing top 5 entry pages

3. **Top páginas de salida** (Top exit pages)
   - White card, table format
   - Columns: Página, Salidas, % del total
   - Sample data showing top 5 exit pages

**Common elements:**
- Time range selector (Hoy, Ayer, 7 días, 30 días) in header
- Tab navigation (Resumen, Otros indicadores)
- All cards are white (#FCFCFC) with 0.5px border (#E8E7E3)
- Clean, no gray backgrounds inside white cards
- Table headers: light gray text (#888780), thin bottom border only

### 2. Traffic Detail (`/analytics/traffic`)

Deep dive page with:
- Back link to Dashboard
- Time range selector
- **Session chart** (line chart, 7-14 day comparison)
- **Traffic sources breakdown** (same as dashboard widget but larger)
- **Top entry pages table** (full version with more rows)
- **Top exit pages table** (full version with more rows)
- **Bounce rate by page table**

### 3. Traffic Empty State (`/analytics/traffic` when GA4 not configured)

Show when no GA4 connection exists:
- Illustration (use placeholder SVG)
- Headline: "Conectá Google Analytics para ver tráfico"
- Subheadline explaining benefits
- CTA button: "Configurar Google Analytics 4"
- Links to dashboard and GA4 config

### 4. GA4 Configuration (`/settings/integrations/ga4`)

**Two states:**

**Before connection:**
- Title: "Conectar Google Analytics 4"
- Instructions for setup
- Input field: "Measurement ID" (e.g., G-XXXXXXXXXX)
- "Test Connection" button
- "Save & Connect" button
- Help text and documentation links

**After connection (success):**
- Green checkmark
- "Google Analytics 4 conectado"
- Shows connected Measurement ID
- Last sync timestamp
- "Desconectar" button
- Sync status log

## Technical Implementation

### Database Schema

Create these tables:

```typescript
// Analytics configuration
create table analytics_configs (
  id serial primary key,
  tenant_id integer not null references tenants(id),
  ga4_measurement_id varchar(20),
  ga4_connected_at timestamp,
  ga4_last_sync_at timestamp,
  is_active boolean default true,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

// Searches without results (from Algolia)
create table searches_without_results (
  id serial primary key,
  tenant_id integer not null references tenants(id),
  search_term varchar(255) not null,
  search_count integer default 1,
  with_filter boolean default false,
  first_seen_at timestamp default now(),
  last_seen_at timestamp default now(),
  created_at timestamp default now()
);

// Synonym mappings (for Algolia)
create table search_synonyms (
  id serial primary key,
  tenant_id integer not null references tenants(id),
  source_term varchar(255) not null,
  target_term varchar(255) not null,
  created_by integer references users(id),
  created_at timestamp default now()
);

// Analytics alert thresholds
create table analytics_thresholds (
  id serial primary key,
  tenant_id integer not null references tenants(id),
  metric_name varchar(100) not null, // e.g., 'sesiones', 'busquedas_sin_resultados'
  threshold_type varchar(20) not null, // 'percentage' or 'absolute'
  threshold_value decimal(10,2) not null,
  comparison_period varchar(20) default 'day_over_day', // or '7_day_avg'
  is_active boolean default true,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

// Alert history
create table analytics_alerts (
  id serial primary key,
  tenant_id integer not null references tenants(id),
  threshold_id integer references analytics_thresholds(id),
  metric_name varchar(100) not null,
  current_value decimal(10,2),
  previous_value decimal(10,2),
  variance_percentage decimal(5,2),
  alert_level varchar(20) default 'warning', // 'critical' or 'warning'
  triggered_at timestamp default now(),
  resolved_at timestamp,
  is_active boolean default true
);
```

### API Endpoints to Create

```typescript
// GA4 Integration
POST /api/integrations/ga4/test-connection
  - Accepts: { measurementId: string }
  - Tests connection to GA4
  - Returns: { connected: boolean, error?: string }

POST /api/integrations/ga4/save
  - Accepts: { measurementId: string }
  - Saves GA4 configuration
  - Returns: { success: boolean, config: AnalyticsConfig }

DELETE /api/integrations/ga4
  - Disconnects GA4
  - Returns: { success: boolean }

GET /api/integrations/ga4/sync
  - Triggers manual sync from GA4
  - Returns: { success: boolean, syncedAt: timestamp }

// Dashboard Data
GET /api/analytics/dashboard
  - Query params: timeRange ('hoy', 'ayer', '7d', '30d')
  - Returns all KPI data for dashboard cards
  - Calculates trends, thresholds, active alerts

GET /api/analytics/traffic-sources
  - Query params: timeRange
  - Returns traffic source breakdown

GET /api/analytics/top-pages
  - Query params: type ('entry' | 'exit'), timeRange
  - Returns top pages data

GET /api/analytics/sessions-chart
  - Query params: timeRange
  - Returns time-series data for session chart

// Searches without results
GET /api/analytics/searches-without-results
  - Query params: timeRange ('7d', '30d', '90d')
  - Returns list of searches with no results from Algolia

POST /api/analytics/add-synonym
  - Accepts: { sourceTerm: string, targetTerm: string }
  - Creates synonym in Algolia
  - Saves to database
  - Returns: { success: boolean }

// Alert thresholds
GET /api/analytics/thresholds
  - Returns all threshold configurations

PUT /api/analytics/thresholds/:id
  - Updates threshold value
  - Accepts: { thresholdValue: number }
  - Returns: { success: boolean }

GET /api/analytics/alerts
  - Returns active alerts

POST /api/analytics/alerts/:id/resolve
  - Marks alert as resolved
  - Returns: { success: boolean }
```

### Integration Points

**Google Analytics 4:**
- Use GA4 Data API v1 to fetch metrics
- Metrics needed:
  - Sessions (ga:sessions)
  - Users (ga:users, ga:newUsers, ga:returningUsers)
  - Engagement rate (ga:engagementRate)
  - Top pages (ga:pagePath, ga:entrances, ga:exits, ga:bounceRate)
  - Traffic sources (ga:source, ga:medium)
- Store credentials securely (encrypted)
- Sync on schedule (hourly/daily) or manual trigger

**Algolia Analytics:**
- Use Algolia Insights API to fetch:
  - Searches without results
  - Search count per term
  - Searches with filters applied
- Use Algolia Rules API to:
  - Create synonyms when user clicks "Add synonym"
  - Manage search rules
- Authentication via Algolia Admin API Key (encrypted)

### Frontend Components to Build

Using shadcn/ui + Recharts for charts:

```
src/
  app/
    (dashboard)/
      analytics/
        page.tsx              # Dashboard Landing
        traffic/
          page.tsx            # Traffic Detail
        settings/
          ga4/
            page.tsx          # GA4 Configuration
      components/
        analytics/
          KPICard.tsx         # Reusable KPI card component
          AlertsSection.tsx   # Alerts display
          LiveUsersWidget.tsx # Active users widget
          TrafficSourcesChart.tsx
          SessionsChart.tsx
          TopPagesTable.tsx
          SearchesWithoutResultsTable.tsx
          TimeRangeSelector.tsx
          DashboardTabs.tsx
```

**Chart Library:**
Use **Recharts** (already in Scout dependencies):
- LineChart for sparklines and session trends
- BarChart for traffic sources
- Customize to match design (no gradients, clean lines)

### Key UI/UX Requirements

1. **No gray backgrounds inside white cards**
   - Cards are white (#FCFCFC)
   - Table headers: NO gray background, just light gray text + bottom border

2. **Alert visual treatment**
   - Alerts section: white background, 3px red left border
   - NO gray/colored background fill
   - Badge with count in red

3. **Trend indicators**
   - Green arrow ↑ for positive trends
   - Red arrow ↓ for negative trends
   - **EXCEPTION:** "Búsquedas sin resultados" - GREEN when going DOWN (fewer searches without results is good)

4. **Sparklines (mini charts)**
   - Edge-to-edge in card
   - 2-3px stroke width
   - Match metric color (red for alerts, green for positive, blue for neutral)
   - No axes, no labels - just the line

5. **Thresholds**
   - Show threshold value inline in each KPI card
   - Allow inline editing (click to edit)
   - Save to database on blur

6. **Live updates**
   - "Activos ahora" widget updates every 30 seconds
   - Show subtle animation when updating
   - Persist last known value if fetch fails

7. **Empty states**
   - Show Traffic Empty State when GA4 not connected
   - Guide user to configuration
   - Make CTA prominent

### Data Flow

1. **Initial page load:**
   - Fetch `/api/analytics/dashboard?timeRange=7d`
   - Fetch `/api/analytics/alerts`
   - Fetch `/api/integrations/ga4` (check if connected)
   - If not connected and on traffic page → show empty state

2. **Time range change:**
   - Refetch all dashboard data with new timeRange
   - Update URL params (for sharing/bookmarking)

3. **Tab change:**
   - "Resumen" → show KPIs + alerts + traffic sources
   - "Otros indicadores" → show searches without results + top pages tables

4. **"Add synonym" button click:**
   - Open modal/drawer with form
   - User enters target term (what should this map to?)
   - Call `/api/analytics/add-synonym`
   - Show success toast
   - Refresh searches table

5. **Alert threshold inline edit:**
   - Click threshold value → becomes input
   - User edits
   - On blur → PUT `/api/analytics/thresholds/:id`
   - Recalculate alerts server-side
   - Refresh alerts section

### Styling Notes

Use Scout's existing design system:
- Font: (check Scout's globals.css)
- Colors:
  - Success: #1D9E75
  - Danger: #DC2626
  - Warning: #D97706
  - Primary: #378ADD
  - Text: #29261b
  - Text secondary: #888780
  - Border: #E8E7E3
  - Surface: #FCFCFC
  - Background: #F6F4EF

Match the prototype's spacing, typography, and overall feel - but use Scout's component patterns.

### Error Handling

- GA4 connection fails → show error message, don't crash
- Algolia API fails → show fallback message in searches table
- Network errors → retry with exponential backoff
- Invalid time ranges → fallback to default (7d)

### Testing Checklist

- [ ] All 4 time ranges work correctly
- [ ] Both tabs render properly
- [ ] Alerts show/hide based on threshold crossings
- [ ] Trend indicators show correct direction
- [ ] "Búsquedas sin resultados" trend is inverted (down = green)
- [ ] Traffic sources add up to 100%
- [ ] Tables sort correctly
- [ ] "Add synonym" creates synonym in Algolia
- [ ] Live users widget updates
- [ ] GA4 connection flow works end-to-end
- [ ] Empty state shows when GA4 not connected
- [ ] Threshold inline editing saves correctly
- [ ] Charts render on all screen sizes
- [ ] Page is responsive (mobile, tablet, desktop)

## Implementation Phases

**Phase 1: GA4 Configuration**
- Build settings page
- Test/save connection flow
- Database schema

**Phase 2: Dashboard Landing - Resumen Tab**
- KPI cards (all 6)
- Alerts section
- Time range selector
- Tabs navigation

**Phase 3: Dashboard Landing - Otros Indicadores Tab**
- Searches without results table
- Top pages tables
- "Add synonym" functionality

**Phase 4: Traffic Detail Page**
- Session chart
- Traffic sources (expanded)
- All tables

**Phase 5: Empty States**
- Traffic empty state when GA4 not connected

**Phase 6: Live Features**
- Live users widget with auto-refresh
- Real GA4 data integration
- Algolia searches integration

**Phase 7: Polish**
- Inline threshold editing
- Alert resolution
- Loading states
- Error boundaries

## Questions to Ask Me

Before starting:
1. Where should the analytics routes live? (`/analytics` or `/dashboard/analytics`?)
2. Should GA4 config be at `/settings/integrations/ga4` or elsewhere?
3. Do you have GA4 credentials ready for testing?
4. Do you have Algolia credentials for searches without results?
5. Should I create database migrations or just schema definitions?
6. Any existing analytics/metrics infrastructure I should be aware of?
7. Multi-tenancy: how is tenant isolation handled in Scout?

## Getting Started

1. Open all HTML files in `dashboard-analytics/` folder in browser
2. Explore existing Scout codebase for patterns
3. Read this README thoroughly
4. Ask clarifying questions
5. Start with **Phase 1** (GA4 config) or **Phase 2** (Dashboard cards) based on priority

---

**Ready to implement! Let me know which phase to start with.**
