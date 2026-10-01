# Amble — creation-lock review sheets (G2, step 1)

**Status:** awaiting DM sign-off. Nothing has been written to any character.
**Drafted:** 2026-10-01 from live Supabase (`characters` + `character_backups`), priced by `js/engine.js`.

## The rule (DM decision, 2026-10-01)

**The purchase that takes a character over their creation limit still counts as creation. The lock goes in
straight after it. Everything bought after that is in-play.** Where a character dipped back under the
limit and crossed again later, the crossing that stuck is the one used.

## How these were worked out

- **Limit** = the DM's creation figure for the character (`creationLockConfig.threshold`, the latest one
  found anywhere in its history) **+** its drawback AP after Amble's 12 AP cap. A character with no DM
  figure uses Amble's own default, the `generous` budget curve's L1 = **83**.
- **Spend** = `economy(LOG).spent` — the same figure the tools use for the creation ceiling
  (`tools/PACT-Live-Char-Sheet.html:540`).
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
| Skylar | 76 + 4 = 80 | Ability scores +4, 3 Sep 6:42 pm → 84 AP | 0 AP | Ready — lock goes at the end |
| Moss Stormspud | *none set* → 83 + 4 = 87 | Hit Dice → 5 (12) + Vigor & Grit (2), 17 Sep 8:32 pm → 97 AP | 4 AP | **Needs Moss's limit** |
| "Character" (Archer) | 68 + 0 = 68 | Unknown — older than the kept backups | Unknown | **Needs your input** |
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

## Skylar — ready

- Limit 80. At 80 AP on 3 Sep 6:40 pm; an **ability-score raise** (+4 AP) took it to 84 at 6:42 pm.
- Nothing has been bought since (a later reload reshuffled the records, net 0 AP).
- Lock goes **at the end of the log**: Skylar's whole build is creation, and any AP spent from now on is
  in-play.

## Moss Stormspud — needs a limit

- **No DM limit was ever set.** Using Amble's default gives 83 + 4 = 87: at 84 AP on 17 Sep 8:31 pm;
  **Hit Dice → 5 + Vigor & Grit** took it to 97 at 8:32 pm. In-play after that: Hit Dice & Proficiency
  (4 AP).
- If you give Moss a different limit, the crossing point moves — tell me the figure and I'll re-run it.

## "Character" (Archer) — needs your input

- Limit 68, spent 79. It was already at 70 in the oldest backup still kept (8 Sep), so the crossing is
  older than the surviving history.
- Its name was also lost (no `name` event in the log) — almost certainly the same CharGen reload bug.
- To place the lock: which purchase took Archer past 68? Or roughly what was bought after creation?

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
