"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * Topbar. Contains:
 *   - Global search box (visual only in Phase 1 — ⌘K palette is deferred)
 *   - User avatar → opens a tiny menu with Sign Out
 *
 * The breadcrumb lives inside each page, not in the topbar, because
 * breadcrumbs are page-scoped and can get complex (product editor shows
 * category in the trail, etc.).
 */
export function TopBar({
  initials,
  userEmail,
}: {
  initials: string;
  userEmail: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
          justifyContent: "flex-end",
        }}
      >
        <div className="s-search">
          <svg
            className="s-search-icon"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            type="text"
            placeholder="Buscar productos, SKUs…"
            // ⌘K palette deferred — the input is visual/passive for now
            disabled
          />
          <kbd>⌘K</kbd>
        </div>

        <button
          className="s-user"
          onClick={() => setMenuOpen((v) => !v)}
          title={userEmail}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {initials}
        </button>

        {menuOpen ? (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: 52,
              right: 28,
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
              minWidth: 200,
              padding: 6,
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              zIndex: 10,
            }}
          >
            <div
              style={{
                padding: "8px 10px",
                fontSize: 11,
                color: "var(--s-text-tertiary)",
                fontFamily: "var(--s-font-mono)",
                borderBottom: "0.5px solid var(--s-border)",
                marginBottom: 4,
                wordBreak: "break-all",
              }}
            >
              {userEmail}
            </div>
            <button
              onClick={signOut}
              className="s-btn s-btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start" }}
            >
              Cerrar sesión
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
