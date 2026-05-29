# GroLabs SSO — WordPress plugin

Conversion-optimized social login for WordPress. Tiered button layout, smart ordering, locale-aware labels, in-app browser rescue, passkey support.

## Quick test (no WordPress needed)

Open `demo/index.html` in a browser — works via `file://`. The demo controls below the form let you:

- Switch locale (English / Español)
- Simulate platform (auto / iOS / Android / Windows) — watch Apple appear/disappear
- Swap preset orders (default / dev-focused / B2B / creator)
- Clear or set the "last-used" cookie — see the top button shift
- Paste a real Google OAuth Client ID to test live Google sign-in (the demo URL must be added to the client's "Authorized JavaScript origins" + "Authorized redirect URIs" in Google Cloud Console)

Append `?utm_source=facebook` (or `github`, `linkedin`, etc.) to the demo URL to simulate inbound referral traffic.

## What's working end-to-end

| Surface | Status |
|---|---|
| All 12 provider buttons render (Google, Facebook, Apple, Microsoft, X, LinkedIn, GitHub, TikTok, Discord, Twitch, Yahoo, Amazon) | ✅ |
| Tier A / Tier B / Tier C dropdown layout | ✅ |
| Last-used cookie + pill | ✅ |
| Referrer / UTM source detection | ✅ |
| Platform detection (Apple iOS/macOS-only by default) | ✅ |
| In-app browser rescue (FB / IG / TikTok / LinkedIn webviews) | ✅ |
| Locale-aware labels (en + es) | ✅ |
| Mobile keyboard handling (viewport shift) | ✅ |
| Passkey conditional UI on email field | ✅ |
| **Google OAuth — actual sign-in flow** | ✅ |
| **Username + password — submits to wp-login.php** | ✅ |
| Other 11 providers — buttons render, toast on click | ⚠ (UI only) |

## File layout

```
grolabs-sso/
├── grolabs-sso.php                ← plugin entry
├── README.md
├── assets/
│   ├── css/login-screen.css
│   ├── js/login-screen.js
│   └── provider-logos.svg         ← SVG sprite, used via <use href="#logo-..." />
├── demo/
│   └── index.html                 ← standalone browser demo
└── src/
    ├── Surfaces/LoginScreen.php   ← renders the surface on wp-login.php
    └── Auth/GoogleHandler.php     ← REST endpoint that verifies Google ID tokens
```

## Installing in WordPress

1. Copy the `grolabs-sso/` directory into `wp-content/plugins/`.
2. Activate **GroLabs SSO** in **Plugins**.
3. Set the Google client ID (no admin UI yet, so via wp-cli or DB):

   ```bash
   wp option update grolabs_sso_settings '{"google_client_id":"YOUR_ID.apps.googleusercontent.com"}' --format=json
   ```

4. In Google Cloud Console → OAuth client → add:
   - Authorized JavaScript origin: `https://yoursite.example`
   - Authorized redirect URI: `https://yoursite.example/wp-login.php`
5. Visit `wp-login.php` — you should see the GroLabs surface.

## How the layout works

| Tier | Layout | Default order |
|---|---|---|
| A | 3 full-width buttons (logo + label) | Google, Facebook, Apple |
| B | 5 icon-only buttons in a row | Microsoft, X, LinkedIn, GitHub, TikTok |
| C | Dropdown showing logo previews + "More" | Discord, Twitch, Yahoo, Amazon |
| D | Collapsed email/password fallback, expands inline (fixed-height container so the layout doesn't shift) | — |

Admins control which providers are enabled and in what order. Runtime overlays (applied on top of the admin order):

1. **Last-used cookie** — promotes the user's last successful provider to Tier A slot 1 with a "Last used" pill.
2. **UTM / referrer source** — if no last-used, traffic from `utm_source=facebook` or `referrer=facebook.com` promotes Facebook to slot 1.
3. **Platform rule** — Apple is hidden on Android/Windows by default (overrideable per-site).

## What's NOT in v0

- Admin settings page (read settings via `update_option` for now)
- OAuth flows for the 11 non-Google providers (buttons render and toast — wire them as-needed)
- Account-linking UX when the same email signs in with a second provider
- Post-login passkey enrollment prompt
- Magic-link email option

## Spec reference

See `../../spec.md` at the worktree root for the layout/behavior spec that was fed into the design pass. See `IMPLEMENTATION.md` (from the design tool's output) for the visual decisions that drove this build.
