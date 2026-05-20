"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search, Loader2, Package, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  runEmulatorSearch,
  type EmulatorCategory,
  type EmulatorHit,
  type EmulatorSearchResult,
  type EmulatorAttributeMatch,
} from "./actions";
import { type FacetFilter } from "@/lib/search/facets";

type Props = {
  instanceId: number;
  categories: EmulatorCategory[];
};

/**
 * Per docs/policy/search-foundations.md §17. Full-width emulator surface on
 * the third tab of /configuration/search. Search box + category dropdown
 * across the top; facet rail on the left; result cards on the right.
 *
 * Goes through the `runEmulatorSearch` server action (NOT the public
 * /api/v1/search endpoint) — same Meilisearch path, but authenticated via
 * instance_member instead of storefront-origin.
 */
export function SearchEmulator({ instanceId, categories }: Props) {
  const t = useTranslations("configuration.search.emulator");
  const [query, setQuery] = useState("");
  const [categoryWcId, setCategoryWcId] = useState<number | null>(null);

  // Facet selections — keyed by facet name. Brand-style (string) facets
  // hold a Set of selected values; in_stock holds true|false|null; price
  // holds {min, max}|null. We resolve these into `FacetFilter[]` per-render.
  const [brandSelections, setBrandSelections] = useState<Set<string>>(new Set());
  const [speciesSelections, setSpeciesSelections] = useState<Set<string>>(new Set());
  const [lifestageSelections, setLifestageSelections] = useState<Set<string>>(new Set());
  const [inStockOnly, setInStockOnly] = useState(false);
  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");

  const [result, setResult] = useState<EmulatorSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Out-of-order completion guard — last issued request wins.
  const requestSeqRef = useRef(0);

  // Build the FacetFilter[] from UI state on each render. Cheap.
  const filters = useMemo<FacetFilter[]>(() => {
    const out: FacetFilter[] = [];
    if (brandSelections.size > 0) {
      out.push({ kind: "in", attribute: "brand", values: [...brandSelections] });
    }
    if (speciesSelections.size > 0) {
      out.push({
        kind: "in",
        attribute: "scout_attributes.species",
        values: [...speciesSelections],
      });
    }
    if (lifestageSelections.size > 0) {
      out.push({
        kind: "in",
        attribute: "scout_attributes.lifestage",
        values: [...lifestageSelections],
      });
    }
    if (inStockOnly) {
      out.push({ kind: "boolean", attribute: "in_stock", value: true });
    }
    const min = priceMin.trim() === "" ? null : Number(priceMin);
    const max = priceMax.trim() === "" ? null : Number(priceMax);
    if ((min != null && !Number.isNaN(min)) || (max != null && !Number.isNaN(max))) {
      out.push({
        kind: "range",
        attribute: "price",
        min: min != null && !Number.isNaN(min) ? min : null,
        max: max != null && !Number.isNaN(max) ? max : null,
      });
    }
    return out;
  }, [
    brandSelections,
    speciesSelections,
    lifestageSelections,
    inStockOnly,
    priceMin,
    priceMax,
  ]);

  // Issue a search whenever any input changes. Empty query is valid — the
  // emulator should still show facet distribution + the first page of docs
  // so operators can browse without typing.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeqRef.current;
      startTransition(async () => {
        const r = await runEmulatorSearch(instanceId, {
          query: query.trim(),
          categoryWcId,
          filters,
          facets: [
            "brand",
            "in_stock",
            "price",
            "scout_attributes.species",
            "scout_attributes.lifestage",
          ],
        });
        if (seq === requestSeqRef.current) setResult(r);
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, categoryWcId, filters, instanceId]);

  const facets = result?.ok ? result.facets : null;

  const activeFilterCount =
    brandSelections.size +
    speciesSelections.size +
    lifestageSelections.size +
    (inStockOnly ? 1 : 0) +
    (priceMin.trim() !== "" || priceMax.trim() !== "" ? 1 : 0);

  const clearFilters = () => {
    setBrandSelections(new Set());
    setSpeciesSelections(new Set());
    setLifestageSelections(new Set());
    setInStockOnly(false);
    setPriceMin("");
    setPriceMax("");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Top bar: search input + category select. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
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
            placeholder={t("searchPlaceholder")}
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <div className="sm:w-72">
          <Select
            value={categoryWcId == null ? "__all__" : String(categoryWcId)}
            onValueChange={(v) => setCategoryWcId(v === "__all__" ? null : Number(v))}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("categoryPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("categoryAll")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.categoryId} value={String(c.woocommerceId)}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Two-column body: facet rail (left) + results (right). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <FacetRail
          facets={facets}
          brandSelections={brandSelections}
          setBrandSelections={setBrandSelections}
          speciesSelections={speciesSelections}
          setSpeciesSelections={setSpeciesSelections}
          lifestageSelections={lifestageSelections}
          setLifestageSelections={setLifestageSelections}
          inStockOnly={inStockOnly}
          setInStockOnly={setInStockOnly}
          priceMin={priceMin}
          setPriceMin={setPriceMin}
          priceMax={priceMax}
          setPriceMax={setPriceMax}
          activeFilterCount={activeFilterCount}
          onClear={clearFilters}
        />
        <ResultsPane result={result} query={query} isPending={isPending} />
      </div>
    </div>
  );
}

// ── Facet rail ───────────────────────────────────────────────────────────

type FacetRailProps = {
  facets: { distribution: Record<string, Record<string, number>>; stats: Record<string, { min: number; max: number }> } | null;
  brandSelections: Set<string>;
  setBrandSelections: (s: Set<string>) => void;
  speciesSelections: Set<string>;
  setSpeciesSelections: (s: Set<string>) => void;
  lifestageSelections: Set<string>;
  setLifestageSelections: (s: Set<string>) => void;
  inStockOnly: boolean;
  setInStockOnly: (v: boolean) => void;
  priceMin: string;
  setPriceMin: (v: string) => void;
  priceMax: string;
  setPriceMax: (v: string) => void;
  activeFilterCount: number;
  onClear: () => void;
};

function FacetRail(props: FacetRailProps) {
  const t = useTranslations("configuration.search.emulator");
  const {
    facets,
    brandSelections,
    setBrandSelections,
    speciesSelections,
    setSpeciesSelections,
    lifestageSelections,
    setLifestageSelections,
    inStockOnly,
    setInStockOnly,
    priceMin,
    setPriceMin,
    priceMax,
    setPriceMax,
    activeFilterCount,
    onClear,
  } = props;

  const priceStats = facets?.stats?.price;
  const brandDist = facets?.distribution?.brand ?? {};
  const speciesDist = facets?.distribution?.["scout_attributes.species"] ?? {};
  const lifestageDist = facets?.distribution?.["scout_attributes.lifestage"] ?? {};
  const inStockDist = facets?.distribution?.in_stock ?? {};

  return (
    <aside className="flex flex-col gap-4 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("facets.title")}</h3>
        {activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Icon icon={X} size={12} />
            {t("facets.clear", { count: activeFilterCount })}
          </button>
        ) : null}
      </div>

      {!facets ? (
        <p className="text-xs text-muted-foreground">{t("facets.loading")}</p>
      ) : (
        <>
          <FacetCheckboxGroup
            title={t("facets.brand")}
            distribution={brandDist}
            selected={brandSelections}
            onToggle={(value) => {
              const next = new Set(brandSelections);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              setBrandSelections(next);
            }}
          />

          <FacetCheckboxGroup
            title={t("facets.species")}
            distribution={speciesDist}
            selected={speciesSelections}
            onToggle={(value) => {
              const next = new Set(speciesSelections);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              setSpeciesSelections(next);
            }}
          />

          <FacetCheckboxGroup
            title={t("facets.lifestage")}
            distribution={lifestageDist}
            selected={lifestageSelections}
            onToggle={(value) => {
              const next = new Set(lifestageSelections);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              setLifestageSelections(next);
            }}
          />

          {/* in_stock — render as a single toggle. Show counts as helper text. */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("facets.inStockTitle")}
            </h4>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs">{t("facets.inStockOnly")}</label>
              <Switch checked={inStockOnly} onCheckedChange={setInStockOnly} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {t("facets.inStockCounts", {
                inStock: inStockDist["true"] ?? 0,
                outOfStock: inStockDist["false"] ?? 0,
              })}
            </p>
          </section>

          {/* price — two number inputs. Stats from facetStats drive
              placeholder hints so operators know the available range. */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("facets.price")}
            </h4>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                placeholder={priceStats ? String(Math.floor(priceStats.min)) : "min"}
                className="h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                inputMode="decimal"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                placeholder={priceStats ? String(Math.ceil(priceStats.max)) : "max"}
                className="h-8 text-xs"
              />
            </div>
            {priceStats ? (
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {t("facets.priceRange", {
                  min: Math.floor(priceStats.min),
                  max: Math.ceil(priceStats.max),
                })}
              </p>
            ) : null}
          </section>
        </>
      )}
    </aside>
  );
}

function FacetCheckboxGroup({
  title,
  distribution,
  selected,
  onToggle,
}: {
  title: string;
  distribution: Record<string, number>;
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <section>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <ul className="flex flex-col gap-1.5">
        {entries.map(([value, count]) => {
          const checked = selected.has(value);
          return (
            <li key={value} className="flex items-center justify-between gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggle(value)}
                />
                <span className="truncate text-xs">{value}</span>
              </label>
              <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {count}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Results pane ─────────────────────────────────────────────────────────

function ResultsPane({
  result,
  query,
  isPending,
}: {
  result: EmulatorSearchResult | null;
  query: string;
  isPending: boolean;
}) {
  const t = useTranslations("configuration.search.emulator");

  if (!result) {
    return (
      <div className="rounded-md border border-dashed px-4 py-12 text-center text-xs text-muted-foreground">
        {isPending ? t("results.searching") : t("results.idle")}
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700">
        <div className="font-medium">{t("results.error")}</div>
        {result.message ? <div className="font-mono break-all">{result.message}</div> : null}
      </div>
    );
  }

  if (result.hits.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-12 text-center text-xs text-muted-foreground">
        {query.trim() === ""
          ? t("results.emptyAll")
          : t("results.empty", { query: result.query })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground tabular-nums">
        {t("results.meta", { count: result.totalHits, ms: result.processingTimeMs })}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {result.hits.map((hit) => (
          <li key={hit.id}>
            <HitCard hit={hit} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function HitCard({ hit }: { hit: EmulatorHit }) {
  const t = useTranslations("configuration.search.emulator");
  const onSale = hit.salePrice != null && hit.price != null && hit.salePrice < hit.price;

  return (
    <div className="flex h-full flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
          {hit.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hit.imageUrl}
              alt=""
              width={56}
              height={56}
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
              {hit.inStock ? t("results.inStock") : t("results.outOfStock")}
            </span>
          </div>
          {hit.categories.length > 0 ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {hit.categories.join(" · ")}
            </div>
          ) : null}
        </div>
      </div>

      {hit.attributeMatches.length > 0 ? (
        <AttributeMatchList matches={hit.attributeMatches} />
      ) : null}
    </div>
  );
}

/**
 * Per-attribute match strip rendered beneath the title. Each row says which
 * indexed attribute Meilisearch highlighted for this hit and which exact
 * tokens — answers "why was this in my results, and which field carried
 * the match" without an operator having to dump the raw response.
 */
function AttributeMatchList({ matches }: { matches: EmulatorAttributeMatch[] }) {
  const t = useTranslations("configuration.search.emulator");
  return (
    <div className="border-t pt-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("results.matches")}
      </div>
      <ul className="flex flex-col gap-1">
        {matches.map((m) => (
          <li key={m.attribute} className="flex items-start gap-2 text-[11px]">
            <span className="flex-shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-medium">
              {prettifyAttribute(m.attribute)}
            </span>
            <span className="flex flex-wrap gap-1">
              {m.tokens.map((tok) => (
                <span
                  key={tok}
                  className="inline-flex items-center rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700"
                >
                  {tok}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mirrors the helper in _search-preview.tsx — same friendly-label table so
 * the emulator and the preview pane read consistently. */
function prettifyAttribute(path: string): string {
  const friendly: Record<string, string> = {
    name: "name",
    brand: "brand",
    categories: "category",
    description: "description",
    short_description: "short description",
    "variants.sku": "SKU",
    "scout_attributes.lifestage": "lifestage",
    "scout_attributes.species": "species",
    "scout_attributes.breed_compatibility": "breed",
    "scout_attributes.medical_conditions": "medical",
  };
  if (friendly[path]) return friendly[path];
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
