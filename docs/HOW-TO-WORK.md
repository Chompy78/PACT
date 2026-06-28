# How to work on PACT with VS Code Copilot or Claude Code

Plain-English guide: what goes where, what to do at the start of a session, and the loop for each task.
The big idea: **the agent reads your repo directly.** You never paste your HTML or re-explain the project —
you commit the instructions once, then paste one task at a time.

---

## Where everything lives (the neat layout)
Only a few files are *pinned* to fixed paths by the tools; everything else tucks under `docs/`.

**Repo root (must/should be here):**
| File | Why it's at root |
|---|---|
| `CLAUDE.md` | **pinned** — Claude Code reads the root `CLAUDE.md` |
| `.github/copilot-instructions.md` | **pinned** — VS Code Copilot reads this exact path |
| `AGENTS.md` | master copy (some tools read `AGENTS.md`); keep `CLAUDE.md`/Copilot copies identical to it |
| `CHANGELOG.md` | convention — GitHub surfaces it; it's a "live" log you touch every change |
| `DECISIONS.md` | convention — sits next to the changelog |

**Everything else under `docs/` (the neat folder):**
| Path | What |
|---|---|
| `docs/HOW-TO-WORK.md` | this guide |
| `docs/PWA-BUILD-PLAN.md` | the task list (paste one at a time) |
| `docs/ENGINE-DATA-UPDATE.md` + `engine-data-update.json` | the first task (PHB pages + drawback text) |
| `docs/sessions/` | per-session narratives (the discussion history) |
| `docs/history/` | the archived pre-GitHub history (full changelog, old docs, fuzz harness) |
| `docs/PACT-Players-Guide.html` | the rules reference (already there) |

> The three instructions files are **identical copies**. Edit `AGENTS.md`, then copy it over `CLAUDE.md`
> and `.github/copilot-instructions.md`. That's the only sync chore.
> *(If you'd rather move `CHANGELOG.md` + `DECISIONS.md` into `docs/` too, you can — just change those two
> paths in `AGENTS.md` so the agents log to the new locations.)*

---

## ONE-TIME SETUP
1. Copy the files above into your repo at the paths shown, then commit **before** any task:
   ```
   git add AGENTS.md CLAUDE.md .github/copilot-instructions.md CHANGELOG.md DECISIONS.md docs/
   git commit -m "docs: agent instructions + changelog/decisions/sessions + history"
   git push
   ```
2. Install your assistant:
   - **VS Code Copilot:** install **GitHub Copilot** + **Copilot Chat**, open the repo, use **Agent** mode.
   - **Claude Code:** install the CLI, run `claude` in the repo folder (it reads `CLAUDE.md` automatically).

## START OF EACH SESSION
You barely need a prompt — the instructions file is the standing context. A good opener:
- **Claude Code:** `Read AGENTS.md and CHANGELOG.md, then do the task I paste next. Log it when done.`
- **Copilot (Agent mode):** `Follow .github/copilot-instructions.md. Here's the task:`
…then paste **one** task from `docs/PWA-BUILD-PLAN.md`. No need to re-describe the architecture.

## THE LOOP PER TASK
1. Branch: `git checkout -b task-1-pwa-shell` (one task per branch).
2. Paste one task from `docs/PWA-BUILD-PLAN.md` (start with the data update in `docs/ENGINE-DATA-UPDATE.md`).
3. Review the diff the agent proposes; accept or push back.
4. Verify: open `testing/tests/engine-parity.html` → **5 passed / 0 failed**.
5. Confirm it logged the change in `CHANGELOG.md` (+ `DECISIONS.md` / a `docs/sessions/` note if it applies).
6. Commit / open a PR. Merge → GitHub Pages redeploys.

## COPILOT vs CLAUDE CODE
| | VS Code Copilot (Agent mode) | Claude Code (CLI) |
|---|---|---|
| Reads instructions from | `.github/copilot-instructions.md` | `CLAUDE.md` |
| Where you work | inside VS Code | a terminal in the repo folder |
| Best at | quick in-editor edits | multi-file changes, running the test, opening PRs via `gh` |
| Start a session | open repo → Copilot Chat → Agent | run `claude` in the repo |

Use either or both — they read the same content under their two filenames, so the rules and the logging
discipline stay identical.

## TWO THINGS TO WATCH
- **Keep `js/engine.js` off-limits** unless a task explicitly targets it; the tools depend on its stable API.
- The `PACT.tar` snapshot is **behind your live repo** (it exports 3 engine symbols; your instructions list
  8). Treat your live GitHub repo as the truth — land the data update as a surgical `DATA` edit
  (`docs/ENGINE-DATA-UPDATE.md`), don't overwrite the live engine wholesale.
