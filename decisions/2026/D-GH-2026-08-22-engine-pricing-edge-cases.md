# D-GH-2026-08-22-engine-pricing-edge-cases — four js/engine.js pricing edge cases, DATA.version v0.358 → v0.359

## Context
The 2026-08-22 full-tool audit found four defects in `js/engine.js`'s `compute()`/`activeEvents()`,
grouped into their own branch (rather than the mechanical tool-fixes batch, `D-GH-2026-08-22-audit-
batch-mechanical-fixes`) because all four touch the rules engine — this repo's single source of truth,
its own documented high-risk file — and three of the four change `compute()` output for edge-case
inputs, which per `AGENTS.md`'s versioning rule requires one shared `DATA.version` bump and one
`testing/expected/` update rather than four separate ones.

**The four findings:**

1. **Uncapped Attunement/Ki/Sorcery price ladders go free or refund AP past the table's end.** All three
   tracks are deliberately uncapped by design (no Hit-Dice gate — a player can keep buying indefinitely),
   but the underlying price tables still END (13/25/21 entries). `DATA.table[n] || 0` fell through to 0
   once `n` ran past the last index. Verified live-reachable: none of the three are in Live Sheet's
   `_CTX_PRICERS` special-case list, so their marginal cost is computed as a whole-build `compute()`
   delta — which goes **negative** the instant the boundary is crossed (`attune 12→13: −180 AP`,
   `ki 24→25: −156 AP`, `sorcery 20→21: −90 AP`, measured by executing the shipped engine directly).
   Reachable purely by clicking Live Sheet's existing "buy the next one" buttons repeatedly — no LOG
   editing, no tampering. Ki in particular has no HD gate and a 25-entry table, plausibly reached in
   ordinary long high-level play.
2. **No upper bound on ability scores.** `compute()` warns when a score is below 6 but had no equivalent
   check above 20 (`DATA.ABIL` only defines keys 2-20). A build with STR 25 cost 40 AP less than one
   with a legitimately-bought STR 20, while giving a strictly better modifier. Not reachable through
   CharGen's shipped stepper (hard-capped 2-20) — but `compute()` is the single source of truth every
   caller trusts, including a hand-edited save or DM Console's edit path.
3. **Duplicate class-unlock events double-charge AP.** Unlike proficiency lists (deduped every replay)
   and features (an explicit "already bought" guard), `unlockedClasses` was priced off raw array
   length with no ownership check — a second identical unlock event charged a full extra 8 AP even
   though the *gating* logic elsewhere already treated it as one class.
4. **`activeEvents()`'s FIFO matching trusts `payload.v`/`refVal` with no null guard.** A malformed
   drawback/boon event missing its value field, and a later malformed buyoff/removal event missing its
   reference field, both keyed into the same `undefined` bucket and could incorrectly cross-match. No
   crash — a silent state-corruption path, and needs an already-malformed LOG to trigger (neither
   shipped tool's own `emit()` calls ever omit these fields).

## Decision
Fixed all four with the minimal, already-proven pattern in the same file rather than inventing a new
one:

- **Ladders (finding 1):** clamped the lookup index to each table's last valid entry
  (`DATA.attune[Math.min(attune, DATA.attune.length-1)]`, same for `kiCum`/`sorcCum`) — the exact
  pattern `unlockCum`'s cumulative lookup already uses, whose own comment states the lesson this fix
  re-applies: *"a clamp under-charges at worst; `|| 0` paid the player."* Also fixed the Ki resource-gate
  warning check (`js/engine.js` ~line 434), which read the same unclamped table for a different
  purpose (checking a character owns ≥1 Ki point) — before the fix, a character who owned MANY Ki
  points past the table boundary would incorrectly read as owning zero and get warned to buy Ki first.
  Considered a closed-form formula rewrite (the path Grit took, per `_gritPrice(n)=2*n`) instead of a
  clamp, but rejected it as unnecessary extra surface: unlike Grit, none of these three ladders carry
  Grit's "designed to keep growing past today's table" framing — a clamp is the smaller, lower-risk diff
  that fully closes the reachable bug.
- **Ability scores (finding 2):** clamped the AP-cost lookup to `[2,20]` inside `compute()` itself, with
  a new warning symmetrical to the existing below-6 one. Deliberately scoped the clamp to only the
  pricing lookup — `effScore`/`mod` (the character's actual displayed/used score, which can legitimately
  exceed 20 via epic-boon flat bonuses, separately clamped at 30) are untouched, so this fix stops an
  inflated score from being *free*, not what it nominally means for display purposes.
- **Duplicate unlocks (finding 3):** extended `_dedupeProfLists()`'s existing nine-list dedupe to a
  tenth, `unlockedClasses` — the one with a demonstrated, unambiguous double-charge. Deliberately did
  **NOT** extend it to `arts`/`boons`/`subAbilities`, despite the original audit finding grouping all
  four together: whether a duplicate there should dedupe, refund, or be blocked outright is a genuine
  rules question this fix has no authority to answer unilaterally, and extending the dedupe silently
  would be making that call by default rather than by decision. Left unfiled as a task (see "Why" below)
  rather than queued — the question is open, not scheduled.
- **Null guard (finding 4):** added an early skip (`if (v == null) return` / `if (e.refVal == null)
  return`) in the FIFO matching loop for all four event-type branches (drawback buy, buyoff, boon buy,
  dmRemoveBoon). Purely defensive — no output change for any valid LOG, since neither tool's `emit()`
  ever omits these fields.

**Verification.** Five new fixtures pin the boundary/edge-case behavior going forward: `CG-033` through
`CG-036` (builds, one per ladder/ability-score case) and `EV-020` (events, the duplicate-unlock case —
needed a LOG-replay fixture rather than a raw build, since `_dedupeProfLists()` only runs inside
`_replay()`, not inside `compute()` itself). No fixture was added for finding 4 — the bug needs an
already-malformed LOG to trigger, and constructing one cleanly would have entangled the test with
`compute()`'s unrelated handling of an undefined drawback name; the fix was verified by direct code
reading instead, consistent with the original audit's own "no parity fixture needed unless..." framing
for this specific finding. `testing/tests/engine-parity.html`'s hardcoded `FIXTURES` manifest was updated
to match (a separate CI check catches manifest/CI drift automatically). Ran the full test battery, not
just the two headline gates: `engine-parity-ci.mjs` 57/0 (52 existing + 5 new), `tool-pricing-ci.mjs`
163/0 (confirms no regression in either tool's UI), and `log-fuzz.mjs` (500 random LOG iterations, no
throws/NaN/self-disagreement) — the fuzzer is exactly the kind of check that would have caught a
regression in the clamp/dedupe/guard logic across inputs no hand-written fixture would think to try.

**`DATA.version` v0.358 → v0.359.** Per `AGENTS.md`, any `compute()` output change requires a version
bump — findings 1-3 all change output for previously-out-of-bounds/malformed states (finding 4 alone
would not have required one, being purely defensive). `BUILD` (the cosmetic web-tool version) is
untouched — per `docs/VERSION-SYNC.md` that only bumps once, during the `preview`→`main` promotion PR.

## Why
**Not a Players Guide change.** `AGENTS.md`'s rule that "a mechanics change isn't finished until the
engine AND the guide land it" does not apply here: none of the four fixes change what the rules
*intend* — Attunement/Ki/Sorcery were always meant to be uncapped-by-design (just not free), ability
scores were always meant to cap at 20 (CharGen's own UI already enforces it), and one unlock per class
was always the intended charge (the gating logic already treated duplicates as one class; only the
pricing disagreed). Each fix brings the engine's *enforcement* in line with a rule that was already
correct on paper — restoring already-intended behavior, not introducing a new one. Stated explicitly
here because this repo has been burned before by an unstated "is this a mechanics change" judgment call
drifting the engine and the guide apart silently (see `D-GH-2026-08-12-grit-steep-ladder`) — better to
say plainly why this case is different than to leave it implied.

**Why `arts`/`boons`/`subAbilities` stay unfiled, not just undecided.** The pattern this repo uses
elsewhere (see `D-GH-2026-08-22-audit-batch-mechanical-fixes`'s treatment of the HP-sync deep-fix
question) is: a genuine open design/rules question that hasn't been decided doesn't get a task-board
entry, because filing one implies a decision-in-waiting rather than a decision-not-yet-made — and a
stale "TODO: decide X" item is exactly the kind of task-board noise that erodes trust in the board as a
signal. The question is recorded here, in the one place a future session (or the owner) would look for
it, rather than as an unscoped board item nobody is positioned to actually pick up.

**Why this branch, separately from the mechanical-fixes batch.** `js/engine.js` is this repo's own
documented highest-risk file, and three of these four fixes change `compute()`'s output — a different
risk tier from the tool-only UI fixes in the sibling batch, which touched no rules logic and needed no
version bump. Bundling all four engine findings into one branch/PR/version-bump was the original audit's
own suggestion (each NOW/LATER task entry pointed here), and it holds up: one `DATA.version` bump, one
`testing/expected/` update, one PR to review against the engine's stability bar, instead of four.

## Status
Implemented on `fix/engine-pricing-edge-cases`, off `preview` at the post-PR-#450 tip. `engine-parity-
ci.mjs`: 57/0. `tool-pricing-ci.mjs`: 163/0. `log-fuzz.mjs`: 500/500 iterations clean. `DATA.version`:
v0.358 → v0.359. `docs/TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` graduated for all four findings; the
arts/boons/subAbilities question is recorded above, not on the board.
