# 2026-07-05 — Engine module-bridge migration, shipped as a safe subset (PR #121, D-GH26)

This note exists because the roadmap task's premise turned out to be **wrong about the code**, the
scope was deliberately cut mid-session as a result, and the branch collided repeatedly with concurrent
sessions' work on `preview`. A future agent picking up the follow-up task should read this before
trusting the original task text.

## What the task asked vs. what the code actually was

The 🔴 NOW roadmap task ("Full engine module-bridge migration"), `AGENTS.md`, and `DECISIONS.md` D-GH9
all described all three tools as hand-copying **seven** engine symbols — `DATA`, `compute`, `MUT`,
`baseBuild`, `activeEvents`, `economy`, `foldBuild` — and asked to migrate them by importing all seven
onto `window` and deleting the local copies.

A compat check **before editing** (diffing each tool's symbols against `js/engine.js`) found the premise
only partly true, and that a literal import-and-delete would **break the tools**:

- **`activeEvents` / `economy` / `foldBuild` are signature-incompatible.** The engine exports take an
  events *array* — `foldBuild(events)`. All three tools' versions take an *index* and close over a
  script-level `LOG` — `foldBuild(uptoIdx)`, called as `foldBuild(null)` / `foldBuild(viewAt)`. Importing
  the engine versions and deleting the local ones would break event-sourcing + time-travel in Live Sheet
  and DM Console, and the import-fold path in CharGen. Reconciling them means rewriting every call site to
  pass `LOG` slices — a much larger change to the event-replay core than the task described.
- **CharGen has no top-level `baseBuild`/`MUT`/`activeEvents`/`economy`/`foldBuild` at all** — only `DATA`
  and `compute`. The rest are local closures inside `_lsImportFold` / `buildToLiveLog` (the D-GH3 export
  bridge), specialized, not the engine's versions.
- **DM Console's `MUT` diverges** from the engine's — its `found` lacks the add-discipline-to-existing-
  tradition else-branch, and it is missing `dbound` entirely (D-GH9 updated engine + Live Sheet in
  lockstep but not DM Console). Bridging DM's `MUT` is a real behavioral change, not a no-op.
- `DATA` (byte-identical across all four when parsed), `compute` (each tool's `compute(b)` is the engine's
  minus the additive `opts`/`spendable` block — a safe superset), `baseBuild` (identical modulo a trailing
  comment), and Live Sheet's `MUT` (identical to the engine's) **are** cleanly bridgeable.

## The decision (D-GH26) — Option A, chosen by the owner

Presented the compat evidence and three options: (A) bridge only the verified-compatible subset now;
(B) the literal full migration (rewrite all the event-function call sites + reconcile DM's MUT); (C)
don't touch code, just correct the roadmap. The owner chose **A** — explicitly emphasising that buying an
aspect must keep emitting an event (the buy→event→replay path must not regress).

**Shipped:** each tool imports `DATA` + `compute` + `baseBuild` (Live Sheet also `MUT`) from
`js/engine.js` in a `<script type="module">` that copies them onto `window` and fires a new
**`engine-ready`** event; each tool's UI bootstrap is gated on that event. Inline `DATA`/`compute` (all
three), `baseBuild` (LS, DM) and `MUT` (LS) copies deleted; each tool's display-only `DATA.racialFx` map
moved into its module bridge. **CharGen gained its first module bridge.**

**Deferred (handed back to the roadmap as a revised task):** `activeEvents`/`economy`/`foldBuild` in all
three, CharGen's export-bridge `MUT`, and DM Console's divergent `MUT`.

## The one genuinely tricky bit: ES-module deferral

`<script type="module">` is *implicitly deferred* — it runs AFTER the whole document is parsed and after
every classic non-deferred inline script. So at classic-script parse time, the `window.X` a module sets
does not exist yet. Deleting an inline `const DATA`/`function compute` and relying on the module's
`window.DATA`/`window.compute` therefore breaks any **top-level** code that runs at parse (initial
`render()`, `const RULES = DATA.version`). Fix: the module dispatches `engine-ready` after assigning to
`window`; each tool's bootstrap is wrapped in a function and run via
`if (window.compute) boot(); else document.addEventListener('engine-ready', boot, {once:true})`. Function
*bodies* needed no gating (they run later, on user action). (Logged as a cross-project lesson in
`dev/learnings.md`.)

## Verification

No headless runner exists (REV-11), and there's no Node in-shell, so verification was done in a real
browser via a static `python -m http.server` served through the preview tooling:
- `engine-parity.html` → **5 passed / 0 failed** (v0.332), before and after each rebase.
- All three tools loaded over HTTP: **no console errors**; `compute`/`foldBuild`/`economy` produce correct
  values; a **Live Sheet buy still emits exactly one event** and folds the skill in; DM's `dmAnalyze`
  replays the LS-001 fixture to **total 78**.

## Collision saga (why the rebases were noisy)

`preview` advanced under the branch **twice**, so it was rebased twice:
- First rebase hit real conflicts with PR #108 (iOS Save/Export autosave-restore + capability-detect
  IIFEs) and PR #109 (theme-selector fix) — both added bootstrap steps exactly where this branch wrapped
  the bootstrap in the `engine-ready` gate. Resolved "keep both": their new steps now run **inside** the
  gated boot function.
- **Decision-number churn:** the decision was first written as D-GH24, but `preview` had by then used
  D-GH24 (theme) and D-GH25 (leaked-password) → renumbered to D-GH26. On the second rebase it turned out
  `preview` had **explicitly reserved D-GH26 for this exact task** (it deliberately skipped 26, going
  25 → 27), so D-GH26 was correct after all and needed no further change.
- The second rebase (onto the theme-artwork/BUILD-export merges) auto-merged the docs cleanly and touched
  **no** `tools/` or `js/` files, so the browser validation carried over unchanged.

Merged as PR #121 → `preview` (`0abfb19`).

## Follow-up left open

- The roadmap's "Full engine module-bridge migration" task is only **partly** done. `PACT_ROADMAP.md`
  was left untouched (single-writer rule); a revised follow-up task (reconcile the index-based event
  functions + DM's divergent `MUT`) was handed to the owner to fold in. `AGENTS.md` "Active Priorities"
  still lists this as 🔴 NOW and should be refreshed when the roadmap is.
