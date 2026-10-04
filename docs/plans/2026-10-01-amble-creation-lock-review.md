# Amble — creation-lock review sheets (G2, step 1)

**Status:** awaiting DM sign-off. Nothing has been written to any character except interim end-of-log locks.
**Revised 2026-10-04:** Skylar and Moss corrected — the first draft priced versions by their stored ledger,
which held stale, under-recorded prices (Skylar's Proficiency +3 at 4 AP, current rules 18; Moss's Druid: Wild
Shape at 0 AP). Every version is now priced by the engine under current rules (`compute(foldBuild(LOG)).total`).
**Drafted:** 2026-10-01 from live Supabase (`characters` + `character_backups`), priced by `js/engine.js`.

## The rule (DM decision, 2026-10-01)

**The purchase that takes a character over their creation limit still counts as creation. The lock goes in
straight after it. Everything bought after that is in-play.** Where a character dipped back under the
limit and crossed again later, the crossing that stuck is the one used.

## How these were worked out

- **Limit** = the DM's creation figure for the character (`creationLockConfig.threshold`, the latest one
  found anywhere in its history) **+** its drawback AP after Amble's 12 AP cap. A character with no DM
  figure uses Amble's own default, the `generous` budget curve's L1 = **83**.
- **Spend** = the engine's total for that version under **current** rules (`compute(foldBuild(LOG)).total`).
  The stored ledger (`economy(LOG).spent`) is *not* used: a locked log freezes prices, and some stored prices
  were stale or zero, which made the first draft wrong for Skylar and Moss. For Anders and Caspian (Live Sheet,
  real purchase order) the crossing was also cross-checked by walking the live log event by event.
- **Crossing purchase** = what was added in the first save that went over the limit and stayed over.
- **Limits of the evidence:** only the most recent 50 backups per character are kept. Times are when a
  save happened, not when a purchase was clicked, so one save can hold more than one purchase.
- **Edited-in-place slots** (Ability scores, Armour, Spellcasting, Vigor & Grit, Hit Dice & Proficiency)
  are one record each; a later change to one is shown as "slot 0→N".

## Summary

| Character | Limit | Crossing purchase (creation) | In-play after the lock | Status |
|---|---|---|---|---|
| Anders Pipeleaf | 72 + 12 = 84 | Psychic Blades T3 (7), 17 Sep 8:29 pm → 91 AP | 19 AP | Ready |
| Fenwick Copperkettle | 74 + 4 = 78 | Prestidigitation (4), 10 Sep 8:58 pm → 82 AP | 15 AP | Ready |
| Skylar | 76 + 4 = 80 | Ability scores +4, 3 Sep 6:42 pm → 84 AP | 14 AP | Ready (revised 2026-10-04) |
| Moss Stormspud | 79 + 4 = 83 (DM, 2026-10-01) | Druid: Wild Shape, 8 Sep 8:03 pm (75 → 88 AP) | 13 AP | Ready (revised 2026-10-04) |
| "Character" (Archer) | 68 + 0 = 68 | — (crossing predates kept backups) | 0 AP | Ready — lock at the end (DM, 2026-10-01) |
| Caspian | 74 + 9 = 83 | — (82 spent, never crossed for good) | — | No lock |

---

## Anders Pipeleaf — ready

- Limit 84. At 84 AP on 17 Sep 8:01 pm; **Psychic Blades T3** (7 AP) took it to 91 at 8:29 pm.
- Lock goes straight after Psychic Blades T3.

**In-play (19 AP):** Sleight of Hand (2) · Level up → Hit Die 4 (3) · Hit Die 5 (4) · Hit Die 6 (4) ·
Unarmored Defense T1 (6).

Already carries an old automatic lock from 31 Aug, which moves to the new point.

## Fenwick Copperkettle — ready

- Limit 78. At 78 AP on 10 Sep 8:16 pm; **Prestidigitation** (4 AP) took it to 82 at 8:58 pm.
- Lock goes straight after Prestidigitation.

**In-play (15 AP):** Fighter: Action Surge (4) · Savage Attacker (4) · ability-score raises (7, saved 18 Sep).

## Skylar — ready (revised 2026-10-04)

- Limit 80. At 80 AP on 3 Sep 6:40 pm; an **ability-score raise** (+4 AP) took it to 84 at 6:42 pm.
- Lock goes straight after that raise.

**In-play (14 AP):** Proficiency +3 (18 AP under current rules; the ledger had it frozen at 4, an old price),
less DEX lowered 12 → 10, plus Studded Leather.

The first draft said "lock at the end, 0 AP in-play" because it priced Proficiency +3 at the stale 4 AP. On
2 Oct a stale local copy dropped Skylar's interim lock, CharGen re-priced the unlocked draft, and the true
18 AP surfaced — which is how this was found.

## Moss Stormspud — ready (revised 2026-10-04)

- **Limit set by the DM on 2026-10-01: 79 + drawbacks (4) = 83.**
- At 75 AP on 8 Sep 2:03 pm. The next save, 8:03 pm, added **Druid: Wild Shape**, taking it to 88; Moss never
  came back under 83 after that. (The stored ledger recorded Wild Shape at 0 AP, which is why the first draft
  put the crossing at 17 Sep.)
- Lock goes straight after Wild Shape.

**In-play (13 AP):** Hit Dice 3 → 6, Grit +1, and the Druid subclass changed Circle of the Land → Circle of
the Moon.

## "Character" (Archer) — ready, lock at the end

- Limit 68, spent 79. The crossing is older than the kept backups (already 70 on 8 Sep).
- **DM decision, 2026-10-01: lock at the end of the log.** The whole current build counts as creation; any AP
  spent from now on is in-play.
- Its name was also lost (no `name` event in the log) — almost certainly the same CharGen reload bug. The
  repair should restore the name **Archer**.

## Caspian — no lock

- Limit 83, spent 82. Still 1 AP inside creation, so no lock. The DM's reopen on 1 Sep was correct.
  Caspian's player presses **Finish creating** when done.

---

## Next steps after sign-off

1. Fix the CharGen reload bug (A2) and add the server guard (D1, with F2) — **before** any lock is
   restored, or a reload would wipe it again.
2. Rewrite each confirmed log as creation purchases → lock → in-play purchases, through a DM-level database
   change, with every original log backed up first.
3. Show before/after engine figures per character (including any gold/downtime now owed) for sign-off
   before anything is written.
