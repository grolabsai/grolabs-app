"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { Building2 } from "lucide-react";
import type { BrandRow } from "./_types";

export function BrandList({
  brands,
  productCounts,
}: {
  brands: BrandRow[];
  productCounts: Record<number, number>;
}) {
  const t = useTranslations("catalog.brands");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id") ? parseInt(searchParams.get("id")!, 10) : null;
  const isCreate = searchParams.get("mode") === "create";

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return brands;
    const q = query.toLowerCase();
    return brands.filter(
      (b) =>
        b.brand_name.toLowerCase().includes(q) ||
        (b.manufacturer ?? "").toLowerCase().includes(q),
    );
  }, [brands, query]);

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
          style={{ height: 32, fontSize: 12 }}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

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

        {filtered.length === 0 && (
          <div
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--s-text-tertiary)",
              fontSize: 12,
            }}
          >
            {query ? t("empty.noResults", { query }) : t("empty.noBrands")}
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

        {filtered.map((brand) => {
          const prodCount = productCounts[brand.brand_id] ?? 0;
          return (
            <button
              key={brand.brand_id}
              type="button"
              onClick={() => router.push(`?id=${brand.brand_id}`)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderRadius: "var(--s-radius-md)",
                border: "none",
                background:
                  selectedId === brand.brand_id ? "var(--s-surface-hover)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "var(--s-font)",
              }}
            >
              <Icon icon={Building2} size={16} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--s-text)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {brand.brand_name}
                </span>
                {brand.manufacturer && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--s-text-tertiary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {brand.manufacturer}
                  </span>
                )}
              </div>
              {prodCount > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--s-text-tertiary)",
                    background: "var(--s-surface)",
                    border: "0.5px solid var(--s-border)",
                    padding: "1px 5px",
                    borderRadius: 3,
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {prodCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
