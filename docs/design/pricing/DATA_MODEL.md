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

# Pricing Module Data Model

## Core Entities

### Provider
Legal entity that supplies products. The distributor/importer you purchase from.

**Fields:**
- `id` (UUID)
- `name` (string) — e.g. "Distribuidora Pet Supplies S.A."
- `contact_info` (json) — phone, email, address
- `payment_terms` (string)
- `created_at`, `updated_at`

**Relationships:**
- Has many `PriceLists`
- Has many `Brands` (through `ProviderBrands`)
- Has many `MAPRules` (provider-specific rules)

---

### Brand
Product manufacturer/trademark.

**Fields:**
- `id` (UUID)
- `name` (string) — e.g. "Royal Canin", "Hill's"
- `created_at`, `updated_at`

**Relationships:**
- Has many `Products`
- Has many `Providers` (through `ProviderBrands`)
- Has many `MAPRules` (manufacturer-mandated rules)

---

### ProviderBrands (join table)
Links providers to the brands they distribute.

**Fields:**
- `provider_id` (FK)
- `brand_id` (FK)
- `active` (boolean) — whether this provider currently supplies this brand
- `created_at`

**Notes:**
- One provider can supply multiple brands
- One brand can be sold by multiple providers
- A provider may stop carrying a brand (set `active = false`)

---

### PriceList
A cost sheet imported from a provider for specific brands.

**Fields:**
- `id` (UUID)
- `provider_id` (FK) — who sent this list
- `import_date` (timestamp) — when it was imported
- `effective_date` (date) — when prices take effect (optional, may differ from import_date)
- `file_name` (string) — original upload filename
- `imported_by_user_id` (FK)
- `created_at`

**Relationships:**
- Belongs to `Provider`
- Has many `PriceListItems`

**Notes:**
- One price list can contain products from multiple brands (if the provider distributes multiple brands)
- The `PriceListItems` link to `Products` which have `brand_id`, so we can filter by brand within a list

---

### PriceListItem
A single cost entry from a price list.

**Fields:**
- `id` (UUID)
- `price_list_id` (FK)
- `variant_id` (FK) — links to master product variant catalog
- `cost` (decimal) — cost per unit in local currency (GTQ)
- `sku` (string) — provider's SKU (may differ from your internal SKU)
- `created_at`

**Relationships:**
- Belongs to `PriceList`
- Belongs to `ProductVariant`

**Notes:**
- The "current cost" for a variant is the most recent `PriceListItem` for that variant from any active provider
- When multiple providers supply the same variant, you choose which cost to use (typically lowest, or preferred provider)

---

### ProductVariant
Sellable product variant (SKU). Each variant is a specific size/flavor/configuration.

**Fields:**
- `id` (UUID)
- `name` (string)
- `brand_id` (FK)
- `category_id` (FK)
- `sku` (string) — your internal SKU
- `variant_attributes` (json) — size, flavor, etc.
- `active` (boolean)
- `created_at`, `updated_at`

**Relationships:**
- Belongs to `Brand`
- Belongs to `Category`
- Has many `PriceListItems` (historical costs from various providers)
- Has one `CurrentPrice` (active selling price in WooCommerce)

**Note:**
The entity is named `ProductVariant` to clarify that each row represents a specific SKU (e.g. "Royal Canin Adult 15kg"), not a generic product family. In the UI and business logic, we refer to these as "products" but the data model uses "variant" to be explicit.

---

### MAPRule
Minimum Advertised Price or maximum price rule.

**Fields:**
- `id` (UUID)
- `rule_type` (enum) — 'MAP_min', 'max_price', 'custom'
- `source_type` (enum) — 'brand', 'provider'
- `source_id` (UUID) — FK to Brand or Provider (polymorphic)
- `variant_id` (FK) — optional, null means rule applies to all variants from this source
- `min_price` (decimal, nullable)
- `max_price` (decimal, nullable)
- `active` (boolean)
- `effective_date` (date)
- `expires_at` (date, nullable)
- `notes` (text)
- `created_at`, `updated_at`

**Relationships:**
- Polymorphic to `Brand` OR `Provider` (via `source_type` + `source_id`)
- Optionally belongs to `ProductVariant` (if variant-specific)

**Examples:**
1. **Brand-level MAP:** Royal Canin mandates all Prescription Diet variants must be sold above Q650 → `source_type='brand'`, `source_id=<royal_canin_id>`, `variant_id=null`, `min_price=650`
2. **Provider-specific rule:** Distribuidora XYZ negotiates a max price on Hill's c/d 8kg → `source_type='provider'`, `source_id=<distributor_xyz_id>`, `variant_id=<hills_cd_8kg_id>`, `max_price=700`

**Notes:**
- Loosely coupled: rules can come from brands OR providers
- Product-specific OR applies to all products from that source
- Multiple rules can apply to one variant (we check all; most restrictive wins)

---

### PriceBatch
A "change batch" — the worksheet where users prep price updates.

**Fields:**
- `id` (UUID)
- `name` (string) — e.g. "Cambios de 8 mayo 2026"
- `status` (enum) — 'draft', 'ready', 'synced'
- `created_by_user_id` (FK)
- `created_at`, `updated_at`
- `synced_at` (timestamp, nullable)

**Relationships:**
- Has many `PriceBatchItems`

---

### PriceBatchItem
A single product variant price change within a batch.

**Fields:**
- `id` (UUID)
- `price_batch_id` (FK)
- `variant_id` (FK)
- `current_cost` (decimal)
- `new_cost` (decimal) — from the latest price list import
- `current_price` (decimal)
- `charm_price` (decimal) — auto-calculated psychological price
- `final_price` (decimal) — actual price to use (charm_price unless manually overridden)
- `manual_override` (boolean) — true if user typed into final_price column
- `margin_percent` (decimal, computed)
- `status` (enum) — 'neutral', 'warning', 'critical'
- `status_reasons` (json) — array of violation reasons, e.g. ["below_map", "low_margin", "price_change_exceeds_5%"]
- `created_at`, `updated_at`

**Relationships:**
- Belongs to `PriceBatch`
- Belongs to `ProductVariant`

**Computed fields (application logic):**
- `margin_percent = (final_price - new_cost) / final_price * 100`
- `status` = determined by checking: margin vs category min, MAP rules, max price change %, etc.

---

## Key Queries

**Get current cost for a variant:**
```sql
SELECT pli.cost, pl.provider_id, pl.import_date
FROM price_list_items pli
JOIN price_lists pl ON pli.price_list_id = pl.id
WHERE pli.variant_id = ?
ORDER BY pl.import_date DESC
LIMIT 1
```

**Get all active MAP/max rules for a variant:**
```sql
SELECT mr.*
FROM map_rules mr
WHERE mr.active = true
  AND (mr.variant_id = ? OR mr.variant_id IS NULL)
  AND (
    (mr.source_type = 'brand' AND mr.source_id = (SELECT brand_id FROM product_variants WHERE id = ?))
    OR
    (mr.source_type = 'provider' AND mr.source_id IN (
      SELECT DISTINCT pl.provider_id
      FROM price_lists pl
      JOIN price_list_items pli ON pl.id = pli.price_list_id
      WHERE pli.variant_id = ?
    ))
  )
  AND (mr.expires_at IS NULL OR mr.expires_at > NOW())
```

**Violation check logic (application layer):**
For each `PriceBatchItem`:
1. Fetch all active MAP rules for that variant
2. Check `final_price` against each rule's `min_price` / `max_price`
3. Check margin against category min/target
4. Check price change % against global max change policy
5. Populate `status_reasons` array and set `status` accordingly

---

## Notes

- **One provider, multiple brands:** Common. E.g. "Distribuidora Pet Supplies S.A." supplies both Royal Canin and Eukanuba.
- **One brand, multiple providers:** Less common but happens. E.g. "Royal Canin" is sold by both "Distribuidora Pet Supplies S.A." and "Importadora Global Pet".
- **Price list belongs to:** Provider + import date. The items within link to variants (which have brands), so you can show "this price list has Royal Canin and Eukanuba variants."
- **MAP rules are loosely coupled:** They can originate from the brand manufacturer OR from a specific provider's contract. We check both when validating prices.
- **Cost source in worksheet:** Display as "Brand (Provider)" e.g. "Royal Canin (Distribuidora Pet Supplies S.A.)" so users know exactly where the cost came from.
