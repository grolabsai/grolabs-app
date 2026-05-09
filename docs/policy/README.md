# Scout — Policy documents

Authoritative specs for feature surfaces. Read the relevant policy doc
**before** writing any code in its scope. Decisions inside a policy doc
are locked — if implementation reveals a flaw, raise it as a question
rather than working around it.

## Active policies

- **search-foundations.md** — Stages 0 & 1 of the Scout search roadmap.
  Foundations (Meilisearch Cloud project, token-issuing endpoint, admin
  connection status) and basic search live on Wazú (indexing pipeline,
  WordPress plugin v0.1, two-button variable-product cards). Owner:
  Tuncho.

## Conventions

- One policy doc per feature surface, named `<feature>.md`.
- Each doc opens with `Status:`, `Owner:`, `Scope:`, `Audience:` lines.
- Sections labeled **APPROVAL REQUIRED** are hard checkpoints — stop
  and wait for explicit approval before proceeding.
- Out-of-scope items are listed at the bottom and pointed at the future
  policy doc that will own them (e.g. `search-events.md` for Stage 4).
- When a policy is superseded, change `Status:` to `Superseded by
  <new-doc>.md` rather than deleting it — the history matters.

## Adding a new policy doc

1. Draft the doc in `docs/policy/<feature>.md` with the standard
   frontmatter.
2. Add a one-line entry to the "Active policies" section above.
3. Add a one-line entry under "Active policy docs" in CLAUDE.md
   section 18.
4. Open a PR labeled as documentation-only.
