# D-GH-2026-10-11-patch-fold-aliasing — replaying a character's history never rewrites that history

Status: Active. Engine fix in this change (`MUT.patch` copies the patch). No `DATA.version` bump: `compute()` output is unchanged for
any log (104/104 parity, 3,000-log fuzz clean, post-lock CharGen/Live Sheet parity fuzz 0 mismatches). No data migration (see below).

## Context

The owner could not save Wren Ashdown Ch8-12 after buying Light armour, in either tool: "Not saved — part of this character's history
is locked on the server". The server log said `protected event 9 changed`; item 9 of Wren's protected list is the creation-era
`Armour` patch (`light:false`). A browser reproduction with Wren's real log showed both tools append a correct `armour` buy event, yet
the creation patch also flipped to `light:true`.

Cause: `MUT.patch` was `Object.assign(b, p.patch)` — a shallow copy, so `b.armour`, `b.stats`, `b.skills`, `b.traditions`… were the
event's own objects. Every MUT that mutates in place (`armour`, `abil`, every list `push`, `freesub`, `rank`/`cantrip`/`slot`/`known`/
`dbound`) then wrote the purchase back into the stored patch, on every fold. `wprof` already used `clone()`, so this had been met once
and fixed for one field only. CharGen records creation as patch events, so every CharGen-built character was exposed.

## Options (owner chose B2, C1)

- **B1** — the one-line fix only.
- **B2** — B1 plus a read-only scan of the live characters for creation patches already rewritten.
- **B3** — B2 plus freezing everything the engine reads during replay.
- **C1** — own branch / PR (chosen); **C2** — fold into PR #617.

## Decision

1. `MUT.patch` applies `clone(p.patch)`. One entry point covers both tools and every replay path (all go through `MUT`).
2. Regression gate `testing/scripts/patch-fold-aliasing-ci.mjs` (fails 2 checks on the old engine), wired into `engine-parity.yml`.
3. Live scan, 2026-10-11, 37 characters: **one** already altered — Archer, whose locked creation `Spellcasting` patch now carries the
   values of three later buys (cantrips 2, known L1 2, slots L1 2; originally ~1/0/0). Its AP, frozen costs and current build are
   unaffected (the buys set absolute values and their costs are stamped); only a time-travel view at that one entry is wrong.
   **Left as is**: correcting it means rewriting a protected event around the freeze trigger, for a history-view-only inaccuracy.

## Why

Locked characters were refused on any purchase touching a creation-patched field (armour, ability scores, skills, spellcasting), and
unlocked ones had their creation record silently rewritten. The copy removes the shared reference rather than guarding each MUT, so a
future in-place MUT cannot bring it back. B3 was not needed: `patch` is the only MUT that hands event objects to the build by
reference (the others copy scalars or push values).

## Addendum (2026-10-12) — Archer's creation patch restored (owner choice H2)

The owner chose to correct Archer's altered `Spellcasting` patch rather than leave it (decision 3 above is superseded). Source of
the original values: the `character_backups` row captured 2026-10-08 11:57 UTC, the last copy before the alteration and after the
2026-10-04 history repair. Its event 15 reads cantrips 1, known L1 0, slots L1 0. Between that backup and the live row, event 15 was
the only event whose content changed (events 23–25 differed only because the name event moved to the end and a `creationLockConfig`
was appended).

Engine dry run before writing: the final build and AP total (79) are identical; only history positions 15–19 read differently, and
the creation-lock view now shows 1/0/0, matching the lock's own label ("placed before Cantrip 2 … 66 → 71").

The write (2026-10-11 ≈23:04 UTC) was one transaction: `ALTER TABLE characters DISABLE TRIGGER trg_pact_locked_history`, a single
guarded `UPDATE` (id, read `updated_at`, LOG length 28, label and cantrips = 2; it raises unless exactly one row matches), `ENABLE`,
commit. This is the method of `docs/plans/2026-10-04-amble-lock-repair.md` §4. Every other trigger stayed on, and
`trg_characters_snapshot` saved the pre-repair row to `character_backups` (captured 23:03:50 UTC) as the rollback copy. Verified
afterwards: event 15 reads 1/0/0, no other event changed, `ap` is still 89, and the trigger is enabled.

Residual risk: a device still holding the pre-repair copy with unsaved edits would have its next push refused ("protected event 15
changed"). Reloading takes the server copy.
