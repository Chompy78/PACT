# D-GH-2026-10-12-chargen-livesheet-data-loss — CharGen keeps names, house rules and awards in the LOG; refuses rather than merges

**Status:** provisional — owner away, taken under standing instruction H2, reversible.

## Context
The 2026-10-12 logic audit found six CharGen paths that lost saved work or wrote it to the wrong character
(task `fix/chargen-livesheet-data-loss`). Four are plain bugs with one obvious fix (names → a `names` LOG
event; Local Save tied to the character it was opened for; annotate()'s identity correction re-synced into
the LOG; DM house rules synced to the `HOUSE_RULES` patch slot). Three points hid a choice:

1. **Multi-award characters (Live Sheet → CharGen).** `_cgSyncAward()` is a singleton filter-and-append: on
   load it merged every award into one "Budget" event, losing notes and dates.
2. **Editing the Budget field on such a character.** Any edit would do the same merge.
3. **Renaming a saved spell/language after "Finish creating".** Now that CharGen names persist, CharGen's
   dialog could change a name the Live Sheet treats as locked (a change there is a Hit-Die swap with its own rules).

## Options
- 1a. Never re-sync the award on load (keep the LOG's awards verbatim). 1b. Re-sync only a "genuine single-budget" LOG.
- 2a. Refuse the edit and put the field back to the awards' sum. 2b. Append a delta award. 2c. Merge (old behaviour).
- 3a. After the lock, CharGen may only fill blank name slots; changing a set name is refused. 3b. Allow any change.

## Decision
- 1: re-sync on load only for the legacy case that needed it (an envelope with a top-level `budget`, pre-Step-5
  files) and only when the LOG holds at most one award. Current envelopes carry no top-level budget, so their
  awards are never touched on load.
- 2a: with more than one award the Budget field refuses edits (flash; field restored to the sum). Awards are
  edited in the Live Sheet, where each is its own line.
- 3a: after the lock CharGen refuses to change an already-set name; filling a blank is allowed.

## Why
Each pick is the one that refuses rather than rewrites or grants: no award is merged or minted (2b would
create an AP-granting event from a creation tool), and no locked-in name changes outside the Live Sheet's swap
rules. All three are reversible UI guards — no data shape, engine or schema change.
