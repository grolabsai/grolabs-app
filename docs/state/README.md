# GroLabs — System state

These documents describe GroLabs's current shape. They are updated at the
end of every PR that changes module state, schema, or open work.

- **modules.md** — what each module does, its routes, its actions, its
  gaps. Includes a deeper "Catalog → Products" sub-section covering
  variants and the manufacturer field.
- **schema.md** — every table, its columns, its relationships, its RLS
  shape. Generated from `information_schema`, `pg_policies`,
  `pg_constraint`, `pg_indexes`, and `pg_trigger`.
- **in-flight.md** — open PRs, active branches, known issues and debt.

## Update protocol

At the end of each PR:
1. If module state changed (route added, server action added/removed,
   read-only → CRUD, etc.): update the relevant section of
   **modules.md**.
2. If schema changed (migration ran, new table/column/policy/trigger):
   update **schema.md** — re-query the affected tables from the live
   DB rather than transcribing from the migration, since the live DB is
   the source of truth.
3. Add or remove items from **in-flight.md**:
   - PR opened → add to "Open PRs" table.
   - PR merged → remove from "Open PRs"; mark the branch as "merged,
     can be deleted" in "Active branches"; remove any debt items the PR
     resolved.
   - New TODO/FIXME left in code → add to "Code-level (TODO comments)".
4. Bump the "Generated YYYY-MM-DD" line at the top of any file you
   touched.

## Reading this for context

Web/desktop Claude does not have file access. To bring it up to speed
on GroLabs, paste the relevant sections of these files at the start of a
conversation. **modules.md** alone is usually enough for feature-scoping
conversations; add **schema.md** when database changes are involved;
add **in-flight.md** when the question touches what's currently being
worked on.

A typical context-handoff prompt looks like:

> I'm working on GroLabs. Current state: [paste modules.md]. Schema for
> the relevant domain: [paste the schema.md sections that matter]. The
> work in flight: [paste the relevant rows of in-flight.md].
>
> Question / task: …

For full repo context, also include **CLAUDE.md** (conventions) and the
relevant `docs/funnel/spec.md` / `docs/funnel/prototype.tsx.reference`
when the funnel is in scope.
