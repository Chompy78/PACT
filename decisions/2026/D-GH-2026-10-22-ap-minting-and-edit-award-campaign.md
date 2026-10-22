# D-GH-2026-10-22-ap-minting-and-edit-award-campaign — AP and gold are campaign-scoped; edit_ap_award requires the character to still be in the award's campaign

**Status:** **PROPOSED, NOT APPLIED.** `sql/migrations/2026-10-22-ap-minting-and-edit-award-campaign.sql` (+ `-rollback.sql`) and the
fold into `sql/rls-policies.sql` are in the PR; the owner applies the migration after review. After applying: run the Supabase
advisors (`get_advisors`, security) and `get_logs`, per the per-change checklist.

## Context
Two server-side holes, both verified by reading the live function bodies (`pg_proc`, 2026-10-22):

1. **AP minting between campaigns.** Any signed-in user can create a campaign (the creator becomes its DM), bind one of their own
   characters into it with `dm_bind_npc()`, award it any amount with `award_ap()`, take it out with `dm_unbind_character()` (the
   trigger `pact_npc_clear_on_unbind` clears `is_npc` only; `characters.ap` is untouched) and join a victim campaign with
   `bind_character_to_campaign()`, which only sets `campaign_id` and adds the campaign's starting AP once. `characters.ap` is
   DM-authoritative, survives every move, and `pact_enforce_ap_budget_consistency` counts `NEW.ap` as spendable, so the minted AP
   buys real things. `characters.gold` has the same shape (`award_gold()` adds; nothing resets it).
2. **`edit_ap_award` never checked the character is still in the award's campaign.** It authorises on the award's campaign, so a
   former DM could change the AP of a character that had since moved to another campaign. It also did a plain read-modify-write
   with no locks.

## Options
- **Hole 1, where to reset.** (a) Inside `pact_campaign_move_clears_creation` (the existing move trigger) — mixes an unrelated
  concern into a function that exits early when `stats` has no LOG, so a LOG-less row would skip the reset. (b) **A new BEFORE
  UPDATE trigger**, named `trg_pact_aa_reset_grants_on_campaign_move` so it sorts before `trg_pact_ap_budget_consistency`
  (Postgres fires BEFORE triggers alphabetically) and the budget check sees the reset value. Chosen. (c) Fix each RPC — rejected:
  the move is a column change any future RPC could make; the trigger is the one place that cannot be bypassed.
- **Hole 1, reset target.** ap := sum of `ap_awards.amount` for THIS character and THIS (new) campaign, 0 if none; gold likewise from
  `gold_awards`. A rejoin of the same campaign restores that campaign's total; a different campaign starts from its own awards.
  Fires only when `campaign_id` changes to a different NON-NULL value.
- **Leaving to solo (`campaign_id` -> null).** (a) Wipe ap — rejected: it would silently confiscate AP a player legitimately earned,
  a solo character has no DM and no server-side budget check, so nothing is gained. (b) **Leave it** (chosen): the AP is reset the
  moment the character enters ANY campaign, the only place it can be spent against a DM.
- **Gold.** Same carry exists (`gold` is only ever written by `award_gold()`). No server trigger reads `characters.gold` today (it is a
  soft-warning input to the engine's wallet), and 0 live rows hold gold, so it is not exploitable server-side right now, but it is
  the same class and costs one line, so it is reset by the same trigger instead of waiting for a gold-enforcing change to expose it.
- **Hole 2.** Add `characters.campaign_id = ap_awards.campaign_id` to `edit_ap_award` with a clear message ("This character is no
  longer in the campaign that made this award"), after the DM and active-campaign checks (so a non-DM learns nothing), and take
  `for update` on the award row and the character row. Signature, grants (`authenticated` only) and the legitimate path unchanged.
  Lock order is award then character; no other function locks in the reverse order (`award_ap` takes only the character).
- **Admin / service sessions** (no `request.jwt.claims`) are left alone, exactly like the other character triggers.

## Decision
The new trigger + function (SECURITY DEFINER, `set search_path = public, pg_temp`, EXECUTE revoked from public/anon/authenticated) and
the amended `edit_ap_award` as described. `bind_character_to_campaign` is NOT changed: it adds the starting AP after its update and only
when no `ap_awards` row exists for the character in that campaign, so first join = trigger sets 0 then the function grants and records
the start; rejoin = trigger restores the award sum (which already includes the start) and the function skips the grant. Neither
double counts (tested).

## Live blast radius (read-only, 2026-10-22)
40 characters, 5 campaigns, 111 `ap_awards` (0 with a null campaign), 0 `gold_awards`.
- **10 campaign-bound characters:** `ap` equals the sum of their current campaign's awards on all 10 (and the total of all awards on
  all 10). Nothing changes for them; the rejoin arithmetic is exact.
- **5 SOLO characters hold ap > 0** (138, 82, 82, 70, 36; the last-seen figure of 5 still holds). For 4 the value equals awards from a
  former campaign (they get it back by rejoining THAT campaign); for 1 (ap 70) there is **no `ap_awards` row at all** (origin
  unexplained: pre-ledger, a claim source or a manual edit). None is touched now. Joining a DIFFERENT campaign would reset each to that
  campaign's award sum, i.e. the 70 would be lost on any join. **Owner call:** accept, or backfill an award row for that character
  first (not done here; a write).
- **Gold:** 0 characters with gold <> 0, 0 solo.
- **gold/ap invariant:** `any ap <> sum(all awards)`: 1 character (the 70 above) — the only row the model does not explain.

## Not covered (found while reading, not fixed here)
`redeem_character_claim()` INSERTs the copy with `ap = source.ap` and writes a "Carried over" award row. That is an INSERT, not a
campaign move, so this trigger does not fire; it is a deliberate carry-over and is bounded by who can create a claim invite (a DM of
the target campaign, for a character they pick). Worth its own look if a DM could claim a character holding minted AP; not changed.

## Verification
`testing/scripts/creation-lock-guard-test/run-ap-minting.sh` (Docker, in CI's `freeze-rehearsal` job): BEFORE (migration rolled back) the
attacks work, 7 of 24 cases fail; AFTER all 24 pass; the migration re-applies; its definitions are byte-identical to the fold; the
rollback restores `edit_ap_award` byte-for-byte and the gap returns. Also green locally: `rls-baseline-test.sql` (now 49 compared
functions), `session-seal-test.sql`, `campaign-npcs-test.sql`, and the award / freeze / notes / house-rules / images rehearsals.
