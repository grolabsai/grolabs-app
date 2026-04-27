"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AttributeTypeGlyph } from "@/components/catalog/AttributeTypeGlyph";
import {
  addCategoryAttributeLink,
  updateCategoryAttributeLink,
  removeCategoryAttributeLink,
  createCategoryAttrOverride,
  updateCategoryParsingNote,
} from "@/lib/actions/categoryAttribute";

export type CategoryAttrLink = {
  mapping_id: number;
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string | null;
  is_multivalue: boolean;
  is_variant_axis: boolean;
  requirement_level: string | null;
  from_category_id: number;
  from_category_name: string;
};

export type AvailableAttr = {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string | null;
};

export function CategoryAttributeSection({
  categoryId,
  categoryName,
  initialOwnLinks,
  inheritedLinks,
  allInstanceAttrs,
  parsingNote,
}: {
  categoryId: number;
  categoryName: string;
  initialOwnLinks: CategoryAttrLink[];
  inheritedLinks: CategoryAttrLink[];
  allInstanceAttrs: AvailableAttr[];
  parsingNote: string | null;
}) {
  const t = useTranslations("catalog.categoryAttributes");
  const [, startTransition] = useTransition();
  const [ownLinks, setOwnLinks] = useState(initialOwnLinks);
  // attribute_ids that have been overridden or excluded at this category level
  const [overriddenIds, setOverriddenIds] = useState<Set<number>>(new Set());
  const [note, setNote] = useState(parsingNote ?? "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showAddPopover, setShowAddPopover] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [openKebab, setOpenKebab] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const _tid = useRef(-1);

  const visibleInherited = inheritedLinks.filter((l) => !overriddenIds.has(l.attribute_id));

  const linkedAttrIds = new Set([
    ...ownLinks.map((l) => l.attribute_id),
    ...inheritedLinks.map((l) => l.attribute_id),
  ]);

  const availableToAdd = allInstanceAttrs.filter((a) => !linkedAttrIds.has(a.attribute_id));
  const filteredAvailable = addSearch.trim()
    ? availableToAdd.filter(
        (a) =>
          a.attribute_name.toLowerCase().includes(addSearch.toLowerCase()) ||
          a.attribute_code.toLowerCase().includes(addSearch.toLowerCase()),
      )
    : availableToAdd;

  useEffect(() => {
    if (!showAddPopover) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !addBtnRef.current?.contains(e.target as Node)
      ) {
        setShowAddPopover(false);
        setAddSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAddPopover]);

  function handleToggleVariantAxis(link: CategoryAttrLink, isOwn: boolean) {
    const newVal = !link.is_variant_axis;
    if (isOwn) {
      setOwnLinks((prev) =>
        prev.map((l) => (l.mapping_id === link.mapping_id ? { ...l, is_variant_axis: newVal } : l)),
      );
      startTransition(async () => {
        await updateCategoryAttributeLink(link.mapping_id, { is_variant_axis: newVal });
      });
    } else {
      const newLink: CategoryAttrLink = {
        ...link,
        mapping_id: --_tid.current,
        is_variant_axis: newVal,
        from_category_id: categoryId,
        from_category_name: categoryName,
      };
      setOwnLinks((prev) => [...prev, newLink]);
      setOverriddenIds((prev) => new Set([...prev, link.attribute_id]));
      startTransition(async () => {
        await createCategoryAttrOverride(categoryId, link.attribute_id, {
          is_variant_axis: newVal,
          requirement_level: link.requirement_level ?? "optional",
        });
      });
    }
  }

  function handleToggleRequired(link: CategoryAttrLink, isOwn: boolean) {
    const newReq = link.requirement_level === "required" ? "optional" : "required";
    if (isOwn) {
      setOwnLinks((prev) =>
        prev.map((l) =>
          l.mapping_id === link.mapping_id ? { ...l, requirement_level: newReq } : l,
        ),
      );
      startTransition(async () => {
        await updateCategoryAttributeLink(link.mapping_id, { requirement_level: newReq });
      });
    } else {
      const newLink: CategoryAttrLink = {
        ...link,
        mapping_id: --_tid.current,
        requirement_level: newReq,
        from_category_id: categoryId,
        from_category_name: categoryName,
      };
      setOwnLinks((prev) => [...prev, newLink]);
      setOverriddenIds((prev) => new Set([...prev, link.attribute_id]));
      startTransition(async () => {
        await createCategoryAttrOverride(categoryId, link.attribute_id, {
          is_variant_axis: link.is_variant_axis,
          requirement_level: newReq,
        });
      });
    }
  }

  function handleRemoveOwn(link: CategoryAttrLink) {
    setOwnLinks((prev) => prev.filter((l) => l.mapping_id !== link.mapping_id));
    startTransition(async () => {
      await removeCategoryAttributeLink(link.mapping_id);
    });
  }

  function handleOverrideHere(link: CategoryAttrLink) {
    setOpenKebab(null);
    const newLink: CategoryAttrLink = {
      ...link,
      mapping_id: --_tid.current,
      from_category_id: categoryId,
      from_category_name: categoryName,
    };
    setOwnLinks((prev) => [...prev, newLink]);
    setOverriddenIds((prev) => new Set([...prev, link.attribute_id]));
    startTransition(async () => {
      await createCategoryAttrOverride(categoryId, link.attribute_id, {
        is_variant_axis: link.is_variant_axis,
        requirement_level: link.requirement_level ?? "optional",
      });
    });
  }

  function handleExclude(link: CategoryAttrLink) {
    setOpenKebab(null);
    setOverriddenIds((prev) => new Set([...prev, link.attribute_id]));
  }

  function handleAddAttr(attr: AvailableAttr) {
    const tempLink: CategoryAttrLink = {
      mapping_id: --_tid.current,
      attribute_id: attr.attribute_id,
      attribute_code: attr.attribute_code,
      attribute_name: attr.attribute_name,
      data_type: attr.data_type,
      is_multivalue: false,
      is_variant_axis: false,
      requirement_level: "optional",
      from_category_id: categoryId,
      from_category_name: categoryName,
    };
    setOwnLinks((prev) => [...prev, tempLink]);
    setShowAddPopover(false);
    setAddSearch("");
    startTransition(async () => {
      await addCategoryAttributeLink(categoryId, attr.attribute_id);
    });
  }

  async function handleSaveNote() {
    setSavingNote(true);
    await updateCategoryParsingNote(categoryId, note);
    setSavingNote(false);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  }

  return (
    <div>
      {/* Inherited group */}
      {visibleInherited.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--s-text-tertiary)",
              marginBottom: 6,
            }}
          >
            {t("inherited.label")}
          </div>
          <div
            style={{
              background: "#f5f3ee",
              border: "0.5px solid #e0dccf",
              borderRadius: "var(--s-radius-md)",
              overflow: "hidden",
            }}
          >
            {visibleInherited.map((link, i) => (
              <AttrRow
                key={link.attribute_id}
                link={link}
                isOwn={false}
                isLast={i === visibleInherited.length - 1}
                t={t}
                openKebab={openKebab}
                setOpenKebab={setOpenKebab}
                onToggleVariantAxis={() => handleToggleVariantAxis(link, false)}
                onToggleRequired={() => handleToggleRequired(link, false)}
                onRemove={null}
                onOverrideHere={() => handleOverrideHere(link)}
                onExclude={() => handleExclude(link)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Own group */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--s-text-tertiary)",
            marginBottom: 6,
          }}
        >
          {t("own.label", { categoryName })}
        </div>
        {ownLinks.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--s-text-tertiary)", padding: "4px 0" }}>
            {t("own.empty")}
          </div>
        ) : (
          <div
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              overflow: "hidden",
            }}
          >
            {ownLinks.map((link, i) => (
              <AttrRow
                key={link.mapping_id}
                link={link}
                isOwn={true}
                isLast={i === ownLinks.length - 1}
                t={t}
                openKebab={openKebab}
                setOpenKebab={setOpenKebab}
                onToggleVariantAxis={() => handleToggleVariantAxis(link, true)}
                onToggleRequired={() => handleToggleRequired(link, true)}
                onRemove={() => handleRemoveOwn(link)}
                onOverrideHere={null}
                onExclude={null}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add attribute button + popover */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <button
          ref={addBtnRef}
          type="button"
          onClick={() => setShowAddPopover((v) => !v)}
          style={{
            fontSize: 12,
            color: "var(--scout-accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            fontFamily: "var(--s-font)",
          }}
        >
          {t("addButton")}
        </button>
        {showAddPopover && (
          <div
            ref={popoverRef}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 50,
              width: 280,
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              marginTop: 4,
            }}
          >
            <div style={{ padding: "8px 8px 4px" }}>
              <input
                type="search"
                className="s-input"
                style={{ height: 30, fontSize: 12 }}
                placeholder={t("addPopover.searchPlaceholder")}
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {filteredAvailable.length === 0 ? (
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "var(--s-text-tertiary)",
                  }}
                >
                  {t("addPopover.empty")}
                </div>
              ) : (
                filteredAvailable.map((attr) => (
                  <button
                    key={attr.attribute_id}
                    type="button"
                    onClick={() => handleAddAttr(attr)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 12px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--s-font)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--s-surface-alt)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <AttributeTypeGlyph dataType={attr.data_type} size={18} />
                    <span style={{ fontSize: 12, color: "var(--s-text)" }}>
                      {attr.attribute_name}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div
              style={{
                borderTop: "0.5px solid var(--s-border)",
                padding: "4px 8px 8px",
              }}
            >
              <Link
                href="/catalog/attributes?mode=create"
                style={{
                  fontSize: 12,
                  color: "var(--scout-accent)",
                  textDecoration: "none",
                  display: "block",
                  padding: "6px 4px",
                }}
              >
                {t("addPopover.createNew")}
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Parsing note */}
      <div>
        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--s-text-secondary)",
            display: "block",
            marginBottom: 4,
          }}
        >
          {t("note.label")}{" "}
          <span style={{ fontWeight: 400, color: "var(--s-text-tertiary)" }}>
            {t("note.optional")}
          </span>
        </label>
        <textarea
          className="s-textarea"
          rows={3}
          value={note}
          placeholder={t("note.placeholder")}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteSaved(false);
          }}
          style={{ fontSize: 12 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button
            type="button"
            className="s-btn s-btn-secondary"
            style={{ fontSize: 12, height: 30, padding: "0 12px" }}
            onClick={handleSaveNote}
            disabled={savingNote}
          >
            {savingNote ? t("saving") : t("save")}
          </button>
          {noteSaved && (
            <span style={{ fontSize: 12, color: "var(--s-success)" }}>{t("saved")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function AttrRow({
  link,
  isOwn,
  isLast,
  t,
  openKebab,
  setOpenKebab,
  onToggleVariantAxis,
  onToggleRequired,
  onRemove,
  onOverrideHere,
  onExclude,
}: {
  link: CategoryAttrLink;
  isOwn: boolean;
  isLast: boolean;
  t: ReturnType<typeof useTranslations<"catalog.categoryAttributes">>;
  openKebab: number | null;
  setOpenKebab: (id: number | null) => void;
  onToggleVariantAxis: () => void;
  onToggleRequired: () => void;
  onRemove: (() => void) | null;
  onOverrideHere: (() => void) | null;
  onExclude: (() => void) | null;
}) {
  const isVariantAxis = link.is_variant_axis;
  const isRequired = link.requirement_level === "required";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: isLast ? "none" : "0.5px solid var(--s-border)",
      }}
    >
      <AttributeTypeGlyph dataType={link.data_type} isMultivalue={link.is_multivalue} size={20} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--s-text)" }}>
          {link.attribute_name}
        </div>
        {!isOwn && (
          <div style={{ fontSize: 10, color: "var(--s-text-tertiary)", marginTop: 1 }}>
            {t("inherited.badge", { parentName: link.from_category_name })}
          </div>
        )}
      </div>

      {/* Toggle: variant axis / descriptive */}
      <button
        type="button"
        onClick={onToggleVariantAxis}
        style={{
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 999,
          border: "1px solid",
          cursor: "pointer",
          background: isVariantAxis ? "var(--scout-accent)" : "transparent",
          borderColor: isVariantAxis ? "var(--scout-accent)" : "var(--s-border)",
          color: isVariantAxis ? "#fff" : "var(--s-text-secondary)",
          fontFamily: "var(--s-font)",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {isVariantAxis ? t("variantAxis.on") : t("variantAxis.off")}
      </button>

      {/* Toggle: required / optional */}
      <button
        type="button"
        onClick={onToggleRequired}
        style={{
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 999,
          border: "1px solid",
          cursor: "pointer",
          background: isRequired ? "var(--s-text-secondary)" : "transparent",
          borderColor: isRequired ? "var(--s-text-secondary)" : "var(--s-border)",
          color: isRequired ? "#fff" : "var(--s-text-tertiary)",
          fontFamily: "var(--s-font)",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {isRequired ? t("required.on") : t("required.off")}
      </button>

      {/* Actions */}
      {isOwn && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("actions.remove")}
          style={{
            fontSize: 14,
            color: "var(--s-text-tertiary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            lineHeight: 1,
            fontFamily: "var(--s-font)",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}

      {!isOwn && (onOverrideHere || onExclude) && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setOpenKebab(openKebab === link.attribute_id ? null : link.attribute_id)}
            style={{
              fontSize: 14,
              color: "var(--s-text-tertiary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              lineHeight: 1,
              fontFamily: "var(--s-font)",
            }}
            title="Opciones"
          >
            ⋮
          </button>
          {openKebab === link.attribute_id && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                zIndex: 40,
                background: "var(--s-surface)",
                border: "0.5px solid var(--s-border)",
                borderRadius: "var(--s-radius-md)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                minWidth: 160,
                padding: "4px 0",
              }}
            >
              {onOverrideHere && (
                <button
                  type="button"
                  onClick={onOverrideHere}
                  style={kebabItemStyle}
                >
                  {t("actions.override")}
                </button>
              )}
              {onExclude && (
                <button
                  type="button"
                  onClick={onExclude}
                  style={{ ...kebabItemStyle, color: "var(--s-danger)" }}
                >
                  {t("actions.exclude")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const kebabItemStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "6px 14px",
  fontSize: 12,
  color: "var(--s-text)",
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: "var(--s-font)",
};
