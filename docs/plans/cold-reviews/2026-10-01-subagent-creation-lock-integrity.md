> Triaged in session: https://claude.ai/code/session_01Fo8ZLDkMnBkS6uUn9M1Zmq, 2026-10-01

Fresh Claude Code subagent (model identifier redacted per repo policy), cold review: read only the plan file, no repo access

# Cold review: creation-lock integrity plan (2026-10-01)

Reviewed: `docs/plans/2026-10-01-creation-lock-integrity.md` (only this file was read).
Note: the plan asks for the name `creation-lock-integrity-review-<model>.md`. The caller asked for this path, so it is saved here instead.

## Verdict

The diagnosis is careful and evidence-based, and the overall direction is sound: merge rather than rewrite, make lock events append-only on the server, then backdate the repair. As written, though, the plan does **not yet achieve the goal**. Three gaps stand out:

1. Part 1 does not fix the most likely live path (stale restored form values at boot). It only changes which events get lost.
2. Part 2's guard checks the order of lock events *among themselves*. It does not check the position of purchases *relative to* the lock, so the lock can still be bypassed by moving purchases.
3. Part 2's system-edit flag and the F2 join rule leave real bypasses: the flag leaks into the client's own update in the same statement, and a transfer or "own campaign" round trip resets the lock.

Part 3 also collides with Part 2: the new guard refuses the repair itself.

**Recommendation:** split the plan in three and reorder it. Details are under Q5 at the end.

---

## High severity

### H1. Part 1: a stale form still silently deletes purchases. The merge does not make assumption A moot.
The suspected path is "boot after the browser restored form values". In that case `freshLog` is built from **stale** form state, and the merge does exactly what it was designed to do:
- it drops every saved purchase that the stale form lacks (anything bought since the form snapshot);
- it re-appends stale items as "new" purchases at the end, after the lock, priced in-play.

The lock survives, but purchases are lost or duplicated, and the lost ones are re-priced. That is the same class of bug as before.

The root cause is "a rebuild runs at boot when a saved LOG exists". The deeper fix:
- Boot must never call `replaceWholeLogFromBuild()` when a saved LOG or autosave exists for the current id.
- Stop the restore at its source (`autocomplete="off"` on the form, or a reset on `pageshow`).
- Reserve the merge for deliberate user actions (roll, `#b=` link, file import), and ask the user to confirm when the merge would drop any purchase.

### H2. Part 1: a different or missing id gets a "fresh burst". Is it guaranteed not to overwrite the current cloud row?
Step 2 says a different or new id still gets a fresh burst. Legacy flat-build files, untagged Live Sheet exports and many `#b=` links probably carry **no id**.

If a fresh burst ever keeps the current cloud row as its save target, the original loss recurs unchanged. The plan must state the invariant: **a fresh burst always mints a new character id and row, and never saves over an existing id.** It also needs a test asserting that invariant for every path in Verified #2.

There is a matching risk in the other direction. A `#b=` link carrying *my own* id from an older snapshot will merge against my current LOG and drop everything I bought since.

### H3. Part 2: the guard does not stop purchases moving across the lock, which is the lock bypass the guard exists to prevent.
Step 5 only requires the list of lock-family events to be append-only. A player can instead:
- move post-lock `buy` events to before `creationLocked`, or
- edit the stamped `cost` on post-lock buys,

as long as no award or seal follows the lock. The existing protected-history trigger only freezes events up to the last award or seal. The lock-family list stays unchanged, so the guard passes, and those purchases are now priced as creation purchases.

Fix: also make the whole log prefix up to and including the last `creationLocked` in OLD immutable. In effect, extend the existing protection boundary to `max(last award, last seal, last creationLocked)`, and exempt only what is genuinely needed.

The rejected alternative says positional rules "would also freeze legitimate later appends". That is not true of a *prefix* freeze: appends after the boundary stay free. Please revisit the rejection.

Related, and needing a decision: the merge in step 1 replaces **patch slots** (ability scores) *in place at their pre-lock position*. A post-lock ability-score change is therefore priced as a creation purchase. That is a lock bypass built into the client design, and the server cannot see it because patch buys are exempt from protection. Decide whether patch edits after the lock must instead append a new event after the lock.

### H4. Part 2: the system-edit flag leaks into the client's own update.
`set_config('pact.system_edit','on', true)` is **transaction-local**, not statement-local, and not scoped to the events the trigger itself appended.

BEFORE triggers fire in name order: `pact_campaign_move_clears_creation` < `pact_enforce_creation_lock` < `pact_enforce_locked_history`. Suppose any client-reachable update changes `campaign_id` **and** `stats` in the same statement. The move trigger sets the flag. The guard then cannot tell which appended `creationUnlocked` or config events came from the trigger and which came from the client, so a client-smuggled `creationUnlocked` gets through.

The flag also stays on for any later statement in the same transaction, for example inside a multi-statement RPC.

Fix:
- Have the guard check that NEW equals OLD plus the client's appends plus **exactly** the system events it expects (compute them in one trigger rather than two cooperating ones), **or**
- have the move trigger record the exact appended events. Either way, clear the flag immediately after use.
- Also refuse, outright, client updates that change `campaign_id` and lock-family events together.

### H5. Part 2 / F2: leave and rejoin is closed only for the direct case. The bypass through another campaign remains.
With F2, a player in campaign Y with a DM-set lock and limit can:
1. leave Y (the lock is kept and `campaignLeft{Y}` is appended);
2. join campaign Z. This can be **their own campaign**, where they are DM, so `is_campaign_dm` is true and they can also append `creationUnlocked` directly. The last `campaignLeft` is Y, which is not Z, so the lock is cleared;
3. buy at creation prices;
4. leave Z and rejoin Y. The last `campaignLeft` is now Z, which is not Y, so the lock is cleared **again**.

The character returns to Y unlocked, with no limit, and with creation-priced purchases. Transfer X → Y → X does the same thing in two steps.

The plan never states a **threat model**. Is the lock anti-cheat against players, or protection against accidental tool loss? If it is anti-cheat:
- F2 must remember the lock state **per campaign**, and rejoining Y must restore Y's last lock and limit, not merely skip the clear;
- or joining must require DM acceptance, with the DM shown that the lock was reset.

If it is only accident protection, say so explicitly and drop the anti-cheat framing of step 5. Either way, record it in the decision record, because F2 already reverses an owner decision.

### H6. Undo and solo characters break under the new guard.
- **CharGen undo/redo** snapshots whole logs (Verified #3). "Finish creating" followed by Undo removes `creationLocked`, the server refuses it, and the player gets a refusal for an ordinary undo. Does Live Sheet's undo, which replays LOG, behave the same way? The plan does not list which client actions *remove* lock-family events today. Each one becomes a refusal.
- **Solo characters (no campaign):** `is_campaign_dm(null)` is false, so a player who clicked "Finish creating" outside a campaign can **never** reopen creation. Is that intended? It was presumably possible before.
- **Pre-flight:** scan all live rows and backups for any client code path that currently drops or rewrites lock-family events (interim locks, the random-roll carry, DM functions that *replace* a config rather than append one). Do this before turning the guard on.

---

## Medium severity

### M1. Part 1: the identity keys are under-specified and partly contradictory.
- "`name`/`award` singletons by type". `award` is not a singleton (there are many awards), and it is *also* in the keep-unconditionally list. `name` is keyed while `names` is kept unconditionally. Are these two different event types? State one rule per type.
- `buyoff` is keyed against `freshLog`. Does the burst ever emit buyoffs, or does it emit the net drawback state? If it emits the net state, every historical buyoff is dropped. If the drawback buy matches but its buyoff does not, the drawback comes back.
- **Rank or upgrade ladders:** history may hold `X rank 1` and later `X rank 2` (or an upgrade event) where the burst emits a single `X rank 2`. The merge then drops rank 1 and re-orders. Define a key that matches *line identity* (cat + item id), not the full payload.
- **Payload canonicalisation:** fields added by Live Sheet or the engine (`src`, notes, stamped prices, the rules version inside the payload) make the keys miss. Every purchase then gets dropped and re-appended after the lock, which mass re-prices the character. Name which payload fields count toward the key.
- **Duplicates:** with an occurrence count, a removed duplicate is always the *later* one. That is fine, but state it and test it, because pre-lock and post-lock copies are priced differently.
- **Removal or sell events of unknown type** are kept unconditionally while the purchase they refer to may be dropped, leaving dangling references.
- **Fresh events that are themselves lock-family** (a legacy file or `#b=` link carrying `creationLocked`) must be explicitly ignored, or they duplicate.
- **SEQ:** new seq = `max(old SEQ, max seq kept) + 1…`. State it.
- **Dropped protected buys:** dropping a non-patch buy at or before the last award or seal is refused by the existing trigger. The UX then shows "locked character history" for an ordinary form edit. Say whether the merge should pre-check and warn instead.

### M2. Part 2: `auth.uid() is null` is the wrong test for "service or admin".
`auth.uid()` is also null for **anon-key requests with no session**, and in any context without JWT claims. It is safe only if RLS on `characters` admits no anon updates, now and in future. Test the role instead (`current_user` / `session_user` in (`postgres`, `service_role`)), or use the explicit system flag.

### M3. Part 2: `is_campaign_dm(campaign)`: which campaign, OLD or NEW?
If the guard uses `NEW.campaign_id` in an update that also moves the character, the player can point it at a campaign they run. Use `OLD.campaign_id` for authorising appends. Also check that a DM may append `creationUnlocked` or config only on characters **in their campaign**, which presumably is what the definer functions already do.

### M4. Part 2: `campaignLeft` is a client-appendable event.
Step 5 limits only `creationUnlocked` and config appends. A player can append forged `campaignLeft{campaignId:…}` events and so steer the F2 join rule. Restrict `campaignLeft` appends to the system flag only.

### M5. Part 2: DM definer functions and the prefix rule.
The prefix rule applies to DMs too. Any existing DM function that *rewrites* a lock-family event (for example `dm_set_creation_ceiling` replacing the previous config in place, or a DM "undo reopen") will now fail. List each DM function's write shape and confirm that each one is append-only.

### M6. Part 3: the repair is refused by Part 2's guard. The execution order needs fixing.
G2 removes the interim end-of-log `creationLocked` and moves it earlier. Under the new guard the stripped list may or may not change, depending on where the config sits, but removing or moving lock events is exactly what the guard forbids. The `auth.uid() null` exemption covers only the *append* rule, not the prefix rule.

Either:
- name the new guard explicitly in the "disable" set, **or**
- run Part 3 **after Part 1 but before Part 2**: the client fix stops new losses, the repair runs with only the existing trigger to handle, and the guard is then switched on against already-correct data.

The second order is cleaner.

### M7. Part 3: what disabling triggers actually does.
- `ALTER TABLE … DISABLE TRIGGER` is **table-wide**, not per-row. ("disable only the history triggers for these rows' update" is not possible.) It takes an ACCESS EXCLUSIVE lock until commit. That is safe, because other writers block rather than slip through, but every player's save stalls for the duration. Keep the transaction short.
- `session_replication_role = replica` disables **all** triggers, including the `character_backups` trigger the plan relies on for originals, plus the `updated_at` trigger. Rule it out. With `DISABLE TRIGGER`, name the exact triggers and assert that the backup trigger stays enabled. Otherwise, take the backup explicitly inside the transaction.
- **Better alternative:** give the existing history trigger the same narrowly scoped admin-bypass check as the new one (role-based, see M2). The repair then needs no DDL at all.

### M8. Part 3: stale clients after the repair.
Players with an open tab, a PWA offline copy, or a CharGen autosave holding the pre-repair LOG will push it back:
- If the push is refused, does the recovery path offer "keep my local version / force"? If it does, the repair can be undone by a player clicking through.
- A CharGen *legacy autosave* boot goes through the rebuild and merge path against the repaired LOG. Is that safe? See H1.

Notify the five players, and add "re-read 24 h later" to verification.

### M9. Part 3: seq and ts of the backdated lock.
The lock is inserted mid-array. Does it get seq = SEQ (out of numeric order) or are the following events renumbered? Confirm that every consumer uses **array order, not seq order**: the engine, both triggers' projections, and Live Sheet / DM Console scrub. Renumbering would hit the existing protected-history projection if seq is part of it.

### M10. Assumption B should be verified, not assumed, and it is too narrow.
"`_replay()` ignores unknown types" is a single grep. But `campaignLeft` also reaches:
- `validate()`;
- Live Sheet's event list and undo rendering;
- DM Console's log view and scrub;
- `foldBuild` / `economy`;
- the engine-parity fixtures;
- older **service-worker-cached** clients, which will see the new event before they update.

List each consumer and its behaviour on an unknown type. Alternatively, store the leave marker somewhere clients don't render.

### M11. Gold and downtime changes in G2.
Verified #5 says gold and downtime "may change". Moving purchases post-lock can leave a character owing gold it doesn't have (negative balance, warnings, blocked actions). The dry run should report this per character, and the DM sign-off should explicitly accept each negative or owed balance.

---

## Low severity

- **L1.** Verification says the merge test "keeps every lock/limit/award/seal event and every surviving purchase's seq/ts/position". Risks says `merge(old, rebuild(old)) == old`. Use the strict equality (and "zero appended events") as the pass condition. The weaker wording passes a merge that drops or duplicates purchases.
- **L2.** Add mutation tests to the merge unit test with hand-written expected outputs: add an item, remove an item, change a patch slot, blank name, duplicate item, stale form (H1), rank upgrade, buyoff.
- **L3.** "Boot with restored form" in Playwright: say *how* it is simulated (for example, an init script that sets field values before the boot script runs, or a bfcache reload). Otherwise this step cannot be checked.
- **L4.** The server test: say where it runs (a Supabase branch or local stack, **not** production) and with which JWTs. Add cases for every bypass in H3–H5 and M2–M4. There is currently no described harness, so this line cannot be checked.
- **L5.** "Supabase advisors clean": define this as "no new findings against a baseline captured before the migration". Pre-existing warnings would otherwise make it fail or be ignored.
- **L6.** "Post-write output matches the signed-off dry run exactly": name the artefact (for example, a JSON dump or hash of `foldBuild` + `compute` per character) so it is a mechanical diff.
- **L7.** No rollback plan: give the `drop trigger` / restore-old-function SQL for Part 2, and a revert path for Part 1.
- **L8.** The read-only scan of other campaigns is a follow-up, but four characters lost locks, so the bug is not Amble-specific. Run the scan *before* Part 2 ships. The guard freezes whatever state each row is in, including already-lost locks.
- **L9.** Step 3 deletes `_rollCarry`. Do this only after the merge test proves the roll path keeps the lock; the plan's own loss history argues against removing a working mitigation first.

---

## Answers to the plan's questions

**Q1. Does this achieve the goal?**
Partly. Lock and limit events become hard to drop (good), but:
- purchase order is still not protected from a stale form (H1) or from player reordering across the lock (H3);
- the "nothing can silently undo" claim fails under the transfer or own-campaign round trip (H5) and the flag leak (H4).

**Q2. Which assumptions are shaky?**
- A is not moot (H1).
- B is cheap to verify now and is too narrow (M10).
- C is partly wrong: disable is table-wide, and replication-role mode kills the backup trigger (M7).
- Implicit and unstated: a fresh burst never overwrites the current row (H2); DM functions are append-only (M5); consumers order by array, not seq (M9); there is no anon update path (M2).

**Q3. Better alternatives?**
- Boot: do not rebuild from the form when a LOG exists (H1).
- Server: extend the existing protected-prefix boundary to the last `creationLocked`, plus append-only lock-family events and DM-only unlock. This is stronger than the lock-list-only check and closes H3.
- F2: per-campaign lock memory or DM-accepted join, instead of a last-left marker (H5).
- Repair: a role-based bypass in the triggers rather than DDL (M7).

**Q4. What is missing?**
- A threat model.
- The undo and solo-character behaviour.
- A pre-flight scan of live rows for guard conflicts.
- A rollback plan.
- A list of the client actions that remove lock-family events.
- A player-communication step for the repair.
- The trigger firing order.
- Seq and ts rules for inserted events.

**Q5. Should this split?**
Yes, into three plans or PRs, in this order:
1. **Part 1, client fix.** Stops the bleeding and needs no owner decision. Include the boot-path fix.
2. **Part 3, repair.** Run after Part 1 and before the guard, as an ops runbook with its own sign-off.
3. **Part 2, server guard + F2.** It needs the threat-model and owner decision (F2 reverses one) and the most security testing.

D1's simple append-only check (without F2) could optionally ship earlier as a stop-loss. It would also show which path players hit (assumption A), through refusals in the logs.

## Review outcome
Top items to fix before implementing:
- H1 (boot path still loses purchases);
- H3 (reordering across the lock is not guarded);
- H4 (system flag leaks into the client's update);
- H5 (round trip through another campaign resets the lock);
- M6 (the repair conflicts with the new guard, so reorder the parts).
