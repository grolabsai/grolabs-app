---
application: core-app
module: Security
title: "Audit — auth surface, secrets, logging & dependencies (cluster 4)"
status: "Findings — 0 critical, 1 medium + observations"
owner: "Tuncho"
audience: "Anyone deciding whether GroLabs is safe to put a real customer on."
scope: "Cluster 4 of the M1 security audit: the authentication/session surface (middleware, login, OAuth callback, protected-layout gates, forced password change), secret handling, PII in logs, and dependency vulnerabilities. Executed 2026-08-02 against main @ c616c18; npm audit run against the installed tree."
---

# Audit — auth surface, secrets, logging & dependencies

**Verdict:** the authentication surface and secret hygiene are **solid** — this
is the cleanest cluster. One medium finding (known-vulnerable dependencies, most
auto-fixable) and a handful of observations, none of which block M1 with a
single trusted customer.

---

## What is built correctly (auth & secrets)

- **Session validation uses `getUser()`, not `getSession()`.** The middleware
  and every layout call `supabase.auth.getUser()`, which verifies the JWT with
  the auth server rather than trusting the cookie contents. This is the correct
  choice and easy to get wrong.
- **Auth enforcement is layered and deliberate.** Middleware refreshes the
  session and separates host surfaces; the `(app)` and `(admin)` layouts do the
  actual gating (`redirect("/login")` when logged out, `isGroLabsAdmin()` for
  admin, `NoAccess` for orphan accounts with no memberships). Documented in
  CLAUDE.md §13 and matches the code.
- **Forced password change is correctly scoped.** The `(app)` layout redirects
  `must_change_password` users to `/cambiar-contrasena`, but **only for password
  sessions** — it reads the JWT `amr` claim via `wasPasswordSession`
  (`session-method.ts`), so SSO users (who have no password to rotate) aren't
  trapped. Thoughtful.
- **OAuth callback stays same-origin.** `/[locale]/auth/callback` redirects to
  `next` only after forcing a leading `/`; `//evil.com` and `https://evil.com`
  both resolve to a path on the app's own origin, so it is not an open redirect.
- **No committed secrets.** `git grep` for JWT/service-role/`sk-` patterns
  outside docs returns nothing. Only `sample.env` is tracked, and it is a pure
  placeholder template. `.env` / `.env.local` are gitignored.
- **No secret exposure to the client.** No `NEXT_PUBLIC_*` var carries a secret
  (only the anon key + URL + build SHA, all safe by design).
- **No secret or PII logging.** Every `console.error` near a secret logs its
  *absence* ("X is not set") or an `error.message` — never a key, token, email,
  or request body. Checked exhaustively.

---

## FINDING 7 — MEDIUM: known-vulnerable dependencies

**Status:** open · **Severity:** medium (mostly auto-fixable)

`npm audit --omit=dev` reports **9 vulnerabilities (6 high, 2 moderate, 1 low)**
in the production tree:

| Package | Severity | Fix | Note |
|---|---|---|---|
| `next` | high | `npm audit fix` (non-major) | the framework itself |
| `sharp` | high | auto | image processing (blog covers) |
| `undici` | high | auto | cross-user cache disclosure (transitive HTTP) |
| `ws` | high | auto | memory disclosure / DoS |
| `postcss` | high | auto | transitive build dep |
| **`xlsx`** | **high** | **NONE** | prototype pollution + ReDoS |
| `dompurify` | moderate | auto | **the blog XSS defense depends on this** |
| `next-intl` | moderate | auto | |
| `icu-minify` | low | auto | |

Two points that raise this above routine:

1. **`dompurify` (moderate) is load-bearing.** Cluster 3 credited the blog HTML
   path for correct sanitization — that entire defense is DOMPurify. A known
   bypass advisory against it directly weakens a control this audit relied on.
   Upgrade it, don't defer.
2. **`xlsx` (high) has no fix available** and sits in the import path
   (`src/lib/import/xlsx.ts`), which parses **attacker-supplied spreadsheet
   files**. Prototype pollution + ReDoS from a crafted `.xlsx` is reachable by
   whoever can upload an import file. Mitigated today because import is
   authenticated (tenant users) — but a beta client uploading a malicious sheet
   is exactly the M1 trust boundary.

### Fix

- Run `npm audit fix` now — 8 of 9 are non-major and low-risk (this is the
  `next`, `dompurify`, `undici`, `ws`, `sharp`, `postcss`, `next-intl`,
  `icu-minify` set). Re-run `npm run build` + `npm test` after.
- Decide on `xlsx` separately: migrate to a maintained parser (e.g. `exceljs`),
  or keep it but harden the import path (size/време limits, run parsing with a
  null-prototype guard) and document the accepted risk. Given import is
  authenticated and low-frequency, "harden + document for M1, replace for M2" is
  defensible — but write it down.

---

## Observations (lower severity / to verify)

**O-7 — the SSO email allowlist is enforced OUTSIDE the repo.** Per
`user-management.md`, Google/Microsoft sign-ins are restricted to pre-created
emails via a Supabase **Before-User-Created auth hook**. The repo *writes* the
`signup_allowlist` table (`users.ts:130`) but the actual rejection of unknown
emails is a Supabase-side hook that **cannot be verified from the codebase**.
The app-side backstop is real — the `(app)`/`(admin)` layouts render `NoAccess`
and nothing is reachable for an account with no memberships — so an
un-allowlisted SSO user gets an inert account, not access. **Action:** confirm
the Before-User-Created hook is actually enabled in the production Supabase
project; without it, any Google/Microsoft user can create a (dead-end) account,
which is account-table noise and a small abuse vector, not a data breach.

**O-8 — forced password change & instance gating are layout-enforced, not
action-enforced.** Same structural point as cluster-2 Finding 4: layouts gate
page rendering, but server actions / API routes are independently invocable. A
user with `must_change_password = true` could, in principle, call server actions
before rotating their temporary password. Low impact — they are a legitimate
provisioned user, self-scoped by RLS — but the temp password is meant to be
single-use. Worth a shared server-side guard if convenient.

**O-9 — password policy is length-only.** `isStrongEnough` checks
`length >= 10` and nothing else — no complexity, no breach-list (HIBP) check.
Ten characters is a reasonable MVP floor; noted so it's a conscious choice, not
an oversight.

**O-10 — login error message travels in the URL.** `signInWithPassword` failures
redirect to `/login?error=<raw supabase message>`. The UI renders a generic
translated string, so nothing sensitive is shown, and Supabase returns a generic
"Invalid login credentials" for both bad-password and unknown-user (limiting
enumeration). Minor; could drop to an opaque code.

---

## What this cluster did NOT cover

- **The Supabase project's own configuration** — auth hooks (O-7), RLS toggles,
  PITR/backups, Vault setup, network restrictions. These live in the Supabase
  dashboard, not the repo, and must be verified there. The go-live checklist's
  "Production Supabase decided" P0 tracks this.
- **Cal.com / Klaviyo / PostHog webhook signature depth** — the Cal.com webhook
  HMAC was noted in cluster 1; not re-fuzzed here.
- **Runtime dependency behavior** — the audit is advisory-database-based, not a
  behavioral test of each CVE.
- **CSRF** — Next.js server actions carry built-in origin checks; not separately
  exercised.

---

## Recommendation

- **Finding 7:** run `npm audit fix` before onboarding (cheap, mostly non-major),
  prioritizing `dompurify` since a control this audit trusted depends on it.
  Make an explicit call on `xlsx`.
- **O-7:** verify the Supabase Before-User-Created hook is live in production —
  it's the primary SSO gate and it isn't in the code.

Nothing in this cluster blocks M1 with a single trusted customer.
