# 2026-07-09 — Expand engine-parity test coverage

## Discussion
Picked via `/pick-task` ("expand the checking system") → the 🟡 NEXT roadmap item
`test/expand-engine-parity-coverage`. The existing 5 fixtures (CG-001/002/003, EV-001, LS-001) only exercise
the empty/valid/over-budget budget-meter path — no coverage of prereq gates, drawback buy-off, racial/mastery
discount stacking, or multi-tradition spellcasting, all called out in the roadmap text as the branches most
likely to silently break under REV-14 (engine split) or the multi-tradition work in Feature A.

## Gap audit
Read `compute()` end to end (js/engine.js:36-363) rather than grepping piecemeal, since the task's whole
point is proving branches, not just finding symbol names. Picked the four highest-value gaps:

1. **Prereq-gate rejection** — gates warn but don't block a purchase (expertise without the skill, weapon
   masteries without any weapon proficiency, medium armour without STR 10, a duplicate non-`rep` feature).
   No existing fixture exercised any of these paths.
2. **Drawback buy-off** — no fixture used a `buyoff` event at all. Worth checking because `activeEvents()`
   pre-scans the *entire* log for `buyoff` entries before replay starts (js/engine.js:416-421,442-459), so a
   bought-off drawback never gets added to the folded build regardless of where the `buy`/`buyoff` pair sit
   in the log — a subtlety worth pinning down before REV-14 touches this replay path.
3. **Racial/mastery discount stacking** — the in-play re-pricing rule (js/engine.js:119-121: a non-pack
   origin racial trait re-prices at `MASTER[currentTier][band]` instead of its creation cost) had zero
   coverage, and neither did the weapon-mastery cost ladder.
4. **Multi-tradition spellcasting** — every existing tradition-related fixture used a single tradition; none
   exercised two separate `traditions[]` entries each paying their own Foundation+Rank overhead (as opposed
   to one tradition with two disciplines, which shares Foundation and only adds `extraDiscCum`).

## Fixtures added
`testing/fixtures/builds/CG-004-prereq-gate-rejection.json`, `CG-005-racial-mastery-discount.json`,
`CG-006-multi-tradition-spellcasting.json`, and `testing/fixtures/events/EV-002-drawback-buyoff.json`.

Rather than hand-deriving expected totals purely on paper, each fixture's numbers were computed by
importing `js/engine.js` directly under Node (the documented CLI-agent method in
`docs/HOW-TO-WORK.md`, mirroring engine-parity.html's own "Capture baseline" logic) and then reviewed by
hand against the DATA ladders and the drawback/racial pricing rules before pinning into
`testing/expected/expected-results.csv`:

- CG-004: total 12, 4 warnings, valid (remaining 38 ≥ 0) — gates inform, they don't reject the purchase.
- CG-005: total 42, 0 warnings — a Halfling's "Naturally Stealthy" trait costs 4 AP at creation but 13 AP
  (`MASTER["4"][2]`) bought in-play at Tier 4, plus 2 stacked masteries at 5 AP.
- CG-006: total 79, 0 warnings — Wizard (Arcane) + Cleric (Divine) as dual origin classes, each tradition
  paying Foundation (6) + Rank 1 (3) independently; Cleric's `prepared` flag correctly zeroes its "known
  spells" cost while still charging for cantrips/slots.
- EV-002: total 36, 0 warnings, `eventsApplied` 4 — the bought-off "Superstitious" drawback ends up in
  neither the folded build's `drawbacks` array nor `compute()`'s total; `economy().available` (14) matches
  `compute()`'s `remaining` (14) exactly, cross-confirming the two independent bookkeeping paths reconcile.

Added one bespoke assertion in `engine-parity.html` for CG-004 (matching the existing CG-003 precedent) that
checks the exact first-warning text, not just the count — a stronger regression signal for the gate-ordering
behavior specifically.

## Verification
`testing/tests/engine-parity.html` requires a browser; no headless runner exists yet (REV-11). Per
`docs/HOW-TO-WORK.md`, verified by importing `js/engine.js` under Node directly against all 9 fixtures with
a script that transliterates the harness's own `runAll()`/assert logic — **9 passed / 0 failed**. `DATA`
and `compute()` were not touched; `DATA.version` unchanged.

## Not done
Did not add coverage for HD/AP-by-level ladder edges (e.g. hitting the level cap) — the four gaps above were
judged higher-value for the immediate REV-14/Feature A risk and the roadmap item's "Done when" only required
prereq-gate rejection, drawback buy-off, and one racial/mastery case. Left as a candidate for a future
`test/` task if it turns out to matter.
