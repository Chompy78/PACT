# D-GH-2026-09-05-roller-headless-access — a real-browser headless roller, not source-extraction

**Status:** Implemented · `testing/scripts/roll-headless.mjs` · branch `claude/random-char-generator-1thuv6`.

## Context

`cm-pact-campaign` needed the 🎲 roller's output for party-spread analysis (the same work that found
D-GH-2026-09-05-roller-build-shapes) and got it by regex-extracting `randomizeRoll()`'s source out of
`tools/PACT-CharGen-Webtool.html` and evaluating it in a bare vm. That technique is exactly how fault #3
of that bug happened: lifting the function out of the file it's declared in put `apLevel` out of scope,
and the old code's silent `: 9` fallback built a wrong-but-plausible character with nothing to report it.
Source-extraction measures a decontextualized copy of the roller, not the roller — the class of drift
`AGENTS.md` warns about for rules code, here applied to a UI function instead of `engine.js`.

## Options

- **A — a reusable headless-Chromium script.** *(chosen)* Package the zero-dependency CDP technique
  `random-quality-ci.mjs`/`tool-pricing-ci.mjs` already use for CI into a small, self-contained,
  drop-in-portable script that drives the real tool and returns the real build + `compute()` result.
- **B — extract `randomizeRoll()` into a DOM-free module** (`js/randomizer.js`) importable directly from
  Node, no browser needed. The durable fix, but a real refactor — ~30 mutator closures currently coupled
  to ~50 tool-local names (`b`, `LOG`, `tryAct`, `applyBuild`, `flash`, DOM elements, `_histSuspended`,
  the creation-lock carry-over logic). Matches `AGENTS.md`'s own cold-plan-review trigger (multi-file,
  architectural, wrong-approach cost > one cycle) — deferred, not rejected.
- **C — document the extraction contract** rather than replace it. Cheapest, but leaves the actual
  fragility (a silent scope-loss bug being possible at all) in place by design.

## Decision

**A.** `testing/scripts/roll-headless.mjs` — same `findChrome`/serve/CDP-`connect` primitives as the
existing CI gates, kept **inlined rather than shared from `testing/scripts/lib/`** so the single file
stays copy-portable into a sibling project that doesn't check out all of PACT. CLI: `--theme`, `--budget`
(both comma-listable), `--count`, `--class` (forced origin class), `--out`, and `--list-themes` for
introspecting theme metadata and `DATA.levelAP` without rolling. Output is the tool's own `readBuild()`
build plus the matching `compute()` result, unmodified — not a curated summary — so a consuming project
gets exactly what a person clicking 🎲 in a browser would get.

## Why

- **Never re-implement rules/generation logic outside its own file** — the same principle `AGENTS.md`
  states for `engine.js` applies here: this script contains zero roller logic of its own, only browser
  plumbing. If `randomizeRoll()` changes shape, this script's output changes with it automatically.
- **Every global `randomizeRoll()` expects is present, because nothing is lifted out of scope.** This is
  the direct fix for the failure mode that motivated the change — `apLevel` (and everything else) exists
  exactly as the tool declares it, so an out-of-scope failure like fault #3 cannot recur through this path.
- **B is real but wide-reaching, not this task.** Disentangling 30 closures from tool-local state the
  session that fixed the HD cap explicitly relied on (the creation-lock carry-over ordering, the
  undo-frame suspension) is exactly the shape of change this project's own conventions say gets a Plan
  pass and a cold plan review first, not a same-conversation implementation.

## Verification

Ran directly: `--list-themes` returns all 8 themes' metadata and the `DATA.levelAP` table; a real roll
batch (`--theme=bruiser --budget=85 --count=5`) returned Hit Dice 2-4 and hit points 15-27 — inside the
real Amble party's reported range, using the fixed roller from D-GH-2026-09-05-roller-build-shapes; a
multi-theme/multi-budget batch with `--out` wrote a valid JSON file of the expected row count; the
missing-`--budget` path fails with a clear message and exit code 1 rather than a stack trace.

Not yet done: nothing in this repo can install the file into `cm-pact-campaign` (out of this session's
GitHub scope) — that project needs to either vendor this one file (same pattern `pact-guide`'s
`py/vendor/engine/` already uses for PACT's engine files, with the same expectation of periodic
re-sync) or point `--repo` at a sibling PACT checkout if it has one.
