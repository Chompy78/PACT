# D-GH-2026-07-13-log-fuzz-phase2 — LOG-direct pure-Node fuzzer as Phase 2 of the real-oracle plan

Status: Active

- **Context:** Phase 1 (`random-manual-e2e.mjs`, D-GH-2026-07-13-random-e2e-real-oracle) gave the
  DOM-driven harness a genuinely independent oracle, but it's fundamentally limited to LOG shapes
  a real UI click sequence can produce, and Playwright's page-load overhead caps it to a handful
  of iterations per run. `js/engine.js`'s `MUT` map documents a much larger space of LOG event
  shapes (44 mutation categories) that no UI flow exercises directly (e.g. `cat:'species'`/
  `cat:'oclass'` mutators exist and work but the shipped UI only ever sets those via a `cat:'patch'`
  bundle at creation).
- **Options:** (A1) extend `random-manual-e2e.mjs` to occasionally inject raw LOG events between
  UI actions — reuses one harness, but couples LOG-shape coverage to browser/Playwright overhead.
  (A2) a separate, pure-Node script that constructs LOG events directly and feeds them straight
  into `foldBuild()`/`compute()`/`rebuildStateFromEvents()`, no browser at all.
- **Decision:** **A2.** `js/engine.js` is a clean ES module with zero DOM/Node-incompatible code
  (already proven by Phase 1's fresh-import oracle), so this cost nothing beyond writing the
  generator. Result: 2000-3000 iterations in ~1-2 seconds (measured) vs. Phase 1's
  handful-per-run — three orders of magnitude more LOG-shape coverage per CI minute.
- **Design choices worth recording:**
  - **Not trying to generate "legal" characters.** DATA-pool values keep most events realistic
    (real species/class/skill/drawback names) so they exercise real `MUT` code paths, but
    budget/rules legality is already covered by `engine-parity-ci.mjs`'s fixed fixtures and Phase
    1's independent oracle. This tool's question is narrower and doesn't need a legality model:
    does the engine ever throw/NaN/self-disagree on *any* MUT-shaped LOG.
  - **Deliberate "wild" indices.** `found`/`rank`/`cantrip`/`slot`/`known`/`dbound` mostly
    reference tradition/discipline indices the generator itself created (via a small `ctx` that
    mirrors `MUT.found`'s indexing logic), but ~15% of the time hand them a random out-of-range
    `ti`/`di`, and slot/known `L` is occasionally forced outside 1-9 — confirmed safe (`MUT`'s
    handlers are null-guarded on a missing discipline) but worth fuzzing anyway since that's
    exactly the array-boundary class of bug most likely to hide from hand-written fixtures.
  - **Dual-entry-point check compares `.result`, not `.build`.** `rebuildStateFromEvents(null,
    LOG).build` and `foldBuild(LOG)` differ on one cosmetic key (`seedBuild()` always normalizes
    `houseRules` to `{}`; `baseBuild()` leaves it absent until a `tasharule` event lazily creates
    it) — confirmed harmless by hand (`compute()` output is byte-identical either way) before
    shipping, but comparing raw `.build` would have made EVERY run report a false "disagreement,"
    burying real findings under permanent noise. Compare on `.result` (what every UI/DM-Console
    surface actually reads), not on the internal replay shape.
  - **Shrink is single-element delta-debug to a fixpoint, not full ddmin.** Removes one event at a
    time (back-to-front, restart-on-success) while the same tagged failure still reproduces. Not
    maximally minimal (a real ddmin also tries removing larger chunks first), but simple, fast
    enough for LOGs capped at ~40-60 events, and turned every failure found so far into a 1-2 event
    reproducer — good enough that the more complex algorithm wasn't worth building yet.
- **A real bug found on its first run, and a process lesson alongside it:** a caster with a very
  low ability score (e.g. INT 5, mod -3) and HD 1 makes `compute()`'s known-spell cap
  (`dmod+hd`) go negative; the over-cap surcharge loop then reads past the end of an empty
  `knownUnits` array, producing a `NaN` in `discInfo[].cost` (display-only — `compute()`'s
  `total`/`remaining` are unaffected, since the surcharge is folded in behind an `if(knownAP)`
  guard that a `NaN` fails). Caught in the *building* of this tool, not by intent — the fix is a
  one-line `Math.max(0, dmod+hd)` clamp, already root-caused and verified locally. **It is
  deliberately NOT included in this PR**: mid-build, an unscoped edit to `js/engine.js` (a
  high-risk file per AGENTS.md) was made directly on `preview`, outside any branch, with no
  `testing/expected`/`DATA.version` review — caught by the permission system before it could be
  committed, not by self-discipline. Reverted; logged as its own roadmap task instead (see the
  next `docs/PACT_ROADMAP.md`-format block handed to the human). Lesson for next time: finding a
  bug while building an unrelated tool is not an invitation to fix it inline — even a fix that's
  fully understood and low-risk still needs its own branch and its own pass through the
  engine-change checklist (parity fixtures, `DATA.version` judgment call, `/code-review`).
- **Why not wire CI yet (at the time):** the bug above reproduces on ~0.5-1% of individual
  iterations, which is a near-certainty within any 2000-3000 iteration run — wiring
  `log-fuzz.mjs` into `.github/workflows/engine-parity.yml` right then would have made every
  future PR touching `js/engine.js` fail on a pre-existing, unrelated defect.
- **Follow-up landed the same day:** the `knownCap` fix shipped on its own branch
  (`fix/engine-knowncap-nan`, `DATA.version` v0.335→v0.336 — see the CHANGELOG entry), verified
  via `engine-parity` (20/0) and 15,000+ clean `log-fuzz.mjs` iterations, and `log-fuzz.mjs` is
  now wired into `.github/workflows/engine-parity.yml` as a `log-fuzz` job.
- **Status:** **In force** (the tool itself). The "not yet wired into CI" caveat above is
  resolved — CI wiring is live as of the `knownCap` fix.

---
