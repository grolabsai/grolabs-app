"use client";

import * as React from "react";
import { useId } from "react";
import { Check, ChevronDown, X, Plus } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export interface ComboboxOption {
  value: string | number;
  label: string;
  description?: string;
  glyph?: React.ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps {
  // Data
  options: ComboboxOption[];

  // Selection
  value?: ComboboxOption["value"] | ComboboxOption["value"][];
  onChange: (value: ComboboxOption["value"] | ComboboxOption["value"][]) => void;
  multiple?: boolean;

  // Presentation
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;

  // Create-new affordance
  onCreateNew?: (query: string) => void;
  createNewLabel?: string;

  // Standard form props
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

const MAX_CHIPS = 3;

export function Combobox({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyMessage = "Sin resultados.",
  onCreateNew,
  createNewLabel,
  disabled = false,
  className,
  id,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const listboxId = useId();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedValues = React.useMemo<(string | number)[]>(() => {
    if (value === undefined || value === null) return [];
    if (multiple) return Array.isArray(value) ? value : [value];
    return Array.isArray(value) ? value : [value];
  }, [value, multiple]);

  const selectedOptions = options.filter((o) => selectedValues.includes(o.value));
  const visibleChips = selectedOptions.slice(0, MAX_CHIPS);
  const extraCount = selectedOptions.length - MAX_CHIPS;

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q)),
    );
  }, [options, search]);

  const resolvedCreateLabel = React.useMemo(() => {
    const query = search.trim();
    if (!query) return createNewLabel ?? "+ Crear nuevo";
    return createNewLabel ? `${createNewLabel} "${query}"` : `+ Crear "${query}"`;
  }, [search, createNewLabel]);

  function handleSelect(option: ComboboxOption) {
    if (option.disabled) return;
    if (multiple) {
      const isSelected = selectedValues.includes(option.value);
      const next = isSelected
        ? selectedValues.filter((v) => v !== option.value)
        : [...selectedValues, option.value];
      onChange(next);
      // Keep dropdown open for multi-select
    } else {
      onChange(option.value);
      setOpen(false);
      setSearch("");
    }
  }

  function handleRemoveChip(val: string | number, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(selectedValues.filter((v) => v !== val));
  }

  function handleCreateNew() {
    onCreateNew?.(search);
    setOpen(false);
    setSearch("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex min-h-9 w-full items-center gap-1 rounded-md border border-input bg-white px-3 py-1.5 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:bg-white disabled:opacity-70",
            "cursor-pointer",
            className,
          )}
        >
          {/* Selected value / chips / placeholder */}
          <span className="flex flex-1 flex-wrap items-center gap-1 min-w-0">
            {multiple ? (
              selectedOptions.length === 0 ? (
                <span className="text-muted-foreground truncate">{placeholder}</span>
              ) : (
                <>
                  {visibleChips.map((opt) => (
                    <span
                      key={opt.value}
                      className="inline-flex items-center gap-1 rounded bg-[var(--scout-accent-50)] px-1.5 py-0.5 text-xs font-medium text-[var(--scout-accent-800)]"
                    >
                      <span className="max-w-[120px] truncate">{opt.label}</span>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Quitar ${opt.label}`}
                        onClick={(e) => handleRemoveChip(opt.value, e)}
                        className="hover:text-[var(--s-danger)] transition-colors"
                      >
                        <Icon icon={X} size={10} />
                      </button>
                    </span>
                  ))}
                  {extraCount > 0 && (
                    <span className="text-xs text-[var(--s-text-tertiary)]">
                      +{extraCount} más
                    </span>
                  )}
                </>
              )
            ) : (
              <span
                className={cn(
                  "truncate",
                  selectedOptions.length === 0 && "text-muted-foreground",
                )}
              >
                {selectedOptions[0]?.label ?? placeholder}
              </span>
            )}
          </span>

          {/* Chevron */}
          <Icon
            icon={ChevronDown}
            size={14}
            className={cn(
              "ml-1 shrink-0 text-[var(--s-text-tertiary)] transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0"
        style={{
          width: "var(--radix-popover-trigger-width)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-md)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
          background: "#ffffff",
        }}
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList id={listboxId} role="listbox" className="max-h-[280px]">
            {filteredOptions.length === 0 ? (
              <CommandEmpty>
                <span className="text-[var(--s-text-tertiary)] text-sm">{emptyMessage}</span>
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => {
                  const isSelected = selectedValues.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={String(option.value)}
                      disabled={option.disabled}
                      onSelect={() => handleSelect(option)}
                      className="cursor-pointer"
                    >
                      {option.glyph && (
                        <span className="mr-1.5 shrink-0">{option.glyph}</span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-[13px] text-[var(--s-text)]">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="block truncate text-[11px] text-[var(--s-text-tertiary)]">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {isSelected && (
                        <Icon
                          icon={Check}
                          size={14}
                          className="ml-2 shrink-0 text-[var(--scout-accent)]"
                        />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>

          {onCreateNew && (
            <>
              <CommandSeparator />
              <div className="p-1">
                <button
                  type="button"
                  onClick={handleCreateNew}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-[var(--scout-accent)] transition-colors hover:bg-[var(--scout-accent-50)]"
                >
                  <Icon icon={Plus} size={14} />
                  {resolvedCreateLabel}
                </button>
              </div>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
