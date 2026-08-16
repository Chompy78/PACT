# How to work on PACT with Claude Code

Plain-English guide: what goes where, how to run and preview the app, and the loop for each task.
The big idea: **the agent reads your repo directly.** You never paste your HTML or re-explain the project —
you commit the instructions once, then paste one task at a time.

> **Primary tool: Claude Code** (CLI in a terminal in the repo). **Microsoft 365 Copilot** is used only as a
> *cold reviewer* of self-contained plans — it is not repo-aware and never edits code.
> **For the skills (`/pick-code-task`, `/run-code-task`, `/make-code-cold-plan-review`, …) and how they chain, see
> [`docs/SKILLS.md`](SKILLS.md).** This guide covers the app/test mechanics; SKILLS.md covers the workflow.

---

## The instruction files (no more copy chore)
There is now **one** source of truth for agent instructions: **`AGENTS.md`** at the repo root.
- `CLAUDE.md` is a stub that imports it (`@AGENTS.md`) — Claude Code picks it up automatically.
- `.github/copilot-instructions.md` is a stub that points to `AGENTS.md` (plus the hard rules inline).

**Edit `AGENTS.md` only.** The other two never need hand-editing — the old "keep three copies identical"
chore is gone.

## Where everything lives
**Repo root (pinned / by convention):**

| File | Why it's here |
|---|---|
| `AGENTS.md` | the single source of truth for agent instructions |
| `CLAUDE.md` · `.github/copilot-instructions.md` | thin stubs pointing at `AGENTS.md` |
| `CHANGELOG.md` · `DECISIONS.md` | the live "what" / "why" logs you touch every change |
| `index.html` · `login.html` · `manifest.json` · `service-worker.js` · `404.html` | the app shell |

**Under `docs/`:**

| Path | What |
|---|---|
| `docs/TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` | the task list, by band (paste one at a time) |
| `docs/HOW-TO-WORK.md` | this guide (app/test mechanics) |
| `docs/SKILLS.md` | the skills (`/pick-code-task`, `/run-code-task`, …) + workflow, human-readable |
| `docs/VERSION-SYNC.md` | how the build version is kept consistent across the tools |
| `docs/sessions/` | per-session narratives (optional; only when worth keeping) |
| `docs/history/` | archived pre-GitHub history — **non-authoritative**, don't read unless asked |
| `docs/PACT-Players-Guide.html` | the rules reference (large — don't load wholesale) |

---

## Running & previewing the app locally
It's a PWA with ES modules and a service worker, so **`file://` will not work** — you need a local HTTP
server, and the paths assume the **`/PACT/` base** (that's how GitHub Pages serves it).

**The easiest way (Windows, no terminal at all):** double-click **`run-pact.cmd`** in the repo root. It
shows which branch you're on, lets you paste another branch name to switch to it, then starts the server
and opens your browser. It also checks Git and Node are installed and explains what to do if not. The
sequencing lives inside the file deliberately — Windows PowerShell 5.1 rejects `&&`, which is what trips
people up running the steps by hand.

**The easy way — one command, from anywhere in the repo:**
```
node testing/scripts/serve.mjs            # serves + opens the menu in your browser
node testing/scripts/serve.mjs live       # …or jump straight to a tool
node testing/scripts/serve.mjs chargen | dm | test
node testing/scripts/serve.mjs --no-open --port 9000
```
It mounts the repo at `/PACT/` no matter where you run it from, prints **which branch and commit you are
looking at** (the point of the whole exercise when checking unmerged work), sends `Cache-Control:
no-store` so the service worker is far less likely to serve you stale files after a branch switch, and
lists every tool's URL. Needs only Node — the same one the test gates already require.

**Checking out a branch to look at it** — a branch has no URL of its own (Pages serves `main`; `preview`
isn't deployed), so this is the only way to see unmerged work:
```
git fetch origin <branch> && git checkout <branch>
node testing/scripts/serve.mjs live
# when you're done:  git checkout preview
```

<details><summary>The manual way (equivalent, if you'd rather not use the script)</summary>

**Serve the folder that *contains* your PACT repo, then open the `/PACT/` URL** (no npm needed):
```
# run this in the PARENT folder of your PACT repo:
python3 -m http.server 8000
# then visit:
http://localhost:8000/PACT/
```
Serving the parent (not the repo root) makes the absolute `/PACT/...` paths in `service-worker.js` and
`manifest.json` resolve exactly like production. If you only want to eyeball a tool and don't care about
the service worker, you can serve the repo root and open a tool directly — but the SW/install/offline
behaviour won't match production.

> Tip: when testing service-worker or cache changes, use a private/incognito window or DevTools →
> Application → Service Workers → "Update on reload" so you're not served a stale worker.

</details>

---

## Verifying the engine without a browser (the gate)
The regression gate is **`testing/tests/engine-parity.html`** — a browser page that must report
**0 failed**. The pass count grows as fixtures are added, so it is deliberately not written down here —
the live baseline is `testing/expected/expected-results.csv`. A CLI agent has no browser, so run the
headless port instead
(**`testing/scripts/engine-parity-ci.mjs`**, REV-11) — same fixtures, same `expected-results.csv`, same
assertions, just Node instead of a `<script type="module">` in a page:

```
# from the repo root (Node 18+):
node testing/scripts/engine-parity-ci.mjs
```
It prints a PASS/FAIL line per fixture and exits non-zero on any failure — this is also what
`.github/workflows/engine-parity.yml` runs on every PR touching `js/engine.js` or `testing/**`, so a
regression fails CI automatically, not just when a human remembers to open the browser page.

### The second gate: pricing that lives inside the tools
`engine-parity` asserts what `compute()` returns. It cannot see `priceOf()` in
`tools/PACT-Live-Char-Sheet.html`, which decides what a player is **charged** and freezes that number
into their log — a defect there is in `compute()`'s *caller*, so parity stays green while players are
billed wrongly (this happened: see `D-GH-2026-08-05-pricing-model`). That is what the second gate covers:

```
node testing/scripts/tool-pricing-ci.mjs      # expect 0 failed (count grows with each new assertion)
```

It needs **no npm install and no dev server**. It serves the repo itself on a loopback port and drives
whatever Chrome/Chromium is already present over the DevTools protocol, using only Node built-ins —
which is why it runs where the `playwright`-based e2e scripts here (`chargen-flows-e2e.mjs`,
`cloud-e2e.mjs`, …) cannot, since `AGENTS.md` forbids npm in this repo. Point it at a specific browser
with `CHROME_BIN=/path/to/chrome` if it can't find one. CI runs it via
`.github/workflows/tool-pricing.yml` on any PR touching the two tools or the budget-curve files.

### The third gate: the cloud stale-save guard
```
node testing/scripts/sync-concurrency-ci.mjs   # expect 0 failed
```
`js/sync.js` guards against two devices editing one character and silently destroying each other's
history (the whole event log lives in `stats`, so the later writer replaces the earlier writer's entire
past). That guard was originally declared untestable — "no automated gate can reach this, the
dependency-free suite can't sign in to Supabase" — and verified by a manual two-tab ritual instead.
**The ritual missed a real hole**, which then happened in production on 2026-08-07: a character went 43
AP spent → 47 → back to 43 across two browser profiles with the guard active.

Supabase turns out not to be needed. What matters is the *order* of local reads and writes around a
conditional update, so this script stubs the server and gives each simulated profile its own
`localStorage`, then replays that exact sequence against the real `js/sync.js`. Node built-ins only.

Its first check is **differential**: it also runs the scenario against a deliberately reverted copy of
`sync.js` and fails if the bug does *not* reproduce there. A regression test that passes on the broken
version proves nothing, so this one refuses to pass vacuously — if it can no longer build the reverted
copy, it fails and says so rather than going quietly green.

> Writing new assertions for it: poll a **bridged** symbol (`window._engineFold`, `window.DATA`) for
> readiness, never a classic-script function like `priceOf` — those exist before the deferred module
> bridge has run, so probing them races. And read rendered text from the real container
> (`#guide`, `#tray`), never `document.body.innerHTML`, which also matches the inline `<script>` source.

For a one-off spot-check of a single fixture (e.g. while iterating on a pricing change before the full
gate matters), importing the engine directly in Node still works:

```
# from the repo root (Node 18+):
node -e "import('./js/engine.js').then(async m => {
  const fs = await import('node:fs/promises');
  const b = JSON.parse(await fs.readFile('testing/fixtures/builds/CG-002-valid-50ap-build.json','utf8'));
  const r = m.compute(b);
  console.log('total', r.total, 'remaining', r.remaining, 'warnings', (r.warnings||[]).length);
});"
```
Compare the numbers to the baseline in `testing/expected/expected-results.csv`.

---

## Test fixtures & expected results (how to add or update one)
- **Fixtures** live in `testing/fixtures/`:
  - `builds/` — CharGen flat-build JSON (`CG-001` empty, `CG-002` valid-50ap, `CG-003` over-budget,
    `CG-004` prereq-gate rejection, `CG-005` racial/mastery discount, `CG-006` multi-tradition spellcasting)
  - `live-sheets/` — Live Sheet event logs (`LS-001` clean export)
  - `events/` — event-sourcing cases (`EV-001` award-and-purchase, `EV-002` drawback buy-off)
- **Expected output** is `testing/expected/expected-results.csv`, one row per fixture. Columns:
  `test_id, test_group, fixture, legacy_ap_total, new_engine_ap_total, legacy_warnings,
  new_engine_warnings, legacy_valid, new_engine_valid, pass, notes`.
- **To add a fixture:** drop the JSON in the right subfolder, add a row to the CSV with the fixture path,
  fill the `new_engine_*` columns with the **confirmed** correct values (run the engine to get them, then
  verify against the PHB/guide — don't invent numbers), and register it in `testing/pack-manifest.json`.
- **When a task legitimately changes `compute()` output:** update the affected `new_engine_*` values in the
  same PR and say so in the changelog. (See `testing/README.md` for the run steps.)

---

## The loop per task
The skills automate most of this — **`/pick-code-task` then `/run-code-task`** is the normal two-step path (see
[`docs/SKILLS.md`](SKILLS.md)). For a big/risky task, run **`/make-code-cold-plan-review`** first and send the plan to
M365 Copilot for a cold review before implementing. The underlying mechanics `/run-code-task` performs, if you
ever do it by hand:
1. **Branch:** `git checkout -b feat/<short-slug>` (one task per branch; use `type/slug` — `feat/`, `fix/`, `docs/`).
2. **Paste one task** from the task board (`docs/TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md`). No need to re-describe the architecture — `AGENTS.md` is the standing context.
3. **Review the diff** the agent proposes; accept or push back (`/code-review` for an adversarial pass).
4. **Verify:** run the gate (browser page, or the headless Node check above) → expect **0 failed**.
5. **Log it:** confirm `CHANGELOG.md` is updated (+ `DECISIONS.md` / a `docs/sessions/` note if it applies);
   graduate the task off the task board into the changelog if it's done.
6. **Commit** as `type(scope): summary`, open a PR, merge → GitHub Pages redeploys.

## Pre-release manual QA checklist
For release-shaped PRs (not every doc/small fix) — a manual pass through the full cross-tool flow, since
the automated gate (`engine-parity.html`) only covers `compute()`, not the UI wiring between tools:
1. Build a character in CharGen.
2. Export it to Live Sheet.
3. Verify buy-off works and ledger entries are per-item (one LOG entry per purchase, not batched).
4. Push the character to the cloud in a test campaign.
5. Confirm DM Console sees the character and can award AP.
6. Check the browser console for errors at each step above.

## Backing up the cloud data
Three separate mechanisms, doing three different jobs — don't mistake one for another:

| What | Covers | Who runs it | Where |
|---|---|---|---|
| `character_backups` table | every change and delete, per character, 50 kept (deletes forever) | automatic (DB trigger) | server-side only; restore recipes in `sql/migrations/2026-08-07-character-backups.sql` |
| **Export backup** button | that user's own characters, current state | any signed-in user | My Characters (`tools/characters.html`); warns when 7+ days stale |
| `sql/full-backup.sql` | the whole database, current state | whoever holds the Supabase dashboard login | dashboard → SQL Editor |

Only the third sees everything, and only from the dashboard: `characters_select` limits any client to
`owner_id = auth.uid() or is_campaign_dm(campaign_id)`, so even an account DMing every campaign cannot
export the lot. That's deliberate — this project has no admin role, and `service_role` via the dashboard
is the admin surface. See `DECISIONS.md` `D-GH-2026-08-07-character-backups` for why an in-app admin
backup was considered and rejected.

Backup output contains every player's character data and email addresses. Keep it private; never commit
it to this repo.

## Start of each session
Claude Code reads `AGENTS.md` (via `CLAUDE.md`'s `@AGENTS.md` import) automatically, so you don't re-explain
the project. A good opener: `Run /pick-code-task` — or paste **one** task from the task board directly.
For big/risky work, ask for a plan first (`/make-code-cold-plan-review`) and route it through M365 Copilot before
building.

## Claude Code + M365 Copilot — who does what
| | Claude Code (CLI) — primary | M365 Copilot — cold reviewer only |
|---|---|---|
| Role | does all the work: edits, tests, refactors, PRs | critiques a *self-contained plan* or prose |
| Repo access | reads the repo directly (`CLAUDE.md` → `AGENTS.md`) | **none** — sees only what you paste |
| Judges | code + plan | plan quality / clarity — **not** code correctness |
| Authority | final; verifies every reviewer finding against the code | advisory |

Claude is always the final authority; Copilot is a second pair of eyes on the *plan*, never on the code, and
only when a wrong approach would be expensive to unwind.

## Rules-correctness review (not just code quality)
`/code-review`'s default lens is bugs/reuse/simplification — it does **not** check the math against the
Player's Guide. For any PR that touches `js/engine.js`'s `compute()` or `DATA` (ladders, caps, gates,
prices), explicitly ask for a domain-correctness pass in addition to the usual code review, e.g.:

```
/code-review high — also verify the new pricing/gate logic against the Player's Guide (docs/PACT-Players-Guide.html):
check the AP cost, the level/HD gate, and any cap against what the guide actually specifies, not just
that the code is internally consistent.
```

A change can be well-written, pass parity, and still be *wrong* if the number it encodes doesn't match the
rules text — code review alone won't catch that; only a check against the source document will.

## AI working defaults
- Default to Sonnet at standard effort for spec-driven execution (a task-board task with a clear "Done when").
  Reach for Opus / higher effort only when the task is genuinely ambiguous or architectural — a design
  trade-off with no single obviously-correct answer, not just "this file is long."
- One task per fresh session/branch (see the Conventions in `docs/TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md`) — don't let a session
  accrete unrelated work; if a second task surfaces mid-session, finish or park the first, then branch fresh.
- Read large files once, purposefully (grep for the symbol, don't re-read `js/engine.js` wholesale on every
  turn) — see "Don't read large files wholesale" in `AGENTS.md`.

## When to run a full multi-agent audit
A full audit (parallel agents each covering one lens — rules-logic correctness, security/RLS, a usability
click-through, docs-consistency) is worth its cost only for **major releases or big refactors** — not
routine PRs, where `/code-review` at an appropriate effort level is enough. A rough shape for one, if/when
it's warranted:
```
Fan out N agents, one per lens:
  1. Rules-logic: diff js/engine.js's compute()/DATA against docs/PACT-Players-Guide.html for the
     areas touched since the last release.
  2. Security/RLS: run testing/scripts/audit.py --rls plus a manual read of sql/rls-policies.sql for
     any new table/column touched this release.
  3. Usability: click through the pre-release manual QA checklist above end-to-end, in a real browser.
  4. Docs-consistency: confirm CHANGELOG.md/DECISIONS.md/the task board agree with what actually
     shipped (no graduated-but-still-listed items, no undocumented decisions).
Synthesize findings into one report before deciding to ship.
```
This is deliberately heavier than a normal task's review cadence — reserve it for moments where the cost of
a missed regression (a bad release, a security gap) is much higher than the cost of running it.

## Maintenance mode — taking the tools down and bringing them back

One command each way. It edits files only; you do the git.

```
node testing/scripts/maintenance.mjs status   # ON / OFF / INCONSISTENT
node testing/scripts/maintenance.mjs on
node testing/scripts/maintenance.mjs off
```

**Full sequence** (maintenance is applied to `main`, the branch GitHub Pages serves — deliberately
*not* via a `preview` → `main` promotion, because a promotion PR + `BUILD` bump is the wrong shape
for an urgent takedown):

```
git checkout main && git pull
node testing/scripts/maintenance.mjs on        # or: off
git add -A && git commit -m "ops: maintenance mode on"   # or: off
git push
```

Pages redeploys in a minute or two.

**What it gates:** the four tool pages — CharGen, Live Sheet, DM Console, `characters.html`. A
one-line script at the top of `<head>` redirects to `/PACT/maintenance.html` before anything else
loads.

**What stays up, on purpose:** `docs/PACT-Players-Guide.html` (players keep the rules) and
`index.html` (landing page, still links to the guide).

**Bypass while it's up:** append `?maint=off` to any tool URL — e.g.
`…/tools/DM-Console.html?maint=off` — so you can verify the tools before lifting.

**Do not bump `service-worker.js`'s `CACHE_NAME` for this.** HTML is network-first, so returning
users get the maintenance page on their next load and get the real tools back just as fast on `off`.
Bumping the cache would precache the *maintenance* pages and need a second bump to undo.

> **`preview` does not carry maintenance mode.** Any `preview` → `main` promotion while maintenance
> is on will silently lift it. Don't promote during a maintenance window.

> **Why `off` removes an exact substring, not a line.** In `PACT-CharGen-Webtool.html` the `<head>`
> shares its line with `<meta charset="utf-8">`. An earlier line-based version of this script would
> have deleted the charset declaration along with the gate — caught by a round-trip test, which is
> now the acceptance check: `on` then `off` must leave `git status` clean.

## Two things to watch
- **Keep `js/engine.js` off-limits** unless a task explicitly targets it; the tools depend on its stable API.
- **Tool/engine build versions must stay in sync** — see `docs/VERSION-SYNC.md` before bumping anything.
