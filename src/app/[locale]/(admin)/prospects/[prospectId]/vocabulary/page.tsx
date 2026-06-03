import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { getTranslations } from "next-intl/server";
import { VocabularyEditor, type EntryWithVariants } from "./_client";

export const dynamic = "force-dynamic";

type Prospect = {
  prospect_id: number;
  url: string;
  display_name: string | null;
  vertical_id: number | null;
};

export default async function ProspectVocabularyPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  const { prospectId: pidParam } = await params;
  const prospectId = parseInt(pidParam, 10);
  if (Number.isNaN(prospectId)) notFound();

  const t = await getTranslations("prospects.testEntries");
  const instanceId = await currentInstanceId();
  if (instanceId === null) notFound();

  const supabase = await createClient();

  const { data: prospectRaw } = await supabase
    .from("prospect")
    .select("prospect_id, url, display_name, vertical_id")
    .eq("prospect_id", prospectId)
    .maybeSingle();
  if (!prospectRaw) notFound();
  const prospect = prospectRaw as Prospect;

  // Load both:
  //   1. Vertical-level entries that are templates for this prospect's
  //      vertical (read-only here; managed at /prospects/rubric/vocabulary)
  //   2. Prospect-level entries specific to this prospect (editable)
  const verticalEntriesPromise = prospect.vertical_id
    ? supabase
        .from("search_test_entry")
        .select(
          "entry_id, intent_label, locale, notes, is_active, variants:search_test_variant(variant_id, variant_type, query_text, notes, sort_order)",
        )
        .eq("vertical_id", prospect.vertical_id)
        .order("intent_label")
    : Promise.resolve({ data: [] });

  const prospectEntriesPromise = supabase
    .from("search_test_entry")
    .select(
      "entry_id, intent_label, locale, notes, is_active, variants:search_test_variant(variant_id, variant_type, query_text, notes, sort_order)",
    )
    .eq("prospect_id", prospectId)
    .order("intent_label");

  const [{ data: verticalRaw }, { data: prospectRawEntries }] = await Promise.all([
    verticalEntriesPromise,
    prospectEntriesPromise,
  ]);

  const verticalEntries = ((verticalRaw ?? []) as unknown as EntryWithVariants[]).map(
    (e) => ({ ...e, source: "vertical" as const }),
  );
  const prospectEntries = ((prospectRawEntries ?? []) as unknown as EntryWithVariants[]).map(
    (e) => ({ ...e, source: "prospect" as const }),
  );

  return (
    <div className="s-content">
      <div style={{ fontSize: 11, color: "var(--gl-text-tertiary)", marginBottom: 4 }}>
        <Link
          href={`/prospects/${prospect.prospect_id}` as never}
          style={{ color: "var(--gl-text-tertiary)" }}
        >
          ← {prospect.display_name ?? prospect.url}
        </Link>
      </div>
      <div className="s-title-row" style={{ marginBottom: 24 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
      </div>

      <VocabularyEditor
        prospectId={prospectId}
        verticalEntries={verticalEntries}
        prospectEntries={prospectEntries}
      />
    </div>
  );
}
