"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search, Loader2, Package } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  previewSearch,
  type SearchPreviewHit,
  type SearchPreviewResult,
  type SearchPreviewTokenMatch,
} from "./actions";

type Props = {
  instanceId: number;
};

/**
 * Search preview pane. Lives next to the settings form on /configuration/search
 * so operators can dry-run a Meilisearch query against their own index —
 * same instance scope, same filter pinning, no storefront origin required.
 *
 * Authenticated via instance_member (server action), so rate-limiting and
 * query_log writes are intentionally skipped — this is a staff-only audit
 * surface, not a billable customer path.
 */
export function SearchPreview({ instanceId }: Props) {
  const t = useTranslations("configuration.search.preview");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchPreviewResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identifies the most-recent request so out-of-order completions can't paint
  // stale results over fresh ones.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeqRef.current;
      startTransition(async () => {
        const r = await previewSearch(instanceId, trimmed);
        if (seq === requestSeqRef.current) setResult(r);
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, instanceId]);

  const displayedResult = query.trim().length === 0 ? null : result;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="s-card-label !mb-1">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("help")}</p>
      </div>

      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground"
        >
          <Icon icon={isPending ? Loader2 : Search} className={isPending ? "s-spin" : ""} />
        </span>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("placeholder")}
          className="pl-9"
          autoComplete="off"
        />
      </div>

      <ResultsBody result={displayedResult} isPending={isPending} query={query} />
    </div>
  );
}

function ResultsBody({
  result,
  isPending,
  query,
}: {
  result: SearchPreviewResult | null;
  isPending: boolean;
  query: string;
}) {
  const t = useTranslations("configuration.search.preview");

  if (query.trim().length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        {t("idle")}
      </div>
    );
  }

  if (!result) {
    // Debounce window or first request in flight.
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        {isPending ? t("searching") : t("idle")}
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700">
        <div className="font-medium">{t("error")}</div>
        {result.message ? (
          <div className="font-mono break-all">{result.message}</div>
        ) : null}
      </div>
    );
  }

  if (result.hits.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        {t("empty", { query: result.query })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground tabular-nums">
        {t("meta", {
          count: result.totalHits,
          ms: result.processingTimeMs,
        })}
      </div>
      <ul className="flex flex-col gap-2">
        {result.hits.map((hit) => (
          <li key={hit.id}>
            <HitCard hit={hit} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function HitCard({ hit }: { hit: SearchPreviewHit }) {
  const t = useTranslations("configuration.search.preview");
  const onSale = hit.salePrice != null && hit.price != null && hit.salePrice < hit.price;

  return (
    <div className="flex items-start gap-3 rounded-md border bg-background px-3 py-2">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
        {hit.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hit.imageUrl}
            alt=""
            width={48}
            height={48}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon icon={Package} className="text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{hit.name}</span>
          <span className="flex flex-shrink-0 items-baseline gap-1 text-xs tabular-nums">
            {onSale ? (
              <>
                <span className="font-medium text-emerald-700">
                  {formatPrice(hit.salePrice!, hit.currency)}
                </span>
                <span className="text-muted-foreground line-through">
                  {formatPrice(hit.price!, hit.currency)}
                </span>
              </>
            ) : hit.price != null ? (
              <span className="font-medium">{formatPrice(hit.price, hit.currency)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {hit.brand ? <span className="truncate">{hit.brand}</span> : null}
          {hit.sku ? <span className="truncate font-mono">{hit.sku}</span> : null}
          <span
            className={
              hit.inStock
                ? "ml-auto flex-shrink-0 rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700"
                : "ml-auto flex-shrink-0 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-amber-700"
            }
          >
            {hit.inStock ? t("inStock") : t("outOfStock")}
          </span>
        </div>
        {hit.categories.length > 0 ? (
          <div className="truncate text-[11px] text-muted-foreground">
            {hit.categories.join(" · ")}
          </div>
        ) : null}
        {hit.tokenMatches.length > 0 ? (
          <TokenMatchPills matches={hit.tokenMatches} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * One pill per query token. Green when Meilisearch highlighted the token in
 * at least one searchable attribute of this hit (with the attribute path as
 * a hint); red when the hit was returned without that exact token appearing
 * — usually typo tolerance, a synonym, or another token dragging the result
 * in. Lets operators verify that "red small sweater" actually matched all
 * three concepts instead of just being the most-relevant guess.
 */
function TokenMatchPills({ matches }: { matches: SearchPreviewTokenMatch[] }) {
  const t = useTranslations("configuration.search.preview");
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {matches.map((m) => {
        const matched = m.attributes.length > 0;
        const label = matched
          ? `${m.token} · ${m.attributes.map(prettifyAttribute).join(", ")}`
          : m.token;
        const title = matched
          ? t("match.matchedTitle", {
              token: m.token,
              attributes: m.attributes.map(prettifyAttribute).join(", "),
            })
          : t("match.unmatchedTitle", { token: m.token });
        return (
          <span
            key={m.token}
            title={title}
            className={
              matched
                ? "inline-flex items-center rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                : "inline-flex items-center rounded-sm bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
            }
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** Map a Meilisearch attribute path to something a non-engineer can read.
 * Top-level keys get a friendly label; nested paths keep the leaf for
 * specificity (so `variants.attributes.color` reads as "variants → color").
 * Unknown keys fall through unchanged. */
function prettifyAttribute(path: string): string {
  const friendly: Record<string, string> = {
    name: "name",
    brand: "brand",
    categories: "category",
    description: "description",
    "variants.sku": "SKU",
    "scout_attributes.lifestage": "lifestage",
    "scout_attributes.species": "species",
    "scout_attributes.breed_compatibility": "breed",
    "scout_attributes.medical_conditions": "medical",
  };
  if (friendly[path]) return friendly[path];
  // variants.attributes.color → "color"
  if (path.startsWith("variants.attributes.")) {
    return path.slice("variants.attributes.".length);
  }
  if (path === "variants.attributes") return "variants";
  return path;
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`.trim();
  }
}
