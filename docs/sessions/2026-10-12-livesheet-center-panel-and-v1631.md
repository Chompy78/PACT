# 2026-10-12 — Wren's second origin class, a more useful Live Sheet center panel, release v1.631

Decision: `decisions/2026/D-GH-2026-10-12-livesheet-center-panel.md`.
PRs: #628 (second origin class), #630 (center panel + player sheet + DM drawback-advice switch), #631 (promotion,
`v1.624` → `v1.631`, tag `v1.631` on merge commit `1afbc43`).

## How it started
Owner report: Wren Ashdown (Ch8-12, Rogue with Wizard as second origin class) saw no Wizard abilities under "Class &
subclass", and Wizard was offered under "Unlock class" for 0 AP.

- **Wren's data was fine.** Her live LOG had no stray `unlockclass` event, so no repair was needed. The fault was display
  plus a missing engine guard.
- **Fix (owner choice A3):** a shared Live Sheet helper `_originClasses(b)` feeds the features row, Unlock classes and
  Subclasses & abilities. The engine also guards it: `purchaseLegality()` now treats unlocking an origin class as a
  duplicate. `engine-legality-ci` compares against a frozen reference, so it was adjusted for this deliberate change
  (it had shown 111 diffs) and gained 3 pinned checks.

## The center panel (owner choices B1, C1, D = DM Console, E1, G1, H1)
- Every skill, owned or not, now shows its ability and total. This comes from a new engine export `skillMods()` so
  the tools don't recompute rules.
- Each boon and drawback has an ⓘ popover. **Found on the way:** drawback tooltips had always been blank, because
  they read `.fx` off a price instead of `DATA.drawbackFx`.
- **Also found:** the Live Sheet's "Needs review" ignored campaign options, and the DM Console roster passed the whole
  campaign row instead of `.rules` to `drawbackCapFromRules`, so the drawback cap never applied there.
- The "more than 3 drawbacks" advice can now be switched off per campaign: `rules.drawbackCountAdvice`, which counts
  as on when absent. No separate switch for boons (E1).
- On desktop, the Buy and History panels fold. The fold state is saved per browser.
- The player sheet holds coins, weapons (to-hit and damage from a new engine export `weaponAttack()`) and named note
  sections. It is stored in `appearance.playerSheet`, because `appearance` is exempt from the server's lock freeze, so
  no migration was needed. Edits rewrite the last appearance patch in place, so they add no history rows.
- A parallel session's #635 later moved Player Name/Backstory etc. into `appearance` too. It adds a shared writer
  `pactWithAppearance()` and fixed CharGen's Setup panel wiping `playerSheet`. The two features coexist.

## Friction
- PRs #628 and #630 both sat at "no checks reported". Each was a merge conflict (DIRTY) caused by other merges into
  `preview`, and rebasing plus a force-push with lease fixed it.
- The first version of the CHANGELOG line for #630 survived the rebase next to the final one, and shipped in v1.631
  as a duplicate. It was removed in the session-close docs commit.

## Left open
- `feat/livesheet-buy-fullpage` (NOW): let the Buy panel take the whole page.
- Not browser-tested: ticking and saving the DM Console "Warn players who take more than 3 drawbacks" checkbox.
