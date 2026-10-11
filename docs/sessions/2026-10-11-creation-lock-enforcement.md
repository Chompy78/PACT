# 2026-10-11 — creation lock: visible, refuses other species' traits, freezes creation Vigor

Branch `fix/creation-lock-enforcement`, PR #617. Decision: `D-GH-2026-10-11-creation-lock-enforcement`.

## What the owner reported

1. CharGen and the Live Sheet don't show that a character has finished creation.
2. After the lock, CharGen still sells traits from species that aren't the character's origin.
3. Vigor bought earlier gets dearer when Hit Dice rise, instead of keeping the price it was bought at.

## What was actually wrong

- **1** was display only. Both tools hid "Finish creating" on lock and showed nothing in its place.
- **2** was never enforced anywhere. The guide (§10) says other-race traits are creation-only; the engine
  priced them at `cross` regardless of lock state. Both tools already send post-lock purchases through
  `purchaseLegality()`, so a single hard warning in `compute()` covers both.
- **3** looked like a missing feature, but the engine already prices Vigor per rank at the tier stamped on
  it (`_vigorRankTier`). The real gap: only `cat:'vigor'` events get stamped, and CharGen writes creation
  Vigor as a `patch` of `hardy`. Post-lock Vigor (CharGen emits real `vigor` events then) was never
  affected. Reproduced in a browser: 2 ranks 10 AP → 28 AP after levelling to 5 HD, in both tools.

## Choices (owner: A2 B1 C1 D1)

Engine fix for Vigor (freeze unstamped ranks at the lock) over a CharGen write-path fix, because only the
engine fix repairs existing characters, and needs no data migration since stamps are re-derived per fold.
Engine rule for cross-species over a CharGen-only guard. A "🔒 Creation finished" label over a banner.

## Live impact (Supabase, 2026-10-11)

37 characters, 19 locked. Two change, both cheaper, and both now have a build cost that exactly equals
their frozen ledger spend: Wren Ashdown Ch8-12 138 → 126 (ledger 126), Caspian 107 → 101 (ledger 101).
HP and AP-left unchanged. None trip the new refusal.

## Collision

While the PR was open, #614 (`fix/no-creation-limit-note`) and release #616 landed on `preview`, touching
the same Finish-creating render lines and adding a mobile Finish button. Rebased keeping both: #614's
no-limit note plus this change's label, with a mobile copy of the label (`cgCreationLockedChipMob`) to
match #614's mobile button.

## Tests

New `testing/scripts/creation-lock-enforcement-e2e.mjs` (11 checks; 6 fail on the old code). Existing
engine, pricing, legality, fuzz, version-label and tool e2e suites all green before and after the rebase.
