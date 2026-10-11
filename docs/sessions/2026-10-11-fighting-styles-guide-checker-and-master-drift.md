# 2026-10-08 → 2026-10-11 — Fighting Styles flat; the guide checker's blind spots; a master that is 54 tables behind

Continues `2026-10-05-subclass-purchase-guard-and-guide-reconciliation.md`. Written down because the second half turned
"fix one stale Ranger row" into "the master guide has drifted far further than anyone knew".

## What shipped
- **#594 — Martially Bound no longer discounts Fighting Styles** (`DATA.version` v0.371 → v0.372). The owner chose the engine side (the guide
  always said "priced flat regardless of class"). A `noMB` flag on the four Fighting Style features and the two other data copies of Additional
  Fighting Style, read by `_mbAdj`. Fixtures CG-066..068 (flat Fighter, flat Ranger, an ordinary bound-class feature as the control); ignoring the
  flag in the engine fails five checks. Record: `D-GH-2026-10-08-martially-bound-fighting-styles-flat`.
- **#597** — the earlier session note's two "owner's call" lines now say resolved.
- **#602** — three cold reviews that existed only in the gitignored `z-cold/processed/` are filed under `docs/plans/cold-reviews/`
  (hash-checked first: none was already archived; bodies verified identical before the originals were deleted).
- **#604 — the guide price checker's blind spots**, a local master-vs-served table diff, and the missing Ranger row added to the master.
  Record: `D-GH-2026-10-11-verify-guide-blind-spots`.
- Live data: the two DM review copies of the character that had held one ability through both purchase doors were deleted (a guarded delete
  by id, owner, no campaign and 0 AP); the real character was re-read afterwards and is unchanged.
- Two board tasks added for the owner's decisions: Improved Combat Superiority, and Gloom Stalker's Iron Mind.

## Pivots
1. **Blast radius measured before the change, not assumed.** The live check (55 characters, 4 Martially Bound, all Rogue, 0 Fighting Style
   purchases, with Sneak Attack as a positive control) is why the change could ship without a migration.
2. **"Promote to main" was already done.** The request came after PR #599 had promoted `preview`, and `main` already carried v0.372. Checking the
   branch state before opening a promotion PR avoided a redundant one; only 4 docs commits were ahead.
3. **The checker had a bug nobody was looking for.** Writing a reason for each listed row showed that Paladin's Fighting Style was "ambiguous" even
   though the table's class was Paladin: candidates were collapsed by identical numbers before the class was applied, and Paladin's entry has the
   same numbers as Ranger's. That row had never been compared. Narrowing by class first fixed it, and a deliberately wrong Paladin price now fails.
4. **One row became 54 tables.** The task said the served Ranger table had one row the master lacked. Adding a table diff to find "any others" found
   54 differences: price rows (Monk, Sorcerer, Warlock, Druid, Barbarian) where the served copy matches the engine and the master does not, rewritten
   Premium / Sneak Attack / Rage / class-unlock prose, and different Boon and Drawback tables. A transfer from the master today would regress prices.
5. **The first diff was mostly noise.** Pairing tables by position turned one added table into over a hundred phantom differences. Pairing by content
   similarity brought it to 54. The remaining limit (greedy pairing over a small window) is written into the script.
6. **Two guide rows that look like real disagreements with the engine** (Improved Combat Superiority "Included in Premium" vs sold at 14 (10);
   Iron Mind "Barred" with status "Buy" vs sold at 14 (11)) were found only because an allow-list now forces a reason. They are in the allow-list as
   OPEN QUESTIONs (counted in the checker's summary so they stay visible) and on the board.

## Smaller things worth remembering
- The first attempt to merge #594 failed on a board conflict: `preview` had gained two tasks while the branch removed the graduated one.
  Resolution was to keep the new tasks and the removal.
- The database approval step errored twice ("Invalid or expired requestState") on the delete before a third attempt went through. Nothing had
  changed in between; the read-back before and after is what showed the delete had not partly happened.
- A docs-only or test-script-only PR gets no CI checks here (#597, #602, #604 reported none); the relevant checks were run locally and said so.

## Still open
- Reconcile the pact-guide master with the served copy (board: "The pact-guide master has drifted far behind the served Players Guide…").
- The two guide-vs-engine decisions (board tasks `fix/improved-combat-superiority-decision`, `fix/gloom-stalker-iron-mind-decision`).
- Promoting `preview` to `main` again when there is something user-facing; re-measure live data first.
