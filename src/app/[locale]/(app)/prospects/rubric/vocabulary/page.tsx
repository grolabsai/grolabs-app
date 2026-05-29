import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { VocabularyEditor } from "./_editor";

export const dynamic = "force-dynamic";

export type Vertical = {
  vertical_id: number;
  vertical_code: string;
  vertical_name: string;
};

export type SynonymPair = {
  pair_id: number;
  instance_id: number;
  vertical_id: number;
  term_a: string;
  term_b: string;
  locale: string;
  notes: string | null;
  is_active: boolean;
};

export type TestQuery = {
  query_id: number;
  instance_id: number;
  vertical_id: number;
  query_text: string;
  locale: string;
  intent: string;
  notes: string | null;
  is_active: boolean;
};

export default async function VocabularyPage() {
  const t = await getTranslations("prospects.vocabulary");
  const instanceId = await currentInstanceId();

  if (instanceId === null) {
    return (
      <div className="s-content">
        <div className="s-strip warning">
          <span className="s-strip-title">{t("sessionExpired")}</span>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: verticalsRaw }, { data: pairsRaw }, { data: queriesRaw }] = await Promise.all([
    supabase
      .from("vertical")
      .select("vertical_id, vertical_code, vertical_name")
      .order("vertical_name"),
    supabase
      .from("vertical_synonym_pair")
      .select(
        "pair_id, instance_id, vertical_id, term_a, term_b, locale, notes, is_active",
      )
      .order("vertical_id")
      .order("term_a"),
    supabase
      .from("vertical_test_query")
      .select(
        "query_id, instance_id, vertical_id, query_text, locale, intent, notes, is_active",
      )
      .order("vertical_id")
      .order("intent")
      .order("query_text"),
  ]);

  const verticals: Vertical[] = (verticalsRaw ?? []) as Vertical[];
  const pairs: SynonymPair[] = (pairsRaw ?? []) as SynonymPair[];
  const queries: TestQuery[] = (queriesRaw ?? []) as TestQuery[];

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginBottom: 4 }}>
            <Link href="/prospects/rubric" style={{ color: "var(--s-text-tertiary)" }}>
              ← {t("backToRubric")}
            </Link>
          </div>
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
      </div>

      <VocabularyEditor
        verticals={verticals}
        pairs={pairs}
        queries={queries}
        currentInstanceId={instanceId}
      />
    </div>
  );
}
