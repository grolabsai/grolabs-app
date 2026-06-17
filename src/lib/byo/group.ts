/**
 * Variant grouping (Stage "products" — deterministic, no AI).
 *
 * Collapses rows that are the same base product into one product with variants —
 * e.g. three "Camiseta Roja" rows differing only by `Talla` become one product
 * with a size axis. Runs AFTER field mapping (needs the canonical `title`/`id`).
 *
 * Rules:
 *   - Group by canonical title (case-insensitive); no title → grouped by id; no
 *     id either → its own group.
 *   - Within a group, fields that are CONSTANT (compared case-insensitively)
 *     stay on the base; fields that VARY become per-variant. `id` is always the
 *     variant identifier, never an axis.
 *   - Case-insensitive constant detection also absorbs casing noise (nike / Nike
 *     / NIKE collapse to one base brand) — the representative is the most
 *     frequent original spelling.
 *   - The base id is the variant ids' common prefix (CR-RED-S/M/L → "CR-RED"),
 *     falling back to the existing id.
 */

export type GroupResult = {
  input: number;
  grouped: number;
  products: Record<string, unknown>[];
};

const NESTED = new Set(["variants", "attributes"]);

function norm(v: unknown): string {
  if (typeof v === "string") return v.trim().toLowerCase();
  if (v === null || v === undefined) return "";
  return String(v);
}

function representative(values: unknown[]): unknown {
  const counts = new Map<string, { value: unknown; n: number; first: number }>();
  values.forEach((v, i) => {
    const k = norm(v);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { value: v, n: 1, first: i });
  });
  let best: { value: unknown; n: number; first: number } | null = null;
  for (const e of counts.values()) {
    if (!best || e.n > best.n || (e.n === best.n && e.first < best.first)) best = e;
  }
  return best ? best.value : values[0];
}

function commonPrefix(ids: string[]): string {
  if (ids.length === 0) return "";
  let p = ids[0];
  for (let i = 1; i < ids.length; i++) {
    while (p.length > 0 && !ids[i].startsWith(p)) p = p.slice(0, -1);
    if (p.length === 0) break;
  }
  return p.replace(/[-_/ ]+$/, "");
}

function buildBase(rows: Record<string, unknown>[]): Record<string, unknown> {
  // union of scalar field keys (skip nested + id)
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (k === "id" || NESTED.has(k)) continue;
      keys.add(k);
    }
  }

  const base: Record<string, unknown> = {};
  const varying: string[] = [];
  for (const k of keys) {
    const vals = rows.map((r) => r[k]);
    const distinct = new Set(vals.map(norm));
    distinct.delete(""); // ignore missing when deciding constancy
    if (distinct.size <= 1) {
      const present = vals.filter((v) => norm(v) !== "");
      if (present.length > 0) base[k] = representative(present);
    } else {
      varying.push(k);
    }
  }

  // base id = common prefix of the variant ids (else first non-empty id)
  const ids = rows
    .map((r) => (r.id != null ? String(r.id) : ""))
    .filter((s) => s.length > 0);
  const prefix = commonPrefix(ids);
  base.id = prefix || ids[0] || undefined;

  base.variants = rows.map((r) => {
    const variant: Record<string, unknown> = {};
    if (r.id != null) variant.id = r.id;
    for (const k of varying) {
      if (norm(r[k]) !== "") variant[k] = r[k];
    }
    // preserve any pre-existing nested variant attributes
    if (Array.isArray(r.attributes)) variant.attributes = r.attributes;
    return variant;
  });

  return base;
}

export function groupVariants(products: Record<string, unknown>[]): GroupResult {
  const buckets = new Map<string, Record<string, unknown>[]>();
  products.forEach((p, i) => {
    const title = typeof p.title === "string" ? p.title.trim().toLowerCase() : "";
    const key = title ? `t:${title}` : p.id != null ? `i:${String(p.id)}` : `row:${i}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  });

  const out: Record<string, unknown>[] = [];
  for (const rows of buckets.values()) {
    out.push(rows.length === 1 ? rows[0] : buildBase(rows));
  }

  return { input: products.length, grouped: out.length, products: out };
}
