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
import { ThemeSwitcher } from "./ThemeSwitcher";
import { cn } from "@/lib/utils";

/**
 * GroLabs topbar.
 *
 * Layout (left → right):
 *   [Search]                                [Locale][Theme][Avatar]
 *
 * The instance switcher used to live on the left here; it moved into
 * the sidebar (top, below the logo) so the topbar now has one
 * obvious left-side affordance — the search — and the right cluster
 * carries account/preferences. The instances/currentInstanceId props
 * were removed since the switcher is no longer rendered here.
 */
export function TopBar({
  initials,
  userEmail,
}: {
  initials: string;
  userEmail: string;
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
    <div
      style={{
        position: "relative",
        padding: "12px 28px",
        // App-shell band — fixed dark tone in both themes, like the
        // sidebar. Reads as part of the chrome, not the content.
        background: "var(--gl-header-bg-fixed)",
        borderBottom: "1px solid var(--gl-header-border-fixed)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        {/* Search — left-aligned, takes the slot the instance switcher
            used to occupy. White pill in both themes (--gl-search-bg-fixed).
            Visual-only in Phase 1 (⌘K palette deferred). */}
        <div className="s-search" style={{ maxWidth: 420, flex: "1 1 280px" }}>
          <Search
            className="s-search-icon"
            size={13}
            strokeWidth={1.5}
            style={{ color: "var(--gl-search-placeholder-fixed)" }}
          />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            disabled
            style={{
              background: "var(--gl-search-bg-fixed)",
              color: "var(--gl-search-text-fixed)",
              borderColor: "transparent",
            }}
            className={cn(
              "h-8 pl-8 pr-8 text-xs font-semibold",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
              "disabled:opacity-100 disabled:cursor-default",
              "rounded-[var(--s-radius-md)]",
              "placeholder:text-[color:var(--gl-search-placeholder-fixed)] placeholder:font-normal",
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
              background: "rgba(0,0,0,0.06)",
              border: "0.5px solid rgba(0,0,0,0.08)",
              borderRadius: 4,
              color: "var(--gl-search-placeholder-fixed)",
              fontFamily: "inherit",
              pointerEvents: "none",
            }}
          >
            ⌘K
          </kbd>
        </div>

        {/* Right cluster: locale + theme + avatar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LocaleSwitcher />
          <ThemeSwitcher />

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
