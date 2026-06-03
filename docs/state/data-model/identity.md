---
application: core-app
module: Data Model
title: "Data model — Identity & tenancy"
status: Draft
scope: "The identity tables the tenancy layer uses: tenant, tenant_member, instance, instance_member."
audience: "Engineers who need the table-level shape of the identity/tenancy domain and how the four identity tables relate."
---

# Data model — Identity & tenancy

The four identity tables and their relationships. A [[Tenant]] owns one or more
[[Instance|instances]] and has its own members; each instance also has members.
The tenancy/[[Row-Level Security|RLS]] boundary column is `instance_id`. A
trigger requires an active `tenant_member` before any `instance_member` insert.

> Table-level only — relationships are derived from `state/schema.md`; FK
> directions are indicative, not column-exact. `auth_users` is Supabase's
> `auth.users`, shown as a referenced table.

```mermaid
erDiagram
  tenant ||--o{ tenant_member : "has members"
  tenant ||--o{ instance : owns
  instance ||--o{ instance_member : "has members"
  tenant_member }o--|| auth_users : "is user"
  instance_member }o--|| auth_users : "is user"
```
