import { describe, expect, it } from "vitest";
import { classifyVertical } from "@/lib/diagnostic/classify-vertical";

/**
 * Tests the keyword-scoring layer of the vertical classifier. The
 * Haiku tie-breaker is gated on ANTHROPIC_API_KEY and short-circuits
 * to "none" when absent — these tests deliberately don't exercise it.
 */

function fakeSupabase(verticals: {
  vertical_id: number;
  vertical_code: string;
  vertical_name: string;
  detection_keywords: string[];
}[]) {
  return {
    from(_table: string) {
      return {
        select(_columns: string) {
          return Promise.resolve({ data: verticals, error: null });
        },
      };
    },
  } as unknown as Parameters<typeof classifyVertical>[0]["supabase"];
}

const PET_KEYWORDS = [
  "dog",
  "cat",
  "pet",
  "perro",
  "gato",
  "mascota",
  "kibble",
  "alimento",
];
const FASHION_KEYWORDS = ["dress", "shirt", "shoes", "vestido", "talla", "moda"];
const GENERIC_KEYWORDS: string[] = [];

const VERTICALS = [
  { vertical_id: 1, vertical_code: "pet_retail", vertical_name: "Pet retail", detection_keywords: PET_KEYWORDS },
  { vertical_id: 2, vertical_code: "fashion", vertical_name: "Fashion", detection_keywords: FASHION_KEYWORDS },
  { vertical_id: 3, vertical_code: "generic", vertical_name: "Generic", detection_keywords: GENERIC_KEYWORDS },
];

describe("classifyVertical (keyword layer)", () => {
  it("picks pet_retail when pet keywords dominate", async () => {
    const supabase = fakeSupabase(VERTICALS);
    const homepageText =
      "Bienvenido a nuestra tienda de mascotas. Comida para perro, gato, accesorios, kibble premium, juguetes para tu perro y gato.";
    const r = await classifyVertical({ homepageText, supabase });
    expect(r.vertical_code).toBe("pet_retail");
    expect(r.method).toBe("keyword");
    expect(r.scores.pet_retail).toBeGreaterThanOrEqual(3);
  });

  it("picks fashion when fashion keywords dominate", async () => {
    const supabase = fakeSupabase(VERTICALS);
    const homepageText =
      "Vestido elegante, camisa de hombre, shoes de mujer, talla XS XL XXL — la mejor moda online.";
    const r = await classifyVertical({ homepageText, supabase });
    expect(r.vertical_code).toBe("fashion");
    expect(r.method).toBe("keyword");
  });

  it("returns no winner when keywords are sparse (without ANTHROPIC_API_KEY)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const supabase = fakeSupabase(VERTICALS);
    const r = await classifyVertical({
      homepageText: "About us. Contact. Privacy. Terms.",
      supabase,
    });
    expect(r.vertical_id).toBeNull();
    expect(r.confidence).toBe("low");
  });

  it("requires a comfortable lead margin to declare a winner", async () => {
    const supabase = fakeSupabase(VERTICALS);
    // Both pet and fashion get 2 hits — too close, no keyword winner.
    delete process.env.ANTHROPIC_API_KEY;
    const r = await classifyVertical({
      homepageText: "dog cat dress shirt",
      supabase,
    });
    expect(r.vertical_code).toBeNull();
  });
});
