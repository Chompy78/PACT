# Amble — creation-lock review sheets (G2, step 1)

**Status:** awaiting DM review. Nothing has been written to any character.
**Drafted:** 2026-10-01 from live Supabase (`characters` + `character_backups`), priced by `js/engine.js`.

## How these were worked out

- **Limit** = the DM's creation figure for the character (`creationLockConfig.threshold`, the latest one
  found anywhere in its history) **+** its drawback AP after Amble's 12 AP cap. A character with no DM
  figure uses Amble's own default, the `generous` budget curve's L1 = **83**.
- **Spend** = `economy(LOG).spent` — the same figure the tools use for the creation ceiling
  (`tools/PACT-Live-Char-Sheet.html:540`).
- **Lock point** = the **last** saved version in which spend was still at or under the limit. Everything
  added after it is what took the character over for good, so it is proposed as in-play.
- **Limits of the evidence:** only the most recent 50 backups per character are kept, so history older
  than that is gone. Times are when a save happened, not when a purchase was clicked — a character saved
  rarely can be off by a purchase or two. CharGen logs are written in category order, so the order inside
  a log carries no information; only the order *between* saves does.
- **Edited-in-place slots** (Ability scores, Armour, Spellcasting, Vigor & Grit, Hit Dice & Proficiency)
  are one record each. Where one changed after the lock point it is listed under "slot changes" and needs a
  choice: keep it all as creation, or split the later part out as an in-play purchase.

## Summary

| Character | Limit | Spent now | Over by | Proposed lock point | Confidence |
|---|---|---|---|---|---|
| Anders Pipeleaf | 72 + 12 = 84 | 110 | 26 | 17 Sep, 8:01 pm | High — Live Sheet, real purchase order |
| Fenwick Copperkettle | 74 + 4 = 78 | 97 | 19 | 10 Sep, 8:16 pm | Medium |
| Skylar | 76 + 4 = 80 | 84 | 4 | 3 Sep, 6:40 pm | Medium |
| Moss Stormspud | *none set* → 83 + 4 = 87 | 101 | 14 | 17 Sep, 8:31 pm | Low — needs your check |
| "Character" (Archer) | 68 + 0 = 68 | 79 | 11 | **Unknown** | None — needs your input |
| Caspian | 74 + 9 = 83 | 82 | — | **No lock** — still 1 AP inside creation | High |

---

## Anders Pipeleaf

- **Limit 84**, spent 110. Last within the limit: **17 Sep, 8:01 pm** (84 AP). Next save, 8:29 pm, was over.
- Already carries an old automatic lock from 31 Aug (fired at 85 AP against the generic 79 default). G2
  would move it to the point below.

**Proposed in-play (26 AP):**

| Purchase | AP |
|---|---|
| Psionic Power / Psychic Blades · T3 | 7 |
| Sleight of Hand | 2 |
| Level up → Hit Die 4 | 3 |
| Level up → Hit Die 5 | 4 |
| Level up → Hit Die 6 | 4 |
| Unarmored Defense · T1 | 6 |

Note: Psychic Blades T3 was bought on 13 Sep, removed on 17 Sep, and re-bought 28 minutes later. The lock
point falls in that gap. **Question:** was Psychic Blades part of the finished character or bought in play?

## Fenwick Copperkettle

- **Limit 78**, spent 97. Last within the limit: **10 Sep, 8:16 pm** (78 AP).

**Proposed in-play (19 AP):**

| Purchase | AP |
|---|---|
| Racial spell — Prestidigitation | 4 |
| Class feature — Fighter: Action Surge | 4 |
| Art / Technique — Savage Attacker | 4 |
| *Slot change:* Ability scores, 0 → 7 AP | 7 |

Prestidigitation was added and removed four times between 26 Aug and 10 Sep before it stuck. **Questions:**
was it part of the finished build? And were the ability-score raises (7 AP, saved 18 Sep) creation or in-play?

## Skylar

- **Limit 80**, spent 84. Last within the limit: **3 Sep, 6:40 pm** (80 AP).

**Proposed in-play (4 AP):**

| Purchase | AP |
|---|---|
| Proficiency +3 | 4 |

This came in with the move to Hit Dice 5, so it looks like a level-up. **Question:** confirm.

## Moss Stormspud

- **No DM limit has ever been set.** Using Amble's default 83 + 4 drawback = **87**. Spent 101.
- Last within 87: **17 Sep, 8:31 pm** (84 AP). Spend swung between 82 and 96 several times on 13–17 Sep
  while the build was being reworked.
- Already carries an old automatic lock (fired at 97 AP against the 79 default).

**Proposed in-play (net 17 AP):** Hit Dice → 5 replacing Hit Dice → 3 (12 AP), plus churn in the
Vigor & Grit and Hit Dice & Proficiency slots.

**Questions:** what creation limit should Moss have had? (If you set one, the lock point moves.) And was the
jump to Hit Dice 5 a level-up in play?

## "Character" — was Archer

- **Limit 68**, spent 79. It was already at 70 in the **oldest backup still kept** (8 Sep), so the crossing
  point is older than the surviving history.
- Its name was lost (no `name` event in the log) — almost certainly the same CharGen reload bug.

**Question:** what did Archer have when they finished creating? A list of what came after — even rough —
is enough to place the lock.

## Caspian

- **Limit 83**, spent 82. Still 1 AP inside creation, so **no lock is proposed**. The DM's reopen on
  1 Sep was correct. Caspian's player presses **Finish creating** when done.

---

## Next steps after review

1. Fix the CharGen reload bug (A2) and add the server guard (D1, with F2) — **before** any lock is
   restored, or a reload would wipe it again.
2. Rewrite each confirmed log as creation purchases → lock → in-play purchases, through a DM-level database
   change, with every original log backed up first.
3. Show before/after engine figures per character (including any gold/downtime now owed) for sign-off
   before anything is written.
