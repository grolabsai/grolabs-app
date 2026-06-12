# Smoke tests

These tests open the important **authenticated** pages on a deployed environment
and fail if any hits the error boundary ("Something went wrong on this page").
They catch the class of bug that `npm run build` and `npm run typecheck` cannot —
a runtime render crash like a missing React provider (the
`AgentPanelProvider` admin crash on 2026-06-12 is the motivating example: build
was green, every admin page threw on load).

## What runs where

| Layer | Workflow | Catches |
|---|---|---|
| `typecheck` + `lint` + `build` | `.github/workflows/ci.yml` (every PR into `main`) | broken build, type regressions |
| Page-load smoke (this dir) | `.github/workflows/smoke.yml` (on demand + every 3h) | runtime render crashes on real pages |

The smoke tests hit **production by default** and authenticate through the real
email + password form (SSO can't be automated). They do not start the app.

## One-time setup (required before smoke tests do anything)

The workflow **skips itself** until these exist, so nothing goes red in the
meantime.

1. **Give the test account a password.** `tuncho@grolabs.ai` signs in with Google
   SSO; the smoke tests need a password instead. Set one in the Supabase
   dashboard (Authentication → Users → the user → set/reset password), and make
   sure the account is "settled" (not stuck on the forced password-change
   screen — log in once manually if it is).

2. **Add two GitHub repo secrets** (Settings → Secrets and variables → Actions):
   - `SMOKE_EMAIL` = `tuncho@grolabs.ai`
   - `SMOKE_PASSWORD` = that password

That's it. The next scheduled run (or a manual **Run workflow** from the Actions
tab) will start exercising the pages.

> Keep this a low-privilege, dedicated test login. It only needs to reach the
> pages — it never writes anything.

## Running locally

```bash
export SMOKE_EMAIL=tuncho@grolabs.ai
export SMOKE_PASSWORD=…              # not committed
# optional: point at a preview instead of production
# export ADMIN_URL=https://<preview>.vercel.app
# export APP_URL=https://<preview>.vercel.app
npm run test:smoke
```

## Adding a route

Edit `helpers.ts` → `ADMIN_PATHS` / `APP_PATHS`. Add any page whose breaking
would be a production incident. Keep the list short — this is "does the shell
render," not full coverage.
