# D-GH-2026-09-02-seal-freezes-species-and-ratchets-stats

**Status:** Decided and shipped (server + CharGen), 2026-09-02.

## Context

`feat/session-seal` (PR #492) promised, in the DM Console's own words, that *"everything bought up to this
moment becomes permanent — the player can no longer undo it or un-tick it."* The second `/code-review
ultra` pass found that promise was not true for the largest part of a build.

Species, origin class, ability scores, Hit Dice and proficiencies do not live in individual `buy` events.
They live in `buy`/`cat:'patch'` events, and CharGen's `replacePatchSlot()` rewrites a patch event **in
place** every time any of those fields changes. Because that rewrite is legitimate and constant, patch
buys were deliberately excluded from `pact_ap_ledger_protected()`'s positional comparison — so a locked
character could still change species from Human to Dwarf, or move a locked STR 14 to DEX 14. The equal-cost
swap is the nastier of the two: the AP total is unchanged, so `pact_enforce_ap_budget_consistency` cannot
see it either. Nothing in the system said no.

This was raised as a task rather than fixed on the spot, because the correct rule is a **rules decision,
not an implementation detail**, and because tightening the server alone would have broken ordinary editing:
CharGen has no client-side guard on `replacePatchSlot()`, so every species or stat change on a locked
character would have failed with a raw database error and no explanation.

## Options

**A. Leave patch fields unprotected.** Cheapest, and honest about what the seal covers. Rejected: it makes
the DM-facing promise false for species and ability scores, which is most of what a character *is*.

**B. Freeze the whole patch bundle.** Simple to state. Rejected: it would freeze appearance, gold, languages
and Hit Dice too, and would stop a player raising an ability score with AP they legitimately earned after
the lock — turning a "no take-backs" rule into a "no advancement" rule.

**C. Freeze species; ratchet ability scores.** Chosen. Species (and an already-set second origin species)
cannot change. Ability scores may go **up** but never down, and never sideways at equal cost.

## Decision

Owner ruling, 2026-09-02, in their own words: *"species definately locked. ability points can only be
increased. species abilities for their origin species can be bought, not other species ability unless a
second origin species."*

Implemented as:

1. **Species frozen.** Once a lock exists, the derived `species` cannot change.
2. **Second origin species frozen once set — but still addable.** `"(none)"` is the live sentinel for "not
   set" (confirmed against real data: 4 rows carry it, 4 carry a real species). Going from `"(none)"` to a
   real species is **allowed** — it is a new purchase, paid for at the time, and the seal's promise is that
   new purchases stay available. Changing or removing one that was already locked in is **refused**.
3. **Ability scores ratchet upward.** Raising a score with new AP is allowed; lowering one to claw AP back,
   or moving points between stats at equal cost, is not.

The third clause of the owner's ruling — own-species traits buyable, other species' not, unless a second
origin species — **needed no code**: `js/engine.js` already implements it (`racial:` mutator, "own-species
traits only"; cross-species traits are creation-only per guide §10, and own-species traits cost more once
creation ends). Freezing species is what makes that existing rule stick after a lock.

## Why

**Why species2 had to be frozen alongside species.** `js/engine.js` prices a racial trait as own-species
when `r.race === b.species || r.race === b.species2`. Freezing only `species` would have left the whole rule
trivially bypassable: add a second origin species after the lock and another entire species' traits become
cheap own-species buys. Freezing one without the other is not a partial fix, it is no fix.

**Why compared by DERIVED VALUE, not by event position.** `replacePatchSlot()` rewrites the patch event in
place, and the boot burst writes these fields too. Any positional rule would either refuse ordinary editing
or miss the edit entirely. Comparing the derived value of `OLD.stats` against `NEW.stats` is immune to how
the event moved.

**Why keyed on the payload KEY, not on `_slot`.** Measured against live data before writing a line:
**164 of 218** patch events carry no `_slot` at all — they are `_buildEventBurst`'s boot burst — and those
hold most of the real species and stats values. A `_slot='identity'` rule would have silently missed almost
every character. This is the same class of near-miss as the stale-migration incident earlier the same day:
the shape that looked obvious from the code was not the shape in the data.

**Why it fails open on a NULL old value.** Two live campaign characters (Archer, Skylar) record no species
in any patch event. There is nothing to freeze for them, and manufacturing a constraint out of a NULL would
lock them out of edits they may legitimately make.

**Why the client guard exists even though the server is the enforcement point.** Per `AGENTS.md`, RLS and
triggers are the only real security boundary and a client check is decoration — but decoration is the
difference between "🔒 Species is locked. Ask your DM if it needs to change." and a raw plpgsql string in an
alert box. `_cgSealPatchRefusal()` mirrors the server rule against `foldBuild(LOG)` — the engine's own
derivation — and refuses before the player does the work.

**The cost, stated plainly.** This is a one-way door for the player. Someone who realises at session 4 that
they picked the wrong species during creation cannot fix it themselves. That is not a dead end — a DM can
already append corrections (decision J1) — but it moves a self-service fix onto the DM's plate, and the
owner accepted that trade knowingly when it was put to them.

## Verified

Against the live trigger, in transactions rolled back afterwards (0 probe rows left behind):

| Attempt | Result |
|---|---|
| species Human → Dwarf | refused |
| species2 Elf → Tiefling | refused |
| species2 Elf → `"(none)"` | refused |
| species2 `"(none)"` → Elf | **allowed** |
| STR 14 → 12 | refused |
| STR 14 → 10 **and** DEX 10 → 14 (equal cost) | refused |
| STR 14 → 16 | **allowed** |
| WIS raised, others untouched | **allowed** |
| new purchase appended after the seal | **allowed** |

`sql/migrations/2026-09-02-seal-freezes-species-and-ratchets-stats.sql` and the live `pg_proc` body hash
**identically** (`e5a9619179b551ebad1f2b3fcf14ce13`) — checked, not assumed, because a repo file drifting
from the live definition is what caused this same day's production regression.

## Status

Shipped. Applied to production as `seal_freezes_species_and_ratchets_stats`,
`seal_freezes_species2_as_well`, and `sync_locked_history_body_to_repo_file`.

Still open, and deliberately so: `dmRemoveBoon` remains outside the protected projection, so deleting one
can restore a boon a DM took away. It is unrelated to this ruling and is tracked separately.
