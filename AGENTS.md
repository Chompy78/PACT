# PACT — instructions for AI coding agents

> **Single source of truth.** Edit ONLY this file. `CLAUDE.md` imports it (`@AGENTS.md`);
> `.github/copilot-instructions.md` is a stub that points here.

PACT is a static, vanilla-JS tabletop-RPG tool suite — no frameworks, no build step, no npm.
On GitHub Pages at https://chompy78.github.io/PACT/ (served from the `main` branch root; `preview`
is staging and promotes into `main`).

## Active Priorities
<!-- Lets an agent start from current focus WITHOUT reading docs/PACT_ROADMAP.md; cached, so ~free after
     turn one. Keep it short, refresh when focus shifts, prune when stale (stale is worse than empty). The
     roadmap stays the single writer of the full task list — this is a pointer to it, not a second copy. -->

- **Current focus:** the 🔴 NOW roadmap item — the full engine module-bridge migration across all three
  tools (`feat/engine-bridge-all-tools`). See `docs/PACT_ROADMAP.md` NOW section for the authoritative
  task text. (The Live Sheet `undo()` correctness bug closed as D-GH30: `undo()` itself was already
  correct; the real defect was a display divergence, fixed display-only. The deferred long-term question —
  whether `js/engine.js` should grow a frozen-ledger-aware remaining-AP export — was handed to the owner
  as a proposed NEXT item, `feat/ap-model-reconcile` — see the output block at the end of this session's
  turn, not yet folded into `docs/PACT_ROADMAP.md`.)
- **High-risk files:** `js/engine.js` (rules source of truth — API must stay stable); the three tools'
  hand-copied `DATA`/`compute()`/`MUT`/etc. (parity risk until the bridge lands); Live Sheet's
  `compute()`-vs-frozen-`economy()` divergence (see D-GH30 and `feat/ap-model-reconcile`) — any UI that
  displays "AP left" for an event-sourced character must use the frozen ledger, not a retroactive
  recompute.
- **Preferred task shape:** one task per branch (`type/short-slug`), small focused PRs into `preview`; use
  `/pick-task` → `/run-task`; for big/risky work draft a plan for cold review first (see Agent guidance below).
- **Avoid:** re-implementing rules logic anywhere but `engine.js`; patching `undo()` with tool-local state
  instead of LOG replay; bumping `DATA.version` for display-only changes; reading large files wholesale.
- **Verification expectations:** `testing/tests/engine-parity.html` → **5/0**; if `compute()` output changed,
  update `testing/expected/` in the same PR and bump `DATA.version`; mirror build/version numbers per
  `docs/VERSION-SYNC.md`.

## Shell environment notes
- **`gh` CLI** is installed but not on the system PATH — my shell tools can't resolve it by name.
  Always call it via its full path:
  `C:\Users\JohnChow\AppData\Local\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\gh.exe`

## Agent and effort guidance
Before starting any non-trivial task, flag whether it would benefit from a specialised agent or higher
effort — and why — using this quick rubric:
- **Explore agent** — searching for symbols, patterns, or files across a large or uncertain portion of the codebase.
- **Plan agent** — the task touches multiple files with architectural implications or involves a meaningful design trade-off.
- **code-reviewer / `/code-review ultra`** — independent adversarial review of a diff before merging.
- **Higher effort (`high`/`max`)** — verification, judge panels, or deep audits where correctness matters more than speed.
- **Cold plan review (`/plan-for-review`)** — for a big/risky change (multi-file, engine/rules, tool-parity,
  ambiguous scope, or where a missing test/criterion would cause rework), draft a *self-contained* plan for an
  external cold reviewer (e.g. M365 Copilot) **before** implementing. **Trigger:** only when a wrong approach
  would cost more than one implementation cycle to undo — skip it for trivial/single-file/mechanical work. The
  reviewer judges *plan quality, not code* (it has no repo access); Claude stays the final authority and
  verifies every finding against the actual code before acting on it.

If none of these apply, state that and proceed.

## Architecture — read before editing
- **`js/engine.js` is the single source of truth for all game rules** (browser ES module). Exports:
  `DATA`, `compute`, `rebuildStateFromEvents`, `baseBuild`, `MUT`, `activeEvents`, `economy`, `foldBuild`.
  Never re-implement rules logic anywhere else.
- **Three UI-only tools** in `tools/` (`PACT-CharGen-Webtool.html`, `PACT-Live-Char-Sheet.html`,
  `DM-Console.html`). As of D-GH26 (a **safe-subset** migration), all three now import **`DATA`,
  `compute`, `baseBuild`** from `js/engine.js` in a `<script type="module">` bridge that copies them onto
  `window` and fires a new **`engine-ready`** event; each tool's UI bootstrap is gated on that event
  (deferred modules run *after* the classic scripts, so the engine symbols aren't present at parse time).
  Live Sheet also imports **`MUT`** (its copy was byte-identical to the engine's) plus `validate()` and
  sync/auth/campaign helpers, and still fires `sync-ready` after `engine-ready`. DM Console additionally
  imports auth/campaign/dm helpers and still fires `campaign-ready` after `engine-ready`. CharGen — which
  had **no** module bridge before — gained its first one here (still no cloud/auth wiring; `DATA`+`compute`
  only). The per-tool display-only `DATA.racialFx` map is set inside each module bridge (it mutates the
  imported `DATA`; never read by `compute()`).
- **Still hand-copied / local in the tools** (NOT yet bridged — a follow-up migration; see D-GH26):
  `activeEvents`/`economy`/`foldBuild` in **all three** tools are **index-based closures over a
  script-level `LOG`** (`foldBuild(uptoIdx)`), *not* the engine's array-parameter API
  (`foldBuild(events)`) — they drive the Live Sheet/DM event-sourcing + time-travel and the CharGen
  import-fold, and are **not** signature-compatible with the engine exports. `MUT` is also still local in
  **CharGen** (specialized closures inside `_lsImportFold`/`buildToLiveLog`, the D-GH3 export bridge) and
  **DM Console** (its `MUT` *diverges* from the engine's — stale `found`, missing `dbound`; bridging it is
  a deliberate behavioral change, not done yet). Never re-implement rules logic anywhere else; `tools/`
  and `js/` must stay siblings.
- **Persistence:** the app is an installable, offline-capable PWA with **optional sign-in**. Local-only
  still works (localStorage + JSON import/export); when signed in, characters also save to the **cloud
  (Supabase)** and DMs run **campaigns**. CharGen = a flat build JSON; Live Sheet = an event log
  `{ LOG, SEQ, rules }`. Store only raw character data; derive HP/AC/AP/warnings via `compute()` /
  `rebuildStateFromEvents()` at runtime — **never store derived values.**
- **CharGen → Live Sheet export (D-GH3, see DECISIONS.md):** emits one native buy event per purchase plus
  structural patches; imported characters must be indistinguishable from hand-built ones (drawbacks
  buy-off-able, one ledger entry per line).

## Hard rules for any change
- Keep the three tools working and their UI unchanged unless the task says otherwise.
- Vanilla JS only — no frameworks, bundlers, TypeScript, or npm.
- GitHub Pages only — **no custom backend code in the repo.** The app is static files; Supabase (hosted
  database + auth) is the only backend, reached from the browser and protected by row-level security.
  Service-worker scope and manifest `start_url` = `/PACT/`.
- **Secrets:** only the Supabase **anon/publishable** key is committed (safe under RLS). **Never commit the
  `service_role`/secret key** or any private credential.
- **Target:** modern evergreen browsers on phones and desktops (current Chrome/Edge/Firefox/Safari, incl.
  iOS Safari). Prefer widely-supported JS/CSS; no legacy/IE shims.
- After any change, `testing/tests/engine-parity.html` must report **5 passed / 0 failed** (how to run it —
  browser or headless — is in `docs/HOW-TO-WORK.md`). Keep `engine.js`'s public API stable if you touch it.

## Don't read large files wholesale (token budget)
- **`js/engine.js` (~237 KB)** — don't read end-to-end unless the task targets the engine; `grep` for the
  symbol you need (full API is the Exports line above).
- **Never load `docs/PACT-Players-Guide.html` (~657 KB) or `assets/pact-cover.webp`** — player assets, not code.
- **`tools/*.html` are 320–520 KB each** — search within for the relevant section; don't read the whole file.
- **`docs/history/` is a retired architecture** (`src/engine/`, `build.cjs`, a Node audit) — never read it
  unless asked.
- **`source-assets/` holds full-resolution/pre-optimization originals** (images today, possibly other
  media later) behind the actual served files in `assets/`. Never read, glob, or summarize it wholesale —
  these are large binaries, not something to reason about. See `source-assets/README.md` for what goes
  there and how the optimized-vs-source split works.

## Versioning — TWO separate numbers (don't conflate or over-bump)
- **Build version** (`BUILD`, currently `v0.107`) — the cosmetic web-tool/build number. The single source
  of truth is `export const BUILD` in `js/engine.js`; the three tools must **mirror** it and stay
  consistent — CharGen (line-1 comment, `<title>`, header `.sub` label), Live Sheet (line-1 comment),
  DM Console (`TOOL_VERSION`). `index.html` reads `BUILD` live, so **never hand-edit its version.** Full
  bump procedure: `docs/VERSION-SYNC.md`.
- **Rules version** (`DATA.version`, currently `v0.332`) — the rules dataset. Bump ONLY when mechanics
  change (ladders, prices, gates, `compute()` output). The display-only maps `masteryFx`, `drawbackFx`,
  `racialFx` and `page` fields are never read by `compute()` — editing them is a docs change, so don't
  bump it; just log it in `CHANGELOG.md`.

## Log as you go (this is how context survives between sessions)
Before finishing a task / opening a PR, update what applies (newest on top):
- **`CHANGELOG.md`** — *what* changed, one line.
- **`DECISIONS.md`** — *why*, on any architectural/process choice (Context → Options → Decision → Why → Status).
- **`docs/sessions/<date>-<topic>.md`** — the discussion, when it's worth keeping.
- **Graduate:** when a `docs/PACT_ROADMAP.md` task is DONE, MOVE it into `CHANGELOG.md` in the same change —
  the roadmap holds only open work.

## Multiple sessions
More than one agent may be active. **`docs/PACT_ROADMAP.md` has a single writer** — don't append to it.
If you have new roadmap items, output them in **this exact format** for the human to fold in, then carry on:

````
## <short title> — TODO
```
<what to do — the agent prompt, paste-ready>
```
**Done when:** <objective, checkable condition>
````

One task per branch (the open branch is the "in flight" signal) — except a small, explicitly-approved
**batch** of low-risk tasks (docs-only, config, single-tool CSS/UI — the same class `/pick-task`'s
"quick" filter identifies), which `/pick-task` may offer to bundle into one branch/PR for token
efficiency. Each bundled task still gets its own commit and its own `CHANGELOG.md`/roadmap-graduation
line; only the branch/PR/rebase/test-run machinery is shared.

**Worktrees.** `/pick-task` + `/run-task` are the two-step workflow for a roadmap task: `/pick-task`
fetches live state and pre-flights a task with no editing; `/run-task <type/short-slug>` does the actual
work, isolated in a native Claude Code worktree (`EnterWorktree`, landing under `.claude/worktrees/`,
gitignored — see D-GH22). Worktrees branch from `preview`, which is this repo's actual GitHub default
branch. `EnterWorktree` sanitizes `/` out of its `name` argument, so `/run-task` renames the branch with
`git branch -m` right after creating it — see `run-task.md` Step 4 for the verified caveats.

## File & data map
- **App:** `index.html` (menu) · `login.html` (auth) · `js/engine.js` · `tools/*.html` ·
  `docs/PACT-Players-Guide.html`.
- **Engine support:** `js/` — `supabase-client.js`, `auth.js`, `sync.js`, `campaign.js`, `dm.js`;
  root — `manifest.json`, `service-worker.js`, `404.html`; `sql/` — `schema.sql`, `rls-policies.sql`, `migrations/`.
- **Testing:** run `testing/tests/engine-parity.html` (expect **5/0**); fixtures in `testing/fixtures/`,
  expected output in `testing/expected/` (see `testing/README.md`).
- **Docs:** `docs/PACT_ROADMAP.md` (open work) · `docs/HOW-TO-WORK.md` (app/test mechanics) ·
  `docs/SKILLS.md` (skills + workflow, human-readable) · `docs/sessions/` ·
  `docs/history/` (archived, non-authoritative).
- **Data rule:** the DB stores only raw character data (`characters.stats`) — the engine derives the rest
  (see *Persistence* above). `ap` (DM-awarded points) is server-authoritative and DM-only — never
  overwritten by a local push.

## Per-change checklist
1. One task, one branch — name it `type/short-slug` (e.g. `feat/…`, `fix/…`, `docs/…`).
2. Touch `js/engine.js` only if the task targets the engine; else treat its API as fixed.
3. `testing/tests/engine-parity.html` → **5/0** (run it per `docs/HOW-TO-WORK.md`). If you changed
   `compute()` output, update `testing/expected/` in the same change and say so.
4. Update `CHANGELOG.md` (always) · `DECISIONS.md` (if the change involves a non-obvious *why*:
   security model, trust boundary, caching strategy, data-model trade-off — ask "would a future agent
   wonder why this was done this way?") · `docs/sessions/` (if the session covered discussion or
   spanned multiple areas worth preserving). Graduate the task out of the roadmap if done.
5. Commit as `type(scope): summary` (Conventional Commits); open a PR and draft its body from the
   changelog entry.
6. **After a successful PR merge:** re-check step 4's three docs. If any are missing, add them in a
   follow-up commit on a `docs/` branch before the session closes. A merged PR with missing docs is
   treated as incomplete.
