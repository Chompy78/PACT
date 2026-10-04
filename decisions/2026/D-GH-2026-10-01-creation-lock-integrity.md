# D-GH-2026-10-01-creation-lock-integrity — a finished character stays finished

Status: Active. Part 1a (CharGen reload fix) shipped on `claude/epic-meitner-f8vldf`; the campaign-move
rule below (L1) is decided and lands with the server guard (Part 2 of
`docs/plans/2026-10-01-creation-lock-integrity.md`). **Partly supersedes
`D-GH-2026-09-01-campaign-move-clears-creation`** (see Decision 2).

## Context

On 2026-10-01 the DM found that only two of the six "Amble" characters were creation-locked. Live data and
`character_backups` showed four had lost their lock — and three their DM-set creation limit, one its name —
between 26 Aug and 17 Sep. Every lost version was a whole-log rebuild: events renumbered from 1, CharGen's
fixed category order, one timestamp.

Reproduced in Chromium: finish creating in CharGen, reload — the lock is gone, same character id.
`_cgBoot()` restored the autosave / Live Sheet handoff verbatim (through `_cgApplyEnvelope()`), then the boot
seed called `replaceWholeLogFromBuild(_domReadBuild())` anyway. The form has no control for
`creationLocked` / `creationUnlocked` / `creationLockConfig`, so every reload deleted them.

A cold review of the fix plan (fresh subagent, 26 findings) also showed that F2 — "only a move to a
*different* campaign clears the lock", agreed earlier the same day — still leaves a detour: leave Amble, join
any other campaign (including one the player runs as DM), buy at creation prices, rejoin Amble.

## Options

**Reload fix:** I1 carry the lost events across each rebuild path (the random-roll patch's approach, which
had already failed once); **I2** stop rebuilding a restored log, and make the remaining rebuild paths merge
rather than rewrite; I3 forbid whole-log rebuilds on any character with history.

**Campaign moves:** F2 clear the lock only on a move to a different campaign; **L1** never clear the lock on
a campaign move — the new DM reopens creation explicitly if they want it.

## Decision

1. **I2.** Part 1a: the boot seed runs only when nothing was restored. The remaining rebuild paths (roll,
   `#b=` link, legacy imports) follow in Part 1b.
2. **L1 (owner, 2026-10-01).** A campaign move never clears `creationLocked`. This **replaces the "locks go"
   half** of `D-GH-2026-09-01-campaign-move-clears-creation` for the finished-creation lock. Whether the DM's
   ceiling figure should still be cleared on a move is to be settled in Part 2's design (that decision's
   "one table's number must not govern another" reasoning still applies to the figure).
3. Server-side: lock-family events become append-only for campaign characters, and only a DM can append
   `creationUnlocked` or a ceiling (Part 2, D1).

## Why

- The reload bug is the root cause; fixing the one place that destroys the log beats patching each
  symptom, and a regression test pins it.
- L1 makes "only your DM can reopen creation" — the promise the Finish-creating dialog already makes —
  actually true. F2 could be bypassed by any player able to create their own campaign.
- A new DM loses nothing: `dm_reopen_creation()` already exists and is one click in DM Console.

## Status

Part 1a done (tests: new `chargen-flows-e2e.mjs` section fails on the old code, passes on the new; engine
parity 73/0). Interim end-of-log locks applied to the four unlocked Amble characters (AP unchanged). Parts
1b, 3 (history repair with DM sign-off) and 2 (server guard + L1) to follow, in that order.

## Addendum — 2026-10-04

- **Second cause found:** Skylar (2 Oct) and Archer (3 Oct) lost their interim locks *after* the reload fix
  shipped — a stale local copy (pre-lock `seq`) pushed over the newer cloud save. Root cause still open; the
  server guard (D1) is now prioritised ahead of Part 1b (owner decision **P1**).
- **Q1 (owner):** lock points are judged on **current-rules prices** (`compute(foldBuild(LOG)).total`), not
  the stored ledger, which held stale prices (Skylar's Proficiency +3 recorded at 4 AP vs 18; Moss's Wild
  Shape at 0). This moved Moss's crossing to 8 Sep (Wild Shape) and gave Skylar 14 AP in-play.
- **R (owner):** no mechanics change — drawback AP stays in the creation limit.
- **S1 (owner):** campaign characters' backups are never pruned (the 50-version window lost Archer's history).
- Draft migration `sql/migrations/2026-10-04-creation-lock-guard.sql` (D1 + L1 + S1) — not applied; testing
  approach (decision T) pending. Handoff: `docs/sessions/2026-10-04-creation-lock-restart.md`.
