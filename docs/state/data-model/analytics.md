---
application: core-app
module: Data Model
title: "Data model — Analytics (GA4)"
status: Draft
scope: "The GA4 daily rollup tables (ga4_session_daily, ga4_traffic_daily, ga4_page_daily, ga4_geo_daily, ga4_device_daily) and ga4_alert."
audience: "Engineers who need the table-level shape of the GA4 analytics domain — instance-scoped daily rollups plus alerts."
---

# Data model — Analytics (GA4)

The [[GA4]] analytics tables. Each daily rollup is scoped to an [[Instance]] with
a PK of `instance_id` + `date` + its dimensions; `ga4_alert` tracks an alert
lifecycle (`firing → acknowledged → cleared`). There are no FKs between the
rollup tables — they all hang off the instance. The OAuth refresh token lives in
[[Supabase Vault]].

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative, not column-exact.

```mermaid
erDiagram
  instance ||--o{ ga4_session_daily : "daily rollup"
  instance ||--o{ ga4_traffic_daily : "daily rollup"
  instance ||--o{ ga4_page_daily : "daily rollup"
  instance ||--o{ ga4_geo_daily : "daily rollup"
  instance ||--o{ ga4_device_daily : "daily rollup"
  instance ||--o{ ga4_alert : alerts
```
