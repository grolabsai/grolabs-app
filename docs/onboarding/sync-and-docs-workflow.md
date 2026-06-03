---
application: core-app
module: Onboarding
title: "Sync & Docs Workflow"
status: Draft
audience: "The GroLabs developer keeping local repos current and reading all docs from one Obsidian vault, without navigating GitHub or the terminal."
scope: "Local-machine workflow: the grolabs-sync.sh fast-forward script across the four repos and the Obsidian vault of symlinks that aggregates their docs. Excludes any CI/deploy concern."
actors:
  - name: Developer
    type: human
    definition: "The single developer running the sync script and reading docs in Obsidian; merges PRs in the GitHub UI and keeps local checkouts fresh."
  - name: grolabs-sync.sh
    type: system
    definition: "Local script that, per repo, skips if main has uncommitted tracked changes, fetches origin, checks out main, pulls --ff-only, and reports new commits. Only ever fast-forwards — no resets, stashes, or force ops; untracked files preserved."
  - name: Obsidian vault
    type: system
    definition: "Dedicated vault at /Users/sasu/code/grolabs-obsidian-vault aggregating docs from all four repos via symlinks into the live checkouts; not a git repo, not committed."
integrations:
  - name: GitHub repos
    kind: external-service
    target: "grolabs-app, grolabs-wordpress-ga4, grolabs-wordpress-login, grolabs-wordpress-search (origin/main)"
    direction: in
    purpose: "Source of truth the sync script fast-forwards local main onto after PRs are squash-merged in the GitHub UI."
  - name: Obsidian
    kind: external-service
    target: "grolabs-obsidian-vault (symlinks)"
    direction: in
    purpose: "Reading surface; because entries are symlinks into live checkouts, running the sync script alone refreshes the vault — no copy step."
rules:
  - id: R-1
    statement: "The sync script only ever fast-forwards local main to origin/main — never resets, stashes, or force operations — and skips any repo with uncommitted tracked changes, so local work is never destroyed."
    truth: true
    rationale: "'The sync script' section; it is safe to run unattended."
  - id: R-2
    statement: "Untracked files do not block a sync and are preserved."
    truth: true
    rationale: "'The sync script' section."
  - id: R-3
    statement: "Running the sync script switches a repo to main; a feature branch checked out in a primary clone will be moved to main (the branch and commits remain untouched and can be checked out again)."
    truth: true
    rationale: "Caveats section."
  - id: R-4
    statement: "The vault's symlinks are local-only, point at absolute /Users/sasu/code/... paths, and must be recreated when setting up a new machine."
    truth: true
    rationale: "Caveats: symlinks are local-only; new machine = recreate the links."
  - id: R-5
    statement: "The Login plugin symlinks both docs/ and README.md because it keeps a substantial top-level README; GA4 and Search have no docs/ folder, so only readme.txt + README.md are linked."
    truth: true
    rationale: "Caveats section detailing per-plugin symlink layout."
useCases:
  - id: T-1
    title: "Refresh all repos after a merge"
    given: "A PR has just been squash-merged on GitHub and local checkouts are stale"
    when: "The developer runs grolabs-sync"
    then: "Each repo's local main fast-forwards to origin/main and the new commits are reported; repos with uncommitted tracked changes are skipped untouched"
    verifies: [R-1, R-2]
  - id: T-2
    title: "Vault reflects latest docs with no copy step"
    given: "The Obsidian vault's symlinks point into the live checkouts"
    when: "The developer runs the sync script"
    then: "Opening the vault in Obsidian shows the latest docs immediately, because the symlinks resolve to the freshly pulled files"
    verifies: [R-4, R-5]
---

# Sync & Docs Workflow

How to keep local GroLabs repos current and read all documentation from a single
Obsidian vault, without navigating GitHub or the terminal.

## The repos

Four repos make up GroLabs, cloned locally under `/Users/sasu/code/Grolabs/`:

| Repo | Path | Role |
|---|---|---|
| `grolabs-app` | `/Users/sasu/code/Grolabs/web-apps/app` | Main application |
| `grolabs-wordpress-ga4` | `/Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-ga4` | GA4 plugin |
| `grolabs-wordpress-login` | `/Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-login` | Login plugin |
| `grolabs-wordpress-search` | `/Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-search` | Search plugin |

PRs are merged in the GitHub UI; local checkouts go stale until pulled.

## The sync script

`/Users/sasu/code/Grolabs/grolabs-sync.sh` fast-forwards every repo's local `main` to
`origin/main`.

```sh
/Users/sasu/code/Grolabs/grolabs-sync.sh
```

For each repo it: skips if `main` has uncommitted **tracked** changes (local
work is never touched), `git fetch origin`, `git checkout main`,
`git pull --ff-only`, then reports the new commits pulled. It only ever
fast-forwards — no resets, stashes, or force operations. Untracked files do not
block a sync and are preserved.

### Make it convenient

Add a shell alias (do this once, manually, in `~/.zshrc`):

```sh
alias grolabs-sync='/Users/sasu/code/Grolabs/grolabs-sync.sh'
```

Then `source ~/.zshrc`. Alternatively symlink it onto your PATH:

```sh
ln -s /Users/sasu/code/Grolabs/grolabs-sync.sh /usr/local/bin/grolabs-sync
```

### Keeping current — pick one habit

- **Pull after every merge.** Right after squash-merging a PR on GitHub, run
  `grolabs-sync`. Highest freshness, requires discipline.
- **Schedule it daily.** Add a `launchd` agent or cron entry, e.g.:
  ```sh
  # crontab -e — every weekday at 09:00
  0 9 * * 1-5 /Users/sasu/code/Grolabs/grolabs-sync.sh >> /tmp/grolabs-sync.log 2>&1
  ```
  Lower freshness but zero ongoing effort. The script is safe to run
  unattended — it never destroys local work.

## The Obsidian vault

A dedicated vault aggregates docs from all four repos via symbolic links:

```
/Users/sasu/code/grolabs-obsidian-vault/
├── README.md              ← vault index
├── Core/
│   └── docs   → /Users/sasu/code/Grolabs/web-apps/app/docs
└── Plugins/
    ├── GA4/
    │   ├── readme.txt → /Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-ga4/readme.txt
    │   └── README.md  → /Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-ga4/README.md
    ├── Login/
    │   ├── docs       → /Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-login/docs
    │   └── README.md  → /Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-login/README.md
    └── Search/
        ├── readme.txt → /Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-search/readme.txt
        └── README.md  → /Users/sasu/code/Grolabs/wp-plugins/grolabs-wordpress-search/README.md
```

Open `/Users/sasu/code/grolabs-obsidian-vault/` as a vault in Obsidian (separate
from the MICS vault). Because the entries are symlinks into the live checkouts,
running the sync script is all it takes for the vault to reflect the latest
docs — no copy step.

## Caveats

- **Symlinks are local-only.** The vault is not a git repo and is intentionally
  not committed. The links point at absolute `/Users/sasu/code/...` paths.
- **New machine = recreate the links.** After cloning the four repos on another
  machine, recreate the vault directory and its symlinks (paths must match, or
  adjust the targets). Consider scripting this if it becomes routine.
- **Login symlinks both `docs/` and `README.md`** because that plugin keeps a
  substantial top-level README in addition to its `docs/` folder. GA4 and Search
  have no `docs/` folder, so only `readme.txt` + `README.md` are linked.
- The sync script switches a repo to `main`. If you keep a feature branch
  checked out in a primary clone, sync will move you to `main` (your branch and
  commits are untouched and can be checked out again).
