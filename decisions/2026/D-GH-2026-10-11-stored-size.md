# D-GH-2026-10-11-stored-size — a character's stored size matches its real size

Status: Active. Code (engine `sizeOf()`, CharGen write path) in this change; the one-off data correction
(`sql/migrations/2026-10-11-stored-size-correction.sql`) **applied to live 2026-10-11**: 23 rows, play outputs of all 37 characters
identical before/after (engine snapshot), stored-vs-engine size mismatches 23 → 0. No `DATA.version` bump (no rules change).

## Context

Another AI session reading the database reported Bram Cotter as Small; the tools show Medium. CharGen hides its size dropdown when
size isn't a choice and parks it at "Small"; saving read that hidden value. `compute()` ignores a stored size that isn't a choice, so
play was never affected — but 23 of 37 live characters stored "Small" while being Medium, and every raw reader was misled.

## Options (owner chose I3)

- **I1** — document "ignore stored size". Readers that skip the note stay wrong.
- **I2** — fix CharGen's write path and correct the rows that can be corrected; document the sealed rest.
- **I3** — I2 plus a DM-authorised server function to correct sealed rows.

## Decision

1. `js/engine.js` exports `sizeOf(build) -> {size, choosable}`; `compute()` calls it (moved verbatim — 484 species-pair × stored-size
   combinations agree with the previous engine).
2. CharGen stores `sizeOf().size` unless the size is a choice. The dropdown's on-screen behaviour is unchanged. The Live Sheet never
   writes `size`, so CharGen was the only writer.
3. Data: one appended event per affected character, `{buy, patch, cost 0, size:'Medium', systemEdit:true}`. **The I3 server function
   proved unnecessary**: the freeze trigger (`pact_enforce_locked_history`) only refuses the protected history before the lock/seal
   shrinking or changing — an event appended after it is allowed (that is how every in-play purchase works). So the sealed rows were
   corrected by append, with no freeze change and no new privileged function — the outcome I3 asked for, at lower risk.
4. AGENTS.md's data rule now tells raw readers to fold and compute, that the LAST patch wins, and that `size` is the trap.

## Why

- Rewriting the old events in place would falsify history and is refused by the freeze; appending is honest and allowed.
- Both API cold reviewers (Gemini flash-lite, nemotron) independently flagged that a reader taking the FIRST size event still sees
  "Small" — hence the AGENTS.md note; a "migrated" flag and nulling the field were rejected (see the plan's Review outcome).

## Watch for

A stale browser tab saving after the correction may drop the appended event (the freeze allows dropping post-lock events). Harmless —
`compute()` never used it — and CharGen's next save stores the right size once this code is on `main`.
