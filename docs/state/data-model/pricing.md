---
application: core-app
module: Data Model
title: "Data model — Pricing"
status: Draft
scope: "The GroLabs-native pricing tables: provider, provider_brand, price_list, price_list_item, map_rule, charm_rule, price_batch, price_batch_item."
audience: "Engineers who need the table-level shape of the pricing domain — providers, price lists, rules, and batches."
---

# Data model — Pricing

The GroLabs-native [[Pricing]] tables and their relationships. A [[Provider]]
supplies brands and price lists; [[Map rule|map rules]] translate provider
columns into `price_list_item` rows. A [[Price batch]] applies changes to a
[[Price list]] and carries its own syncing state, while [[Charm rule|charm
rules]] shape final price endings.

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative, not column-exact. `brand` is a catalog table,
> referenced here by `provider_brand`.

```mermaid
erDiagram
  provider ||--o{ provider_brand : supplies
  brand ||--o{ provider_brand : mapped_by
  provider ||--o{ price_list : provides
  price_list ||--o{ price_list_item : contains
  provider ||--o{ map_rule : configures
  price_list ||--o{ price_batch : updated_by
  price_batch ||--o{ price_batch_item : contains
  price_list_item ||--o{ price_batch_item : targets
  charm_rule }o--|| price_list : shapes
```
