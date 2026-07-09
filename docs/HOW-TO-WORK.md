# How to work on PACT with Claude Code

Plain-English guide: what goes where, how to run and preview the app, and the loop for each task.
The big idea: **the agent reads your repo directly.** You never paste your HTML or re-explain the project —
you commit the instructions once, then paste one task at a time.

> **Primary tool: Claude Code** (CLI in a terminal in the repo). **Microsoft 365 Copilot** is used only as a
> *cold reviewer* of self-contained plans — it is not repo-aware and never edits code.
> **For the skills (`/pick-task`, `/run-task`, `/plan-for-review`, …) and how they chain, see
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
| `docs/PACT_ROADMAP.md` | the task list (paste one at a time) |
| `docs/HOW-TO-WORK.md` | this guide (app/test mechanics) |
| `docs/SKILLS.md` | the skills (`/pick-task`, `/run-task`, …) + workflow, human-readable |
| `docs/VERSION-SYNC.md` | how the build version is kept consistent across the tools |
| `docs/sessions/` | per-session narratives (optional; only when worth keeping) |
| `docs/history/` | archived pre-GitHub history — **non-authoritative**, don't read unless asked |
| `docs/PACT-Players-Guide.html` | the rules reference (large — don't load wholesale) |

---

## Running & previewing the app locally
It's a PWA with ES modules and a service worker, so **`file://` will not work** — you need a local HTTP
server, and the paths assume the **`/PACT/` base** (that's how GitHub Pages serves it).

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

---

## Verifying the engine without a browser (the gate)
The regression gate is **`testing/tests/engine-parity.html`** — a browser page that must report
**9 passed / 0 failed**. A CLI agent has no browser, and **there is no headless runner yet** (building one
is tracked as **REV-11** in the roadmap). Until then, verify the engine by importing it in **Node** (the
engine is a clean ES module and runs under Node unchanged):

```
# from the repo root (Node 18+):
node -e "import('./js/engine.js').then(async m => {
  const fs = await import('node:fs/promises');
  for (const f of ['CG-001-default-empty-build','CG-002-valid-50ap-build','CG-003-over-budget-build']) {
    const b = JSON.parse(await fs.readFile('testing/fixtures/builds/'+f+'.json','utf8'));
    const r = m.compute(b);
    console.log(f, 'total', r.total, 'remaining', r.remaining, 'warnings', (r.warnings||[]).length);
  }
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
The skills automate most of this — **`/pick-task` then `/run-task`** is the normal two-step path (see
[`docs/SKILLS.md`](SKILLS.md)). For a big/risky task, run **`/plan-for-review`** first and send the plan to
M365 Copilot for a cold review before implementing. The underlying mechanics `/run-task` performs, if you
ever do it by hand:
1. **Branch:** `git checkout -b feat/<short-slug>` (one task per branch; use `type/slug` — `feat/`, `fix/`, `docs/`).
2. **Paste one task** from `docs/PACT_ROADMAP.md`. No need to re-describe the architecture — `AGENTS.md` is the standing context.
3. **Review the diff** the agent proposes; accept or push back (`/code-review` for an adversarial pass).
4. **Verify:** run the gate (browser page, or the headless Node check above) → expect **9 passed / 0 failed**.
5. **Log it:** confirm `CHANGELOG.md` is updated (+ `DECISIONS.md` / a `docs/sessions/` note if it applies);
   graduate the task out of the roadmap into the changelog if it's done.
6. **Commit** as `type(scope): summary`, open a PR, merge → GitHub Pages redeploys.

## Start of each session
Claude Code reads `AGENTS.md` (via `CLAUDE.md`'s `@AGENTS.md` import) automatically, so you don't re-explain
the project. A good opener: `Run /pick-task` — or paste **one** task from `docs/PACT_ROADMAP.md` directly.
For big/risky work, ask for a plan first (`/plan-for-review`) and route it through M365 Copilot before
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

## Two things to watch
- **Keep `js/engine.js` off-limits** unless a task explicitly targets it; the tools depend on its stable API.
- **Tool/engine build versions must stay in sync** — see `docs/VERSION-SYNC.md` before bumping anything.
