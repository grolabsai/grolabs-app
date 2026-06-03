---
application: core-app
module: Data Model
title: "Data model — Catalog"
status: Draft
scope: "The catalog tables: product, product_variant, attributes and their options/values, categories, and the link tables that join them."
audience: "Engineers who need the table-level shape of the catalog domain — how products, variants, categories, and attributes relate."
---

# Data model — Catalog

The [[Catalog]] tables and their relationships. A [[Product]] belongs to a
`product_type` and a `brand`, links to [[Category|categories]], and has
[[Product variant|variants]], media, and pricing. An [[Attribute]] is defined
once and linked from a category through `category_product_attribute` (which
carries the `is_variant_axis` flag); a variant selects one
`product_attribute_option` per [[Variant axis]].

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative, not column-exact. Translation tables are omitted
> for legibility.

```mermaid
erDiagram
  product_type ||--o{ product : classifies
  brand ||--o{ product : brands
  product ||--o{ product_variant : has
  product ||--o{ product_media : has
  product ||--o{ product_pricing : has
  product ||--o{ product_category_link : in
  category ||--o{ product_category_link : groups
  category ||--o{ category_product_attribute : links
  product_attribute ||--o{ category_product_attribute : linked_by
  product_attribute ||--o{ product_attribute_option : defines
  product_attribute ||--o{ product_attribute_value : has
  product_variant ||--o{ product_variant_attribute : has
  product_attribute_option ||--o{ product_variant_attribute : selected_by
```
