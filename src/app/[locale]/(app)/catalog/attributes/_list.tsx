"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AttributeTypeGlyph } from "@/components/catalog/AttributeTypeGlyph";
import type { AttributeRow } from "./_types";

type FilterType = "all" | "variant" | "descriptive";

const DATA_TYPE_ORDER = ["list", "text", "number", "boolean", "date", "quantity", "single_ref"];

export function AttributeList({ attributes }: { attributes: AttributeRow[] }) {
  const t = useTranslations("catalog.attributes");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id") ? parseInt(searchParams.get("id")!, 10) : null;
  const isCreate = searchParams.get("mode") === "create";

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const GROUP_LABELS: Record<string, string> = {
    list: t("groups.list"),
    text: t("groups.text"),
    number: t("groups.number"),
    boolean: t("groups.boolean"),
    date: t("groups.date"),
    quantity: t("groups.quantity"),
    single_ref: t("groups.single_ref"),
    other: t("groups.other"),
  };

  const FILTER_LABELS: Record<FilterType, string> = {
    all: t("filters.all"),
    variant: t("filters.variant"),
    descriptive: t("filters.descriptive"),
  };

  const filtered = useMemo(() => {
    let list = attributes;
    if (filter === "variant") list = list.filter((a) => a.applies_to_variants);
    if (filter === "descriptive") list = list.filter((a) => !a.applies_to_variants);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (a) =>
          a.attribute_name.toLowerCase().includes(q) ||
          a.attribute_code.toLowerCase().includes(q),
      );
    }
    return list;
  }, [attributes, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, AttributeRow[]>();
    for (const a of filtered) {
      const key = a.data_type ?? "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ai = DATA_TYPE_ORDER.indexOf(a);
      const bi = DATA_TYPE_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [filtered]);

  return (
    <div
      style={{
        borderRight: "0.5px solid var(--s-border)",
        background: "var(--s-surface-alt)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "16px 12px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--s-text)" }}>
            {t("title")}
          </span>
          <button
            type="button"
            className="s-btn s-btn-primary"
            style={{ fontSize: 11, padding: "4px 10px", height: 28 }}
            onClick={() => router.push("?mode=create")}
          >
            {t("createButton")}
          </button>
        </div>

        <input
          type="search"
          className="s-input"
          style={{ height: 32, fontSize: 12, marginBottom: 8 }}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "variant", "descriptive"] as FilterType[]).map((f) => (
            <button
              key={f}
              type="button"
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid",
                cursor: "pointer",
                background: filter === f ? "var(--scout-accent)" : "transparent",
                borderColor: filter === f ? "var(--scout-accent)" : "var(--s-border)",
                color: filter === f ? "#fff" : "var(--s-text-secondary)",
                fontFamily: "var(--s-font)",
              }}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 16px" }}>
        {isCreate && (
          <div
            style={{
              padding: "8px 10px",
              margin: "4px 0",
              borderRadius: "var(--s-radius-md)",
              background: "var(--scout-accent-50)",
              borderLeft: "3px solid var(--scout-accent)",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--s-text)",
            }}
          >
            {t("form.createTitle")}
          </div>
        )}

        {grouped.length === 0 && (
          <div
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--s-text-tertiary)",
              fontSize: 12,
            }}
          >
            {query ? t("empty.noResults", { query }) : t("empty.noAttributes")}
            {!query && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  style={{
                    fontSize: 12,
                    color: "var(--scout-accent)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--s-font)",
                  }}
                  onClick={() => router.push("?mode=create")}
                >
                  {t("empty.createFirst")}
                </button>
              </div>
            )}
          </div>
        )}

        {grouped.map(([dataType, items]) => (
          <div key={dataType} style={{ marginBottom: 4 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--s-text-tertiary)",
                padding: "8px 12px 4px",
              }}
            >
              {GROUP_LABELS[dataType] ?? dataType}
            </div>
            {items.map((attr) => (
              <button
                key={attr.attribute_id}
                type="button"
                onClick={() => router.push(`?id=${attr.attribute_id}`)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: "var(--s-radius-md)",
                  border: "none",
                  background:
                    selectedId === attr.attribute_id
                      ? "var(--s-surface-hover)"
                      : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--s-font)",
                }}
              >
                <AttributeTypeGlyph
                  dataType={attr.data_type}
                  isMultivalue={attr.is_multivalue}
                  size={20}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: "var(--s-text)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {attr.attribute_name}
                </span>
                {!attr.is_active && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--s-text-tertiary)",
                      border: "0.5px solid var(--s-border)",
                      padding: "1px 5px",
                      borderRadius: 3,
                      flexShrink: 0,
                    }}
                  >
                    {t("inactive")}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
