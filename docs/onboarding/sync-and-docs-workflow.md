# Sync & Docs Workflow

How to keep local GroLabs repos current and read all documentation from a single
Obsidian vault, without navigating GitHub or the terminal.

## The repos

Four repos make up GroLabs, cloned locally under `/Users/sasu/code/`:

| Repo | Path | Role |
|---|---|---|
| `grolabs-rre` (grolabs-core) | `/Users/sasu/code/grolabs-rre` | Main application |
| `grolabs-wordpress-ga4` | `/Users/sasu/code/grolabs-wordpress-ga4` | GA4 plugin |
| `grolabs-wordpress-login` | `/Users/sasu/code/grolabs-wordpress-login` | Login plugin |
| `grolabs-wordpress-search` | `/Users/sasu/code/grolabs-wordpress-search` | Search plugin |

PRs are merged in the GitHub UI; local checkouts go stale until pulled.

## The sync script

`/Users/sasu/code/grolabs-sync.sh` fast-forwards every repo's local `main` to
`origin/main`.

```sh
/Users/sasu/code/grolabs-sync.sh
```

For each repo it: skips if `main` has uncommitted **tracked** changes (local
work is never touched), `git fetch origin`, `git checkout main`,
`git pull --ff-only`, then reports the new commits pulled. It only ever
fast-forwards — no resets, stashes, or force operations. Untracked files do not
block a sync and are preserved.

### Make it convenient

Add a shell alias (do this once, manually, in `~/.zshrc`):

```sh
alias grolabs-sync='/Users/sasu/code/grolabs-sync.sh'
```

Then `source ~/.zshrc`. Alternatively symlink it onto your PATH:

```sh
ln -s /Users/sasu/code/grolabs-sync.sh /usr/local/bin/grolabs-sync
```

### Keeping current — pick one habit

- **Pull after every merge.** Right after squash-merging a PR on GitHub, run
  `grolabs-sync`. Highest freshness, requires discipline.
- **Schedule it daily.** Add a `launchd` agent or cron entry, e.g.:
  ```sh
  # crontab -e — every weekday at 09:00
  0 9 * * 1-5 /Users/sasu/code/grolabs-sync.sh >> /tmp/grolabs-sync.log 2>&1
  ```
  Lower freshness but zero ongoing effort. The script is safe to run
  unattended — it never destroys local work.

## The Obsidian vault

A dedicated vault aggregates docs from all four repos via symbolic links:

```
/Users/sasu/code/grolabs-obsidian-vault/
├── README.md              ← vault index
├── Core/
│   └── docs   → /Users/sasu/code/grolabs-rre/docs
└── Plugins/
    ├── GA4/
    │   ├── readme.txt → grolabs-wordpress-ga4/readme.txt
    │   └── README.md  → grolabs-wordpress-ga4/README.md
    ├── Login/
    │   ├── docs       → grolabs-wordpress-login/docs
    │   └── README.md  → grolabs-wordpress-login/README.md
    └── Search/
        ├── readme.txt → grolabs-wordpress-search/readme.txt
        └── README.md  → grolabs-wordpress-search/README.md
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
