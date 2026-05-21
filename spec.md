# GroLabs SSO — Login Screen Spec

A WordPress single sign-on plugin's login screen. The goal is to convert better than every existing WP SSO plugin (Nextend, miniOrange, Super Socializer, etc.) by being smarter about ordering, detection, and fallbacks. This document defines the layout, behavior, and admin-configurable surface area for the login screen only.

---

## 1. Layout structure

The login surface has **four tiers**, top-down. Each tier is configurable by the site admin but ships with a sensible default.

### Tier A — Primary providers (2 full-width buttons)
- Two stacked buttons, each spanning the full width of the form column.
- Layout per button: provider logo on the left, locale-aware label centered ("Continue with Google", "Continuar con Google", etc.), no trailing chevron.
- Buttons are visually weighty — these are the calls to action.

### Tier B — Secondary providers (3 icon-only buttons in a row)
- A single row of 3 equally-sized square buttons.
- Logo only, no label. Tooltip on hover/long-press shows the provider name in the user's locale.
- Visually lighter than Tier A but still clearly tappable (min 44×44px).

### Tier C — "Others" dropdown
- A single trigger that reads "More options" (locale-aware) with a small chevron.
- When open, reveals a vertical list of remaining enabled providers, each row showing **logo + name**.
- The user can always see the dropdown exists — never hidden behind a settings page.

### Tier D — Email / password fallback (collapsed by default)
- Below all provider buttons, a divider with the text "or" (locale-aware).
- A single link: "Sign in with email and password" (locale-aware).
- Clicking expands an inline form (email + password + sign in button) in place. No page navigation.
- Below the expanded form: "Forgot password?" and "Create account" links.

### Tier E — Passkey affordance (conditional, see §4)
- When the browser reports an available passkey for the site (WebAuthn conditional UI), passkey is **promoted to Tier A slot 1**, pushing the admin's #1 down to slot 2.
- When no passkey is detected, this tier is invisible — no greyed-out button, no placeholder.

---

## 2. Provider order — admin configuration

The site admin decides which providers are enabled and in what order. The plugin ships with a default order based on aggregate consumer-login data, but the admin can override completely.

### Default order (ship state)

| Slot | Provider | Tier | Notes |
|---|---|---|---|
| 1 | Google | A | Always shown, never hidden |
| 2 | Facebook | A | High-volume consumer provider |
| 3 | Apple | B | **Conditional: iOS/macOS only by default** |
| 4 | Microsoft | B | Strong in B2B, gaming, productivity |
| 5 | X (Twitter) | B | |
| 6 | LinkedIn | C (dropdown) | B2B leaning |
| 7 | GitHub | C | Developer audience |
| 8 | TikTok | C | |
| 9 | Discord | C | |
| 10 | Twitch | C | |
| 11 | Yahoo | C | |
| 12 | Amazon | C | |

### Admin controls
The admin settings page exposes, for each provider:
- **Enable / disable toggle**
- **Drag-handle reordering** (admin drags into Tier A, B, or C)
- **Per-provider visibility rules** (default-on for Apple-on-iOS, but admin can override)
- **OAuth credentials** (client ID / secret / redirect URL)

Tier A holds exactly 2. Tier B holds exactly 3. Any enabled provider beyond the first 5 falls into Tier C automatically. If the admin enables fewer than 5, Tier B shrinks gracefully (2 icons instead of 3, etc.); Tier A always shows 2 if at least 2 providers are enabled.

---

## 3. Smart ordering overlays

The admin's configured order is the **base**. The plugin applies up to three runtime overlays on top, in this order of precedence:

### 3.1 Last-used provider (highest priority)
- Stored in a 90-day first-party cookie + `localStorage` keyed by site.
- If the cookie names a provider that is currently enabled, that provider is moved to Tier A slot 1.
- A subtle pill renders next to the button: "Last used" (locale-aware).

### 3.2 Referrer / UTM detection
- On page load, the plugin reads `document.referrer` and the `utm_source` query param.
- If either resolves to a known provider domain (see §5), the matching provider is promoted to Tier A slot 1 — **only if the last-used cookie is absent**. Last-used wins.
- Example: visitor arrives from `facebook.com` with no prior login history → Facebook moves to slot 1, Google falls to slot 2.

### 3.3 Platform detection (Apple)
- Apple is shown only on Apple platforms (iOS, iPadOS, macOS Safari) by default.
- Admin can override to "always show" or "never show".
- When hidden, Apple does not occupy a slot — the next-priority provider fills in.

### 3.4 Passkey detection (overrides all)
- See §4. If a passkey is available, it takes Tier A slot 1 unconditionally, regardless of last-used, referrer, or order.

---

## 4. Passkey handling

Passkey adoption is at roughly 15% of US/EU consumers (FIDO Alliance, late 2025). For sites that prompt via WebAuthn conditional UI, 20–30% of returning users opt in. Passkeys are a **returning-user feature** — first-time visitors have nothing to authenticate against.

### Detection
- Use WebAuthn **conditional UI** (`navigator.credentials.get({ mediation: 'conditional' })`).
- The browser reports whether the user has a passkey for this site without any UI flash.
- If yes → promote passkey to Tier A slot 1.
- If no → do not render the passkey button at all. No greyed-out state, no "set up a passkey" prompt on the login screen (that lives in account settings).

### Visual
- Passkey button uses a fingerprint/key glyph (system-native where possible) + label "Sign in with a passkey".
- When the user focuses the email field in the password fallback, autofill suggestions surface their passkey natively — no separate button click needed.

### Enrollment
- Out of scope for the login screen. Enrollment happens post-login in account settings, with a one-time prompt after a successful password or social sign-in.

---

## 5. Provider source-detection table

How to identify that traffic likely originates from each provider. Used by the referrer/UTM overlay (§3.2). Order: most reliable signal first.

| Provider | UTM source values | Referrer domains | In-app browser UA hint |
|---|---|---|---|
| Google | `google`, `google_ads`, `gads` | `google.com`, `google.<tld>`, `googleadservices.com` | — |
| Facebook | `facebook`, `fb`, `meta` | `facebook.com`, `m.facebook.com`, `l.facebook.com` | `FBAN`, `FBAV` in UA |
| Instagram | `instagram`, `ig` | `instagram.com`, `l.instagram.com` | `Instagram` in UA |
| Apple | (no inbound traffic source, see §3.3) | — | iOS/iPadOS/macOS Safari UA |
| Microsoft | `microsoft`, `bing`, `outlook` | `bing.com`, `outlook.com`, `office.com`, `teams.microsoft.com` | — |
| X (Twitter) | `twitter`, `x` | `t.co`, `x.com`, `twitter.com` | `Twitter` in UA |
| LinkedIn | `linkedin`, `li` | `linkedin.com`, `lnkd.in` | `LinkedInApp` in UA |
| TikTok | `tiktok` | `tiktok.com`, `t.tiktok.com` | `BytedanceWebview`, `musical_ly` in UA |
| YouTube | `youtube`, `yt` | `youtube.com`, `m.youtube.com` | — (treated as Google) |
| GitHub | `github` | `github.com` | — |
| Discord | `discord` | `discord.com`, `discord.gg` | `Discord` in UA |
| Twitch | `twitch` | `twitch.tv` | — |
| Yahoo | `yahoo` | `yahoo.com`, `yahoo.<tld>` | — |
| Amazon | `amazon` | `amazon.com`, `amazon.<tld>` | — |
| Reddit | `reddit` | `reddit.com`, `redd.it` | `Reddit` in UA |
| Pinterest | `pinterest` | `pinterest.com`, `pin.it` | `Pinterest` in UA |
| Snapchat | `snapchat` | `snapchat.com` | `Snapchat` in UA |
| WhatsApp | `whatsapp` | (no referrer — WA strips it) | `WhatsApp` in UA |
| Telegram | `telegram` | (no referrer — TG strips it) | `Telegram` in UA |
| Email client | `email`, `newsletter` | various — fall through to no match | — |

### Reliability ranking
1. **UTM parameter** — explicit and stable. Best for paid/owned links.
2. **Referrer header** — works for organic clicks but unreliable: HTTPS→HTTP drops it, many apps strip it, in-app browsers lie.
3. **User-Agent in-app webview hint** — used for the in-app browser rescue (§6), not for ordering. Don't trust UA for "this is a Facebook user" — many people browse the FB app and would sign in with Google.

When UTM and referrer disagree, **UTM wins**. When neither is present, fall back to admin's configured order.

---

## 6. In-app browser rescue

Facebook, Instagram, and TikTok in-app browsers frequently break OAuth flows (the popup is blocked, the redirect is intercepted, or the system cookie store is sandboxed). This is the single biggest silent conversion killer on mobile.

### Detection
Check `navigator.userAgent` for the in-app webview hints in §5 (`FBAN`, `FBAV`, `Instagram`, `BytedanceWebview`, `musical_ly`, `LinkedInApp`).

### UI
- Render a non-dismissable banner above Tier A: "You're in the [Facebook/Instagram/TikTok] app. For sign-in to work, please open this page in your browser."
- Button: "Open in browser" — uses platform-specific deep links:
  - iOS: `x-safari-https://...` or Universal Link fallback
  - Android: `intent://...#Intent;scheme=https;package=com.android.chrome;end`
- Below the banner: a muted "Continue anyway" link that proceeds with the current flow, in case the user knows what they're doing.

---

## 7. Locale-aware labels

All visible text is locale-aware. The plugin ships with translations for the top 20 WordPress locales; provider names are translated where customary ("Continuar con Google" but "Continue with X").

### Detection
1. WordPress `get_locale()` server-side (authoritative for the page render).
2. `navigator.language` client-side as fallback / for runtime updates.
3. Admin can pin a default locale per site.

### Text inventory
| Key | en | es |
|---|---|---|
| `cta.continue_with` | Continue with {provider} | Continuar con {provider} |
| `cta.sign_in_passkey` | Sign in with a passkey | Iniciar sesión con clave de acceso |
| `cta.more_options` | More options | Más opciones |
| `cta.email_password` | Sign in with email and password | Iniciar sesión con correo y contraseña |
| `cta.forgot_password` | Forgot password? | ¿Olvidaste tu contraseña? |
| `cta.create_account` | Create account | Crear cuenta |
| `divider.or` | or | o |
| `pill.last_used` | Last used | Última usada |
| `inapp.banner` | You're in the {app} app. For sign-in to work, open this page in your browser. | Estás en la app de {app}. Para iniciar sesión, abre esta página en tu navegador. |
| `inapp.open_browser` | Open in browser | Abrir en el navegador |
| `inapp.continue_anyway` | Continue anyway | Continuar de todos modos |

---

## 8. Skeleton states / no layout shift

The login form must render at its **final size and position** on first paint, before any provider SDK loads.

- Tier A buttons render with their full label and logo immediately (logos are inlined SVG, not lazy-loaded).
- Tier B icons render with the logo immediately.
- Tier C dropdown trigger renders immediately.
- If a provider SDK fails to load (e.g. Google One Tap script is blocked), the button still works — it falls back to a server-side OAuth redirect.

**No spinners replacing buttons.** A button might briefly show a small inline spinner *next to* its label while the OAuth popup opens, but never replaces the button content.

---

## 9. Visual / interaction notes for the designer

These are hints — exact pixel values are the designer's call.

- **Tier A button height:** ~52px. Logo 20–24px, label 16px medium weight, label horizontally centered.
- **Tier B icon button:** 56×56px square, logo 24px centered, subtle border + background tint matching provider brand at ~8% opacity (so Facebook is faintly blue, Apple faintly grey, etc.) — *do not* use full brand colors as fills, it gets gaudy fast.
- **Tier C dropdown:** trigger is full-width, ~44px tall, left-aligned text + right-aligned chevron. Opens as an inline expansion (not a popover/modal) so the page doesn't reflow.
- **"Last used" pill:** small, ~10px text, muted background, sits to the right of the Tier A button label.
- **Spacing between tiers:** ~16px between Tier A buttons; ~24px between Tier A and Tier B; ~24px between Tier B and Tier C; ~32px between Tier C and the "or" divider.
- **In-app rescue banner:** full-width, warning-colored (amber/yellow at low saturation), icon + 2 lines of text + button. Sits above Tier A with ~16px gap.
- **Password fallback (expanded):** inline form below the email-password link, no modal. Fields use floating labels. Sign-in button is full-width but visually de-emphasized (outline or ghost style) so it doesn't compete with Tier A.

### Hierarchy intent
The visual weight order, top to bottom, is:
1. In-app rescue banner (when present) — loudest
2. Tier A buttons — primary CTAs
3. Tier B icons — secondary
4. Tier C dropdown — tertiary
5. "or" divider — visual break
6. Email/password link — quiet, but discoverable
7. Forgot / create account — quietest

Email/password is never the most prominent thing. The buttons always win the eye.

---

## 10. Out of scope (for this spec)

- Account-linking UX on email collision (will be a separate flow).
- Post-login enrollment prompts (passkey setup, etc.).
- The admin settings page UI itself (this spec only describes the user-facing login screen).
- Multi-factor / 2FA challenges after primary auth.
- Account recovery flows beyond the "Forgot password?" link.

---

## 11. Open questions

- **Tier B count when fewer than 5 providers are enabled:** does Tier B shrink to 2 icons, or do icons get promoted into a 3rd full-width Tier A button? Current spec says shrink; designer to validate.
- **Passkey conditional UI on Safari:** support is uneven across iOS versions. Decide whether to fall back to a button-triggered passkey flow on older Safari.
- **Email-only / magic-link option:** the current spec assumes traditional password is the fallback. Should we additionally offer a magic-link "email me a sign-in link" path, and where does it sit visually?
