/**
 * Dry-run validation of product documents against the canonical ProductObject
 * shape (see public/openapi.yaml). Pure — writes nothing. Powers
 * POST /api/v1/catalog/validate so a client's dev (or their AI agent) can
 * self-correct payloads before anything reaches us. Plan: P13.
 *
 * The only hard requirement is a stable `id`; everything else is best-effort and
 * only flagged when present-but-malformed (e.g. a quantity missing its unit).
 */

export const MAX_VALIDATE_BATCH = 1000;

export type DocError = { index: number; id?: string | number; errors: string[] };

export type ValidateReport = {
  ok: boolean;
  total: number;
  valid: number;
  invalid: number;
  errors: DocError[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validId(id: unknown): boolean {
  if (typeof id === "number") return Number.isFinite(id);
  return typeof id === "string" && id.length > 0;
}

export function validateDocuments(docs: unknown[]): ValidateReport {
  const errors: DocError[] = [];
  let valid = 0;

  docs.forEach((doc, index) => {
    if (!isPlainObject(doc)) {
      errors.push({ index, errors: ["not_an_object"] });
      return;
    }

    const errs: string[] = [];
    const id = doc.id;
    if (!validId(id)) errs.push("missing_or_invalid_id");

    if (doc.variants !== undefined) {
      if (!Array.isArray(doc.variants)) {
        errs.push("variants_not_array");
      } else {
        doc.variants.forEach((v, vi) => {
          if (!isPlainObject(v)) errs.push(`variant_${vi}_not_object`);
          else if (!validId(v.id)) errs.push(`variant_${vi}_missing_or_invalid_id`);
        });
      }
    }

    if (doc.attributes !== undefined) {
      if (!Array.isArray(doc.attributes)) {
        errs.push("attributes_not_array");
      } else {
        doc.attributes.forEach((a, ai) => {
          if (!isPlainObject(a) || typeof a.code !== "string" || a.code.length === 0) {
            errs.push(`attribute_${ai}_missing_code`);
            return;
          }
          if (a.quantity !== undefined) {
            const q = a.quantity;
            if (!isPlainObject(q) || typeof q.value !== "number" || typeof q.unit !== "string") {
              errs.push(`attribute_${ai}_invalid_quantity`);
            }
          }
        });
      }
    }

    if (doc.categories !== undefined && !Array.isArray(doc.categories)) {
      errs.push("categories_not_array");
    }

    if (errs.length > 0) {
      errors.push({
        index,
        id: validId(id) ? (id as string | number) : undefined,
        errors: errs,
      });
    } else {
      valid++;
    }
  });

  return {
    ok: errors.length === 0,
    total: docs.length,
    valid,
    invalid: errors.length,
    errors,
  };
}
