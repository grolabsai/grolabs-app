# Products and Variants — Policy

Last updated: 2026-04-28
Why this exists: This document is the source of truth for how products 
and variants behave in Scout. Code follows this document. When behavior 
needs to change, edit this file first, then reconcile the code.

## Information Architecture

- `/scout/[instance_id]/catalog/products` — product list
- `/scout/[instance_id]/catalog/products/[product_id]` — product edit, 
  with variants shown as master-detail rows
- `/scout/[instance_id]/catalog/products/[product_id]/variants/[variant_id]` 
  — variant edit (own page, not modal)

## Master-detail display

The product edit page shows `product_name` once at the top. Variant rows 
below display only `variant_label` (the differentiator). Full 
`variant_name` is shown on the variant edit page.

## Identity and naming

- `variant_label` (text, on product_variant) — differentiator only. 
  Default at create time = axis values joined by a single space, in the 
  axis order returned by the inheritance walk. Example: axes 
  [Sabor=Pollo, Contenido=15 kg] → `"Pollo 15 kg"`. User-editable.
- `variant_name` (text, on product_variant) — full label. Default at 
  create time = `product_name + " — " + variant_label`. User-editable.
- Concatenation happens **only on the create screen**, as the user picks 
  axis values. Once the variant is saved, both fields are frozen text.
- Editing a saved variant does NOT auto-rebuild either label. If the 
  user changes an axis value on an existing variant, the labels stay as 
  stored. The user is responsible for typing the label they want.
- Em-dash separator (` — `) between product_name and variant_label is 
  fixed. Space is the axis-value separator. No middle dots, no slashes.

## Variant axes (inheritance)

- Axes come from `category_product_attribute.is_variant_axis = true`.
- Resolution: starting from the product's primary category 
  (`product_category_link.is_primary = true`), walk up through 
  `category.parent_category_id` to the root.
- Collect all rows where `is_variant_axis = true`.
- Dedupe by `attribute_id`, keeping the **leaf-first** occurrence (closest 
  to the product wins if both leaf and ancestor declare the same axis).
- Sort by (depth_from_leaf ascending, variant_axis_order ascending).
- This list is **read-only on the product**. No per-product override. If 
  a product needs different axes, that is a category-level decision.
- A product with zero category-derived axes can still have variants, but 
  those variants have no axis values — they rely on `variant_label` alone.

## Variant axis values on save

- For each axis in the inherited list, the variant create form requires 
  the user to pick a value (from `product_attribute_option` for select 
  attributes, or enter text/number for free-form attributes).
- On save, one `product_variant_attribute` row is written per axis.
- The UNIQUE constraint (instance_id, variant_id, attribute_id) is 
  honored — one value per axis per variant.

## SKU

- User-authored free text on the variant. Required on create. Unique per 
  instance is enforced at the form level (DB does not currently enforce).
- The DB function `fn_generate_sku` exists but is NOT wired to the UI in 
  this PR. Future work.

## Pricing on create

- Every variant requires at least one `product_pricing` row to be 
  sellable.
- Variant create form has a required `list_price` field (numeric, GTQ).
- On save, one `product_pricing` row is created with: 
  channel='retail', currency='GTQ', list_price=<entered>, 
  is_active=true, min_quantity=1.
- `cost_price`, `sale_price`, sale windows, and additional channels are 
  out of scope for this PR. They live on the variant edit page as a 
  separate "Pricing" section, editable post-creation.

## Soft delete

- Products and variants are never hard-deleted from the UI.
- Delete action sets `is_active = false`.
- The list view has a filter to show inactive items, defaulting to 
  active-only.
- Schema-level CASCADE behavior is not changed by this PR.

## Image handling (v1)

- Both `product` and `product_variant` have an `image_url` text column.
- The forms accept a URL string only. No upload, no `product_media` 
  integration in this PR.
- Future work: wire to Supabase storage and `product_media` table.

## Validation rules (form-level)

- `product_name`: required, trimmed, non-empty.
- `slug`: required, lowercase, hyphenated, unique per instance.
- `product_type_id`: required.
- Primary category: required, exactly one (`is_primary=true`).
- Variant `sku`: required, unique per instance.
- Variant `list_price`: required, numeric, > 0.
- Each inherited axis: required value on create.

## Out of scope for this PR

- Bulk actions (multi-select on list)
- Image upload (URL strings only)
- Product/variant translations
- Pricing UI beyond the single retail row at create
- Inventory tracking UI
- Product attribute value editing (product-level attributes are 
  display-only on this PR; the unified Atributos accordion from PR #19 
  is referenced read-only)
- The `fn_generate_sku` function
