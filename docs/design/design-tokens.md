# GroLabs Design Tokens — the shared contract

Status: **Applied** — the `--gl-*` names below are now the real tokens in
`src/app/globals.css`. The "Current name in code" columns record the *old*
names (pre-unification) for historical reference only; they no longer exist in
the codebase. Align Claude Design to the `--gl-*` names.

## Why this doc exists

The GroLabs design system lives in **two places that must agree**:

1. **Claude Design** — where you design and decide colors/styles.
2. **The repo** (`src/app/globals.css`) — where those colors actually run in the
   product.

When the two use *different names* for the same thing, a fix made in Design
silently fails to land in code. This doc is the **single dictionary** both sides
use. One name per thing. Change a value here → change it in `globals.css` → the
product and the in-app `/styleguide` page both update together.

## The naming rule

**Everything shared between Design and code is named `--gl-*` (GroLabs).** No app
codename (`scout`, `rre`) and no leftover initials (`s-`) in any shared token.
The name describes the *role* (`--gl-surface`, `--gl-text`, `--gl-accent`), so it
never has to change when an internal codename changes.

Today the repo has three prefixes for historical reasons — `--s-*` (was `bl-`
from the old "Bloom" project name), `--rre-*` (the accent, was `--scout-*`), and
`--gl-*` (already GroLabs, for "fixed" tokens). This contract folds **all three
into one `--gl-*` vocabulary.**

### What is NOT renamed

- **shadcn variables** (`--background`, `--primary`, `--border`, `--ring`, …).
  These names are required by the shadcn/Radix UI library — a third-party
  contract. They stay, and continue to derive their values from the `--gl-*`
  tokens.
- **Internal-only code** Design never sees (TypeScript types, function names,
  the package name). Those can keep the `rre` codename — they're not shared.

---

## 1. Accent — "Kinetic Yellow"

The product's single accent hue. **Value unchanged** (`#fae194`); only the name
moves from `--rre-accent*` → `--gl-accent*`.

| GroLabs name (proposed) | Role | Value | Current name in code |
|---|---|---|---|
| `--gl-accent` | Primary accent (yellow) | `#fae194` | `--rre-accent` |
| `--gl-accent-hover` | Hover state | `#fcebab` | `--rre-accent-hover` |
| `--gl-accent-50` | Faintest tint (selected-row bg) | `#fff8e0` | `--rre-accent-50` |
| `--gl-accent-100` | Light tint | `#fdeec4` | `--rre-accent-100` |
| `--gl-accent-600` | Alias → `--gl-accent` | `#fae194` | `--rre-accent-600` |
| `--gl-accent-800` | Alias → `--gl-accent` | `#fae194` | `--rre-accent-800` |
| `--gl-accent-on` | Text/icon **on** a yellow fill | `#131316` | `--rre-accent-on` |

### Gap to fix: darker gold for accents on white

Your Claude Design style guide defines a **darker-gold ramp for accent elements
on light backgrounds** — because pale `#fae194` is nearly invisible on white.
**Now added to the product** (`src/app/globals.css`); this is the real fix for
the "washed-out yellow" on light screens.

| GroLabs name | Role | Value | Status |
|---|---|---|---|
| `--gl-accent-on-light` | Accent text/border on white | `#a17914` | **in code** |
| `--gl-accent-on-light-soft` | Softer variant | `#b8901a` | **in code** |
| `--gl-accent-on-light-strong` | Strongest variant | `#8a6516` | **in code** |

---

## 2. Fixed tokens — identical in light AND dark

These never flip with the theme (app shell, landing CTAs, the white search
pill). **Already named `--gl-*`** — no change, listed for completeness.

| GroLabs name | Role | Value |
|---|---|---|
| `--gl-accent-fixed` | Always-yellow accent | `#fae194` |
| `--gl-accent-fixed-on` | Dark text on the above | `#131316` |
| `--gl-bg-fixed-dark` | Canvas tone that never lightens | `#131316` |
| `--gl-text-fixed-light` | Bone-white that never darkens | `#EDEAE0` |
| `--gl-header-bg-fixed` | Topbar surface (both themes) | `#1a1a1f` |
| `--gl-header-border-fixed` | Topbar border | `rgba(255,255,255,0.06)` |
| `--gl-search-bg-fixed` | Search pill (both themes) | `#ffffff` |
| `--gl-search-text-fixed` | Text in search pill | `#131316` |
| `--gl-search-placeholder-fixed` | Search placeholder | `#888780` |

---

## 3. Surfaces & borders — theme-flipping

These have **two values**: dark (default) and light (`.gl-light`, renamed from
`.rre-light`). Surfaces never nest as darker tints — `surface-alt` equals
`surface` on purpose; hierarchy comes from borders/shadows, not gray fills.

| GroLabs name (proposed) | Role | Dark | Light | Current name |
|---|---|---|---|---|
| `--gl-bg` | Page canvas | `#131316` | `#FAFAF9` | `--s-bg` |
| `--gl-bg-deeper` | Recessed section | `#0E0E11` | `#F2F2F0` | `--s-bg-deeper` |
| `--gl-surface` | Cards / inputs | `#1c1d24` | `#FFFFFF` | `--s-surface` |
| `--gl-surface-alt` | Alias → surface | `#1c1d24` | `#FFFFFF` | `--s-surface-alt` |
| `--gl-surface-hover` | Hover surface | `#22232a` | `#EFEFEE` | `--s-surface-hover` |
| `--gl-border` | Default border | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` | `--s-border` |
| `--gl-border-strong` | Stronger border | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.16)` | `--s-border-strong` |

---

## 4. Text — theme-flipping

| GroLabs name (proposed) | Role | Dark | Light | Current name |
|---|---|---|---|---|
| `--gl-text` | Body text (bone, not pure white) | `#EDEAE0` | `#1A1A1A` | `--s-text` |
| `--gl-text-strong` | Headlines / strong | `#FFFFFF` | `#000000` | `--s-text-strong` |
| `--gl-text-secondary` | Secondary | `rgba(237,234,224,0.6)` | `#5F5E5A` | `--s-text-secondary` |
| `--gl-text-tertiary` | Tertiary | `rgba(237,234,224,0.4)` | `#888780` | `--s-text-tertiary` |
| `--gl-text-muted` | Muted | `rgba(237,234,224,0.28)` | `#B4B2A9` | `--s-text-muted` |

---

## 5. Sidebar / nav — stays dark in BOTH themes

The sidebar is the brand frame; it does not flip to light.

| GroLabs name (proposed) | Role | Value | Current name |
|---|---|---|---|
| `--gl-nav-surface` | Sidebar background | `#0E0E11` | `--nav-surface` |
| `--gl-nav-border` | Sidebar border | `rgba(255,255,255,0.06)` | `--nav-border` |
| `--gl-nav-text` | Inactive item | `rgba(237,234,224,0.6)` | `--nav-text` |
| `--gl-nav-text-hover` | Hover item | `#ffffff` | `--nav-text-hover` |
| `--gl-nav-text-muted` | Section headers / footer | `rgba(255,255,255,0.45)` | `--nav-text-muted` |

---

## 6. Status colors — theme-flipping

| GroLabs name (proposed) | Dark | Light | Current name |
|---|---|---|---|
| `--gl-success` | `#10b981` | `#1D9E75` | `--s-success` |
| `--gl-success-bg` | `rgba(16,185,129,0.12)` | `#E1F5EE` | `--s-success-bg` |
| `--gl-success-text` | `#34d399` | `#085041` | `--s-success-text` |
| `--gl-danger` | `#ef4444` | `#A32D2D` | `--s-danger` |
| `--gl-danger-bg` | `rgba(239,68,68,0.12)` | `#FCEBEB` | `--s-danger-bg` |
| `--gl-danger-text` | `#fca5a5` | `#501313` | `--s-danger-text` |
| `--gl-warning` | `#f59e0b` | `#B27A00` | `--s-warning` |
| `--gl-warning-bg` | `rgba(245,158,11,0.12)` | `#FBEFD3` | `--s-warning-bg` |
| `--gl-warning-text` | `#fbbf24` | `#5D3F00` | `--s-warning-text` |

---

## 7. Probe hues — diagnostic check color-coding

Muted categorical palette; same value in both themes.

| GroLabs name (proposed) | Hue | Value | Current name |
|---|---|---|---|
| `--gl-probe-pdp` | amber | `#E5B567` | `--s-probe-pdp` |
| `--gl-probe-category` | teal | `#5FB6A6` | `--s-probe-category` |
| `--gl-probe-homepage` | violet | `#A98EDA` | `--s-probe-homepage` |
| `--gl-probe-site-wide` | blue | `#6E9BD6` | `--s-probe-site-wide` |
| `--gl-probe-search` | rose | `#D98AA6` | `--s-probe-search` |

---

## 8. Radii & fonts

| GroLabs name (proposed) | Value | Current name |
|---|---|---|
| `--gl-radius-sm` | `6px` | `--s-radius-sm` |
| `--gl-radius-md` | `8px` | `--s-radius-md` |
| `--gl-radius-lg` | `12px` | `--s-radius-lg` |
| `--gl-radius-xl` | `16px` | `--s-radius-xl` |
| `--gl-font` | Hanken Grotesk (body) | `--s-font` |
| `--gl-font-brand` | Permanent Marker (brand mark + H2) | `--s-font-brand` |
| `--gl-font-mono` | ui-mono (eyebrow labels) | `--s-font-mono` |

---

## 9. Theme & local-contrast classes

| GroLabs name (proposed) | Role | Current name |
|---|---|---|
| `.gl-light` | Light-theme container | `.rre-light` |
| `.on-light-surface` | Flip text dark for one subtree on a light fill | unchanged |
| `.on-dark-surface` | Flip text light for one subtree on a dark fill | unchanged |

---

## How we stay coordinated (the workflow)

1. **You** design/decide in Claude Design, naming things with the `--gl-*` names
   above.
2. **You** hand me the change ("`--gl-accent-on-light` should be `#b8901a`").
3. **I** change that one token in `globals.css`. The product **and** the in-app
   `/styleguide` page update together — they read the same token.
4. The **in-app `/styleguide` page is the live mirror** of the product (it
   renders the real tokens), so it can never drift. Bookmark it as the canonical
   visual reference; the Claude Design file is the design sketchpad.

No separate style-guide repo. One dictionary (this doc), one set of tokens
(`globals.css`), one live mirror (`/styleguide`).
