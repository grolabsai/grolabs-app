# Bulk-intake test fixtures & paths

Datasets + a runner to exercise the staged intake pipeline end-to-end. Three
paths cover the real spectrum: clean objects, a clean multi-table dump, and
genuinely messy "whatever" data.

## Setup

```bash
export GROLABS_WRITE_KEY="glw_live_…"   # per-instance write key (sandbox instance 99999)
# optional: BASE=http://localhost:3000/api/v1   (default: https://app.grolabs.ai/api/v1)
./run.sh objects   # or: dump | flat
```

The runner opens a session, uploads the part(s), completes it, then prints
**overview → preview → interpret**. (`validate` is payload-level, shown per path
below.)

The stages exercised: **import → overview (totals) → preview (stitch) →
validate (dry-run) → interpret (AI categories)**. Everything is non-destructive;
nothing is promoted to the live catalog.

---

## Path 1 — Structured whole objects (`objects`)

`structured-objects.json` — 5 products already in canonical shape (id, title,
brand, categories, price, nested variants + attributes incl. `quantity`). This is
the SDK / clean-integrator case.

**Expected:**
- **overview** — 5 products, 5 variants; brand: Nike 2 / Adidas 2 / Puma 1; near-100% field coverage.
- **preview** — passes straight through; variants stay nested; `unlinked: []`.
- **validate** — `ok: true` (every record has a valid `id`).
- **interpret** — high-confidence categories (Footwear / Apparel).

## Path 2 — Structured multi-table dump (`dump`)

`structured-dump-products.json` + `…-variants.json` + `…-categories.json`, with a
`data_dictionary` set at session open (`products.key=product_id`,
`variants.links_to=product_id`). The custom-dev-with-clean-tables case.

**Expected:**
- **overview** — 3 products; brand + category distributions from the product rows.
- **preview** — variants join under their product by `product_id` (the link field is stripped from the nested variant); the standalone **categories** part shows up under `unlinked` (a category *catalog* isn't a mechanical join — that's interpretation's job, P5).
- **interpret** — categories inferred from product names.

## Path 3 — Unstructured messy flat file (`flat`) — the important one

`unstructured-flat.json` — one row per variant, parent info repeated, **Spanish
field names** (`Nombre`, `Marca`, `Categoria`, `Talla`, `Precio`), **inconsistent
brand casing** (`nike` / `Nike` / `NIKE`, `adidas` / `ADIDAS`), category as a path
string, weight embedded in the name (`"… 200g"`), a **missing-id row** (Gorra
Azul has no `sku`), and a **comma-decimal price** (`"89,90"`).

**Expected — and this is the point:**
- **overview WORKS** (it's field-name-agnostic): it surfaces the mess — `Marca`
  shows ~5–6 *distinct* values because of casing (revealing the dedup need),
  `Categoria` shows the path strings, `Talla` shows S/M/L/42/43, and field
  coverage shows `sku` < 100% (the Gorra row).
- **validate FLAGS every row** `missing_or_invalid_id` — because the id is under
  `sku`, not the canonical `id`.
- **preview** treats each row as its own product with `id` undefined, and does
  **not** group the three "Camiseta Roja" rows — no variant grouping yet.
- **interpret** returns "no products with id+name" — because the name is under
  `Nombre`, not `title`.

**What Path 3 proves:** the field-name-agnostic stage (overview) is enough to
*reconcile* any data, but the canonical-field stages need a **field-mapping step
(Stage 3)** — map `sku→id`, `Nombre→title`, `Marca→brand` — plus **brand
dedup (Stage 5)** and **variant grouping** before messy data flows through. That
is exactly the next process to build, and Path 3 is its acceptance test.

---

## validate (payload-level, any path)

```bash
curl -s -X POST "$BASE/catalog/validate" \
  -H "Authorization: Bearer $GROLABS_WRITE_KEY" -H "Content-Type: application/json" \
  -d '{"instance_id":99999,"documents":[
    {"id":"OK","attributes":[{"code":"weight","quantity":{"value":500,"unit":"g"}}]},
    {"title":"no id"},
    {"id":"BADQTY","attributes":[{"code":"weight","quantity":{"value":500}}]}
  ]}' | python3 -m json.tool
# → valid:1, invalid:2 (missing_or_invalid_id; attribute_0_invalid_quantity)
```
