# Plan — repair the six live Amble histories (G2 / Part 3)

> **Status: PLAN FOR OWNER REVIEW — nothing has been written to any live character.** Written 2026-10-04. Owner decisions
> already made: **G2** (lock at the crossing purchase), **Q1** (price by current rules), **N1** (plan first, then guarded
> writes), **O1** (charge gold and downtime retroactively). Context: `docs/sessions/2026-10-04-creation-lock-restart.md`,
> `decisions/2026/D-GH-2026-10-01-creation-lock-integrity.md`, `docs/plans/2026-10-01-amble-creation-lock-review.md`.
> Figures below are from a read-only export of the live rows and backups taken 2026-10-04 — **re-export before acting**.

## 1. What the repair changes

For each of the six characters, in the **real** live history (not the review copies):

1. **Lock position.** Remove the lock events the system or I put in (the retired automatic lock, my interim end-of-log lock)
   and place one `creationLocked` right after the purchase that took spend **past** limit + drawbacks (G2). Caspian is
   a decision, not a crossing (see §2).
2. **DM limit.** Restore the `creationLockConfig{threshold}` entry that the reload / stale-copy bugs deleted (or that was
   never stamped), at the start of the log: Moss 79, Skylar 76, Fenwick 74, Archer **68 — to confirm, see §6**; Anders 72 and
   Caspian 73 are already present.
3. **Prices.** Re-stamp every purchase's `cost` to the current-rules price (Q1). Drawbacks keep their own grant.
4. **Gold and downtime (O1).** Stamp `gp`/`days` on the purchases that are now **after** the lock, and remove the stamps
   from any that are now **before** it, using the campaign's own economy (`economy.band = "standard"`, the same
   `purchaseCost()` the tools use).
5. **Archer's name** (lost to the reload bug) restored in the name event and in `characters.name`.

Nothing else changes: awards, seals, the `ap` column, the order of everything except the lock, and every character's total
spent (the lock moves; what was bought does not).

## 2. Per character (from 2026-10-04 data)

| Character | Lock now | Lock after | Spent now → after (engine) | In-play purchases | Notes |
|---|---|---|---|---|---|
| Anders | auto lock, 74 | the **Forgery kit**, 85 | 111 → 111 (ledger 110 → 111) | 7 (26 AP) | 3 stored costs change (net +1); **1 AP over** the 110 he has (98 DM + 12 drawbacks) |
| Moss | auto lock, 97 | after **Wild Shape**, 88 | 101 | 5 (13 AP) | no limit entry at all; limit 79 to add |
| Archer ("Character") | interim, end of log, 79 | unchanged, 79 | 79 | 0 | restore name; limit to confirm |
| Skylar | interim, end of log, 98 | after the **ability raise**, 84 | 98 | 3 (14 AP) | limit 76 to add |
| Caspian | interim, end of log, 81 | **stays locked** at the end, 81–82 | 82 → 81 (Stealth 2 → 1) | 0 | limit now 73 → ceiling 82; locked by decision, not by a crossing |
| Fenwick | interim, end of log, 97 | after **Prestidigitation**, 82 | 97 | 4 (15 AP) | limit 74 to add |

## 3. What O1 costs the players (computed with the engine, Amble's "standard" band)

Amble has **no gold awards at all** (every wallet is 0 gp) and one 60-day party downtime window. So a retroactive charge is a
**debt**, not a deduction.

| Character | Charged in play now (stamped) | After the repair | Change | Wallet after |
|---|---|---|---|---|
| Anders | 300 gp / 70 days | 275 gp / 63 days | −25 gp / −7 d | −275 gp |
| Moss | 25 gp / 7 d | 125 gp / 28 d | **+100 gp / +21 d** | −125 gp |
| Archer | 0 | 0 | 0 | 0 |
| Skylar | 0 | **750 gp / 90 d** (Proficiency +3, 18 AP) | **+750 gp / +90 d** | −750 gp |
| Caspian | 100 gp / 21 d | 0 | **−100 gp / −21 d** | 0 |
| Fenwick | 0 | 150 gp / 35 d | **+150 gp / +35 d** | −150 gp |

- **Skylar** is the large one: a single 18 AP purchase becomes 750 gp and 90 days, which is more downtime than the 60-day
  window the party has declared. A DM can waive or defer any cost (Players Guide §17), and the wallet check is a soft
  warning, never a block.
- O1 is applied **both ways**: Anders and Caspian have charges that disappear because those purchases move before the lock.
- *Per-purchase detail:* Moss — Hit Dice → 5 (7 AP → 100 gp / 21 d), Hit Dice & Proficiency (4 AP → 25 gp / 7 d); Fenwick —
  Action Surge (4 AP → 25 gp / 7 d), Savage Attacker (4 AP → 25 gp / 7 d), Ability scores (7 AP → 100 gp / 21 d).

## 4. How the write is made

**Not** the review-copy builder (`buildcopies.mjs`): it renames characters "… lock check (DM copy)", replaces the awards with a
single award, and mints new ids. The live transform is a new script that keeps every real event and changes only §1.

**One guarded write per character**, never batched, in this order: the three without awards (Moss, Skylar, Fenwick), then
Archer, Caspian, Anders. Each is a single `UPDATE characters … WHERE id = … AND updated_at = <read value> AND
jsonb_array_length(stats->'LOG') = <read length>`, so it does nothing if the character was edited since I read it.

**Triggers.**
- `trg_pact_creation_lock_guard` (the new guard) does not apply: an admin session carries no API claims.
- `trg_pact_locked_history` **does** apply to admin sessions, and it compares the *stamped cost* of every non-patch purchase
  up to the last award. So for the three characters **with an award** (Anders 79/−79, Archer 77, Caspian 27/−27) a Q1 re-stamp
  would be refused. Those three therefore need the trigger **disabled for the length of one transaction**
  (`ALTER TABLE … DISABLE TRIGGER` … `ENABLE`), then re-enabled and verified. This is a privileged step and needs the owner's
  explicit go-ahead; the three without an award need no such step.
  *(Correction to an earlier note of mine: moving a lock or restoring a limit does not trip this trigger — those events are
  not in its protected set. The re-pricing does.)*
- `seq` values change when the lock moves; the trigger's projection ignores `seq`/`ts`/`rules`/`label`, and nothing else
  references `seq` (to be re-verified by grep before the write).

**Rehearsal first.** The transform runs against the Docker harness (`testing/scripts/creation-lock-guard-test`) loaded with
the exported live rows and the real trigger definitions, and against the six standalone "lock check (DM copy)" characters
(no campaign, no triggers of this kind) as a real-database dry run. The transaction's post-conditions are checked in the
harness first: awards identical, `ap` untouched, total spent as in §2, lock at the agreed index, exactly one limit entry.

## 5. Verification and rollback

- **Before:** the database already snapshots every update into `character_backups` (the trigger keeps all backups for
  campaign characters, S1). I also save the exact pre-write JSON of each row to the scratch directory.
- **After each write:** read the row back and re-run the verifier (`verifycopies.mjs` pattern): ledger = engine, lock index,
  awards unchanged, `ap` unchanged, limit present. Open it in the tool if you want to see it.
- **Rollback:** restore `stats` (and `name`) from the pre-write JSON by the same guarded admin write. Nothing is deleted.
- Advisors and logs are run after the last write (AGENTS.md step 4).

## 6. Open items for the owner

- **O1 magnitudes — please confirm with the numbers in §3.** Skylar +750 gp / +90 days is the one most likely to be a
  surprise. Alternatives you may prefer: charge in full as decided; stamp the cost but record a DM waiver; or cap it.
- **Archer's limit.** Your notes say 68. Her backups show a last stamped limit of **77** (8–17 Sep). Which is right?
- **Anders' 111 versus the 110 he has.** Q1 makes him 1 AP over. The `ap` column is not changed by the repair; he simply reads
  1 AP in the red. Confirm that is acceptable (the alternative, keeping his stored 110, was declined under Q1).
- **Permission to disable `trg_pact_locked_history` for one transaction** for Anders, Archer and Caspian (§4).
- **Order and sign-off.** Proposed: Moss → Skylar → Fenwick → Archer → Caspian → Anders, with your sign-off on each
  character's before/after table before its write.

## 7. Sequencing with the server rules

The server freeze at the lock (D2) and the priced-patch freeze (E1) **must come after this repair**: they would freeze the
wrong histories as they stand (Caspian's refund, Skylar's post-lock "Ability scores −4" and "Proficiency +3"). The repair
runs under the current rules; D2/E1 are switched on afterwards, staged with B2.
