Status: Deferred (directional, NOT locked)
Owner: Tuncho
Scope: How the GroLabs web app (`web-apps/app`) is tested — CI + local
Audience: Whoever picks testing back up

# Testing approach — deferred, and how to take it up again

## TL;DR

On **2026-06-11** we deliberately **turned off CI tests** because the suite had
become a mess and was blocking real work. Nothing was deleted — the tests are
parked, not gone. This doc records *what we did*, *why*, and *a concrete plan to
resume* so we don't have to reconstruct the context later.

## What's true right now

- `.github/workflows/test.yml` runs on **manual dispatch only**. The
  `pull_request` and `push` triggers are **commented out**, not removed.
  → So PRs no longer show a red "Test" check, and merges no longer wait on it.
- **All tests still exist and still run locally:**
  - `npm test` — unit suite (vitest, ~19 files under `tests/unit/`)
  - `npm run test:integration` — one Meilisearch search test (`tests/integration/`)
- Branch protection on `main` may still *list* the old `unit` / `integration`
  checks as required, so merging a PR can still need `gh pr merge --admin`. The
  workflow simply no longer produces those checks. (Removing the required-check
  rules in GitHub branch-protection settings is a separate, optional cleanup.)

## Why we deferred instead of fixing

- The unit suite had ~11 **pre-existing failures** in the prospectos v5
  diagnostic scorers (`tests/unit/diagnostic/v5/**`) — e.g. `after() was called
  outside a request scope`, and several scorer assertions drifted from the code.
- Because the integration job is gated `needs: unit`, those failures **blocked
  the integration test from running at all**, reddened every PR, and forced
  `--admin` merges.
- The failing tests are **diagnostic logic** tests, not "web page" tests — and
  there is **no page-level / end-to-end test harness** for the app yet. Patching
  the v5 tests piecemeal wouldn't fix the actual gap, so we chose to redesign the
  whole approach later rather than keep band-aiding.

## What we'd actually want (direction, not decided)

The real gap is **page-level confidence** — "does this screen render and work?" —
which the current logic-only unit suite never covered. Likely shape when we
resume:

1. **Page/E2E verification with Playwright.** Playwright is *already installed*
   (`^1.60.0`) but currently used only as a **scraping library** inside the
   diagnostic code (`src/lib/diagnostic/**`). There is no `playwright.config`, no
   `e2e/` directory, no browser test runner wired up. This session already proved
   the pattern by hand: boot the dev server, drive `/login`, screenshot, assert.
   Formalizing that into a small Playwright E2E suite is the most direct win.
   - Note the local gotchas found this session: dev server runs on **port 3030**
     (not 3000), and the app needs `.env.local` (Supabase URL + anon key) or the
     middleware crashes before any page renders.
2. **Triage the v5 diagnostic unit tests** — for each failing test, decide
   *fix* (the test is right, the code regressed) or *drop* (the test drifted /
   tested removed behavior). Don't blanket-delete; they encode real rubric logic.
3. **Re-gate CI intentionally** — only after the suite is green, uncomment the
   `pull_request` + `push` triggers in `test.yml`. Consider splitting "fast unit"
   (always) from "integration/E2E" (main + nightly) so a slow or flaky tier never
   blocks PRs again.

## How to resume — checklist

- [ ] Run `npm test` locally and capture the current failing list (it will have
      drifted from the ~11 above).
- [ ] For each failure: fix-or-drop (see #2). Get `npm test` green.
- [ ] Decide whether to add a Playwright E2E tier (see #1). If yes: add
      `playwright.config.ts`, an `e2e/` dir, and a `test:e2e` npm script; cover
      the highest-value flows first (login, create customer, the per-tenant user
      editor).
- [ ] Re-enable CI: uncomment the two triggers in
      `.github/workflows/test.yml`; consider the fast/slow split above.
- [ ] If branch protection still lists stale required checks, reconcile them in
      GitHub settings so green merges don't need `--admin`.
- [ ] Delete this "deferred" framing once testing is back on its feet.

## Pointers

- CI workflow: `.github/workflows/test.yml`
- Tests: `tests/unit/**`, `tests/integration/**`
- Current-state snapshot: `docs/state/in-flight.md` → "Testing approach — deferred"
- The decision to disable: PR #206.
