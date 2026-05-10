"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { InstanceSwitcher, type InstanceListItem } from "./InstanceSwitcher";
import { cn } from "@/lib/utils";

/**
 * Scout topbar.
 *
 * Rebuilt on shadcn primitives:
 *   - shadcn Input for the search box (visual/disabled in Phase 1)
 *   - shadcn DropdownMenu for the user avatar menu
 *   - lucide-react icons (Search, LogOut)
 *
 * Visual outcome is identical to the previous version:
 *   right-aligned search box + initials avatar that opens a sign-out menu.
 *
 * TODO (follow-up): replace useRouter with @/i18n/routing once all
 * redirect calls are migrated to locale-aware navigation.
 */
export function TopBar({
  initials,
  userEmail,
  instances,
  currentInstanceId,
}: {
  initials: string;
  userEmail: string;
  instances: InstanceListItem[];
  currentInstanceId: number | null;
}) {
  const t = useTranslations("topbar");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div style={{ position: "relative", padding: "14px 28px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        {/* Instance switcher — left side, where the agent panel never lives */}
        <InstanceSwitcher
          instances={instances}
          currentInstanceId={currentInstanceId}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

        {/* Search — visual only in Phase 1, ⌘K palette deferred */}
        <div className="s-search">
          <Search
            className="s-search-icon"
            size={13}
            strokeWidth={1.5}
          />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            disabled
            // Override shadcn Input styles to match the existing s-search input
            className={cn(
              "h-8 pl-8 pr-8 text-xs",
              "bg-[var(--s-surface-alt)] border-transparent",
              "focus-visible:bg-[var(--s-surface)] focus-visible:border-[var(--s-border-strong)]",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
              "disabled:opacity-100 disabled:cursor-default",
              "rounded-[var(--s-radius-md)]",
            )}
          />
          <kbd
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 10,
              padding: "2px 5px",
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: 4,
              color: "var(--s-text-tertiary)",
              fontFamily: "inherit",
              pointerEvents: "none",
            }}
          >
            ⌘K
          </kbd>
        </div>

        <LocaleSwitcher />

        {/* User avatar → DropdownMenu */}
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="s-user"
              title={userEmail}
              aria-label={t("userMenu", { email: userEmail })}
            >
              {initials}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-52"
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            }}
          >
            <DropdownMenuLabel
              className="text-[11px] font-normal break-all"
              style={{
                color: "var(--s-text-tertiary)",
                fontFamily: "var(--s-font-mono)",
              }}
            >
              {userEmail}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={signOut}
              className="cursor-pointer text-[13px] gap-2"
              style={{ color: "var(--s-text-secondary)" }}
            >
              <LogOut size={13} strokeWidth={1.5} />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
