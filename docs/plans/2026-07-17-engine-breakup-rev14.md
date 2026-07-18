# Plan: REV-14 — break up js/engine.js (extract DATA, split compute into sub-pricers)

## Goal
Improve the maintainability of `js/engine.js` — the single-source-of-truth rules module for a static
tabletop-RPG web tool — by (a) moving its giant static `DATA` ruleset table into its own file, and
(b) breaking its one ~370-line `compute()` function into named sub-functions ("sub-pricers"), **with
provably identical engine output**. This is a readability / parse-time / editor-ergonomics refactor (and
lets the ruleset table cache on a different cadence than the engine logic). It is **not** a page-weight
reduction — both files still load — and it must change zero rules behaviour.

## Context
- **Project shape:** static site on GitHub Pages — **no build step, no bundler, no npm, no frameworks,
  vanilla JS only** (verified hard rule). `js/engine.js` is a browser **ES module**.
- **File structure today (verified):** `export const DATA = {…}` is one enormous object literal on a single
  physical line (line 47) — the bulk of the 189 KB. `compute()` runs lines 76–446 and holds all pricing in
  local mutable state: a running `total`, ledger array `L` (`L.push([label, ap])`), warnings array `W`
  (`W.push(text)`), computed `mod`/`effScore` maps, and inner closures like `add(label, ap)`. The body is
  already sectioned by comments (ability scores → proficiency → Vigor/Grit → saves → skills/expertise →
  languages → attunement → arts → weapon prof → weapon masteries → armour → heritage/racial traits).
- **Public API that must stay stable (verified export set):** `BUILD`, `DATA`, `compute`,
  `rebuildStateFromEvents`, `baseBuild`, `MUT`, `activeEvents`, `economy`, `foldBuild`, `validate`,
  `RULE_BAN_FIELDS`, `SIG_ALG`, `signPayload`, `verifyPayload`. Three HTML tools import a subset via a
  `<script type="module">` bridge that copies them **synchronously** onto `window`, then fires an
  `engine-ready` event the UI waits on. Each tool's bridge also **mutates** display-only maps
  (`DATA.racialFx`/`masteryFx`/`drawbackFx`) onto the imported `DATA`. **`DATA` is consumed synchronously.**
- **Why now:** REV-14's prerequisite REV-01 ("make the regression gate assert real values instead of
  hard-coding pass=true") **already shipped** (verified, landed 2026-06-30) — so identical output can now be
  tested, which is what made this unsafe before.
- **Target browsers (verified):** modern evergreen incl. **iOS Safari**; prefer widely-supported JS/CSS.

## Assumptions vs. verified facts
- **Verified:** file structure/line ranges; no-build-step / vanilla-JS / static-hosting constraints; full
  export set; `DATA` consumed synchronously by both `compute()` and the bridge; the bridges mutate `DATA`
  by property assignment; parity harness now asserts real values; current target = **20 tests / 0 failures**
  (20 data rows in `testing/expected/expected-results.csv`).
- **Verified caveat (load-bearing):** REV-01's follow-up flagged a **known fixture-coverage gap on some
  `W.push` warning-text branches** — not every warning branch is exercised. So "20/0 passes" proves
  identical numeric/ledger output but **not** identical warning text on untested branches. The
  "provably identical" claim therefore only holds for covered paths unless that gap is closed first.
- **Assumed (reviewer-flagged, now mitigated):** that `compute()`'s sections are cleanly separable — this
  is exactly what the Phase-2 pre-flight data-flow map (below) is meant to confirm, not assume.

## Proposed approach
Two **independent PRs**, shipped in order. REV-14a is low-risk and lands first; REV-14b is gated on it.

**PR REV-14a — extract `DATA` (default: a `.js` module).**
1. Move the `DATA` literal into **`js/engine-data.js`** as `export const DATA = {…}`. (Chosen over
   `engine-data.json`: `.js` imports synchronously with zero new browser-feature surface, preserves the
   ability to add comments to the ruleset table, avoids the JSON-representability assumption, and — decisive
   — sidesteps the fact that JSON modules are **frozen** in some engines, which would make the tool bridges'
   `DATA.racialFx = {…}` mutation throw a `TypeError`. If strict `.json` is externally required, revisit
   with an explicit mitigation for the frozen-mutation problem.)
2. In `engine.js`, replace the literal with `import { DATA } from './engine-data.js'` and re-`export` it, so
   every importer and the `window` bridge see an unchanged surface.
3. Verify the bridges can still mutate `DATA.racialFx`/`masteryFx`/`drawbackFx` (a `.js` module export is a
   live mutable object, so this holds — but confirm, since it's a silent failure the parity harness can't
   catch).

**PR REV-14b — split `compute()` into named sub-pricers.**
4. **Pre-flight (prerequisite, no code change):** produce a data-flow map of which `compute()` locals each
   commented section *reads* vs *writes* (`total`, `L`, `W`, `mod`, `effScore`, `add`, and any "first-
   occurrence"/suppression state). Confirm where inter-section reads exist. Also confirm the exact line span
   of the `_raceTraitLocked` creation-lock logic so extraction-by-comment-boundary can't split it.
5. **Design — shared mutable context, not return-deltas.** Extract each section into a named `_price*`
   function that takes one shared context object (`{total, L, W, mod, effScore, add, …}`) and mutates it
   exactly as the inline code did. This preserves side-effect order and hidden temporal dependencies;
   return-and-merge is explicitly rejected because it forces every inter-section dependency to be made
   explicit, which is where silent drift creeps in.
6. **Extract incrementally:** one section per commit, run parity after each, so any regression is bisectable.
   `compute()` ends as setup + a fixed ordered sequence of `_price*` calls + return assembly, same signature
   and return shape.

## Files involved
- `js/engine.js` — remove inline `DATA` (import + re-export); refactor `compute()` body into ordered
  `_price*` calls. No API/signature changes.
- **new** `js/engine-data.js` — the extracted ruleset table.
- `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html` — expect
  **no change**, but each must be re-verified (module load timing + the `DATA` mutation).
- `testing/tests/engine-parity.html` + `testing/expected/expected-results.csv` — proof harness; extend
  (dev-only) to hash the full return payload if that's the chosen warning-gap method.

## Out of scope
- Any change to rules, prices, ladders, gates, or `compute()` output values.
- Changing the `_raceTraitLocked` / creation-lock *logic* (moved verbatim in REV-14b, kept whole per the
  pre-flight span check).
- The separate `chore/engine-review-cleanup` hardening batch.
- **In scope for REV-14b as a prerequisite, not out of scope:** closing the warning-text fixture gap (see
  Risks) — either expand fixtures first, or explicitly narrow the guarantee.

## Alternatives considered
- **`engine-data.json`** — rejected as default (frozen-module mutation risk + iOS-Safari import-attribute
  risk + representability assumption; identical maintainability payoff). Kept only if externally required.
- **`fetch('engine-data.json')` at runtime** — rejected: async, but `DATA` is consumed synchronously; would
  ripple through every caller and the `engine-ready` timing.
- **Return-deltas sub-pricers** — rejected in favour of shared mutable context (see approach #5).
- **DATA-only, leave `compute()` alone** — this *is* the plan now (REV-14a alone), with REV-14b as a gated
  follow-up rather than a bundled phase.
- **Inner closures vs top-level `_price*`** — top-level chosen for navigability.

## Risks / open questions
- **Identical output is the whole game**, and the **known warning-text fixture gap** means some `W.push`
  branches are unverified — a wording change there could ship silently. *Resolution:* the full-payload hash
  check (Verification) covers all warnings *reached by the 20 fixtures*; for branches no fixture reaches,
  either add fixtures first or state explicitly that the guarantee covers tested paths only.
- **Hidden temporal dependencies** between sections — mitigated by the pre-flight data-flow map (#4) and the
  shared-context design (#5).
- **Tool `DATA` mutation** must survive the extraction — verified via a live interaction, not just boot.

## Verification
- `testing/tests/engine-parity.html` → **20 passed / 0 failed** (current baseline), "Run tests (assert)"
  mode against `expected-results.csv`.
- **Full-payload equality (replaces "eyeball"):** for all 20 fixtures, hash the *entire* `compute()` return
  (totals + ledger `L` + warnings `W`) before vs. after; hashes must match. Explicitly list any `W.push`
  branch not reached by any fixture — those are outside the mechanical guarantee.
- **Export-surface golden test:** `import * as E` and assert `Object.keys(E).sort()` equals the recorded
  14-name golden list.
- **Tool boot + interaction:** each of the three tools must fire its `engine-ready` event, render, **and**
  complete one interaction that touches `DATA` (e.g. selecting a race in CharGen) — proving the mutated
  display maps still attach. Include a WebKit/iOS-Safari boot check (low risk now that `.js` is the format).
- Confirm `DATA.version` **unchanged** and no `BUILD` bump (no rules change).
- **Rollback:** `git revert` the PR if any tool's `engine-ready` fails to fire after deploy.

## Done when
- **REV-14a:** `DATA` lives in `js/engine-data.js`; `engine.js` re-exports it unchanged; parity 20/0;
  export golden test passes; all three tools boot + interact; no consumer import paths changed.
- **REV-14b:** `compute()` is a dispatcher over named `_price*` helpers (shared-context design), unchanged
  signature/return shape; full-payload hash identical across all 20 fixtures; warning-branch coverage note
  recorded; parity 20/0.

---

## Reviewer instructions
**Before anything else, state which AI model and settings you are** (e.g. "GPT-5.5 (default)", "Claude Opus
4.x", "human reviewer") as the first line of your response. The author uses this to weight findings.

You are reviewing this plan **cold, with no access to the codebase** — only the text above. Judge the plan's
**logic, clarity, scope, and risk — not code correctness you cannot verify.** If the plan relies on
knowledge you don't have, that itself is a finding. Specifically:
1. Does the approach achieve the goal?
2. Which **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated?
4. What's missing — an edge case, risk, dependency, or **verification step**?
5. Are "Verification" and "Done when" objectively checkable?
6. Is the two-PR split right? Is anything in "Out of scope" load-bearing?

Write findings as a plain list (gaps, improvements, verdict); don't rewrite the plan. **If a section is
solid, say so briefly** rather than inventing concerns. **Deliver as a Markdown file** named
`engine-breakup-rev14-review-<your-model>.md`, led by your model line; if you can't emit a file, give the
review as one copy-pasteable Markdown block.

---

## Review outcome (filled in after the cold review round)
- **Reviewers (models):** Claude Opus 4.7 (Copilot), Kimi (Moonshot, default), GPT-5.5 (default), and a
  fourth of ambiguous provenance (filename "deepseek", self-identified as "Claude 3.5 Sonnet").
- **Reviewer findings:** ~12 distinct → accept 12 / reject 0 / defer 0. Convergence was unusually high;
  the only material departure from the original task text (the `.json` → `.js` format flip) was recommended
  4/4.
- **Materially changed the plan? Yes.** The review (1) flipped the DATA file format from `.json` to a `.js`
  module — Kimi's frozen-JSON-module `TypeError`-on-mutation mechanism was decisive; (2) split the single
  two-phase plan into two gated PRs (REV-14a ships alone first); (3) replaced the "eyeball the warning
  strings" check with a mechanical full-payload hash/diff across all 20 fixtures; (4) committed the
  sub-pricer design to shared mutable context (GPT-5.5) instead of return-deltas; (5) added a pre-flight
  data-flow map + `_raceTraitLocked` span check as a Phase-2 prerequisite; (6) added an export-surface
  golden test; (7) corrected the goal (dropped the false "page-weight win").
- **Without the review, what would have happened:** likely shipped a `.json` module that throws
  `TypeError` in tool bridges on engines that freeze JSON imports, bundled two unequal-risk refactors into
  one PR, and relied on a manual eyeball check that can't prove warning-text stability.
