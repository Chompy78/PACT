# Session — REV-14a: extract DATA out of `js/engine.js` (2026-07-17)

**Branch:** `claude/task-skill-breakup-engine-hhxfig` → PR #251 (merged into `preview`, `c2bd9b2`).
**Outcome:** `DATA` now lives in `js/engine-data.js`; `engine.js` imports + re-exports it unchanged.
`engine.js` dropped ~189 KB → ~65 KB. No rules change.

## What this session was, and how the scope grew
Started as the first half of REV-14 ("break up `engine.js`"), scoped to just extracting `DATA`. It grew —
by necessity, not scope-creep — into **three commits** because moving `DATA` surfaced two adjacent things
that would otherwise have shipped broken or stale:
1. `refactor(engine)` — the extraction itself **plus** a `service-worker.js` fix.
2. `chore(version)` — BUILD `v0.200 → v0.201`, mirrored across the three tools.
3. `fix(chargen)` — a pre-existing rules-version display drift (`v0.332` shown vs real `DATA.version`
   `v0.336`) caught in passing.

## Decisions a future agent might second-guess (all deliberate)
- **`.js` module, not the `.json` the task named.** Driven by a 4-model cold review
  (`docs/plans/2026-07-17-engine-breakup-rev14.md`). Decisive reason (Kimi's catch): **JSON modules are
  frozen in some engines**, and all three tools' bridges mutate `DATA.racialFx`/`masteryFx`/`drawbackFx`
  onto the imported object — a frozen import would throw `TypeError`. `.js` also matches the existing
  `ap-by-level.js`/`advancement.js` precedent and sidesteps iOS-Safari import-attributes support. Full
  rationale: `DECISIONS.md` → `D-GH-2026-07-17-engine-data-extract`.
- **Service-worker change was mandatory, not optional.** `engine.js` is **network-first** so rules fixes
  reach returning users immediately. Moving the rules dataset into a new file that fell into the default
  **cache-first** branch would have silently made rules updates go stale until cache eviction. Fix:
  `engine-data.js` is now precached **and** network-first (cache `pact-v5 → pact-v6`), preserving the
  pre-refactor propagation behaviour.
- **CharGen rules-display fix was shallow by choice.** CharGen hardcodes its rules-version label (Live
  Sheet / DM Console read `DATA.version` live). I synced the hardcoded value and corrected the misleading
  comment, but left the *deeper* fix (make CharGen live-read it too) as a follow-up rather than expand this
  branch's runtime footprint.

## Verification
Byte-identical `DATA` (raw string + deep-equal, 193,352 bytes both sides); `engine-parity` **20/0** incl.
warnings; all 14 named exports unchanged; real-browser boot of all three tools (Chromium) confirming
`engine-ready` fires and the bridge `DATA` mutation succeeds (i.e. `.js` is not frozen); local max-effort
`/code-review` returned **0 findings**; all 5 CI checks green; merged clean.

## Follow-ups surfaced (for the human to fold into `docs/TASK_BOARD.md`)
- **REV-14b** — split `compute()` into named sub-pricers (the riskier second half; plan already drafted,
  with a pre-flight data-flow map + `_raceTraitLocked` span check as prerequisites).
- **CharGen live-read its rules version** — remove the last hardcoded rules-version mirror.
- **Stale `AGENTS.md` version parentheticals** — it still says BUILD "currently v0.107" (real v0.201) and
  rules "currently v0.332" (real v0.336).
