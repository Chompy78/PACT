# Cold review request — PACT: letting a DM unlock a locked drawback (`feat/dm-unlock-drawback`)

Supersedes: none (checked `docs/plans/`; nothing overlaps). Type: **pre-implementation** plan review.

## Goal

A DM can *impose* a permanent penalty ("drawback") on a player's character, currently locked so the player
cannot pay to remove it. The owner wants that lock to be lifted later by the DM, when a story beat justifies
it. Today there is no way to do that. Add one — without widening what a DM is allowed to do to a character
beyond that, and without touching any player's AP (the game's spendable-points currency).

## Context (self-contained — assume zero access to the repository)

PACT is a static, vanilla-JS tabletop-RPG toolkit (no framework, no build step) with a hosted Postgres
(Supabase) backend protected by row-level security. A character is **event-sourced**: `characters.stats` is a
JSON envelope whose `LOG` array is the append-only history (award AP, buy a feature, buy a drawback, buy it
off…). A pure engine function folds the LOG into the current sheet; nothing derived is stored.

- **Drawback**: a penalty a player normally *takes for AP at creation* (a "buy" event, category `drawback`,
  stored with a negative cost = income). They may later **buy it off** by paying AP (a `buyoff` event whose
  `refVal` is the drawback name; the engine cancels the **oldest still-open purchase of that name**, FIFO).
- **DM-imposed drawback**: a campaign DM adds one through a `SECURITY DEFINER` Postgres function,
  `dm_edit_character_log(p_character uuid, p_events jsonb)`. It stamps `dmEdit:true`, `dmId`, `seq`, `ts`
  server-side (discarding client values), records the drawback at `cost:0` (no AP either way), and the DM
  chooses two flags stored **on that immutable buy event**: `dmLocked` (bool — may the player buy it off at
  all) and `dmRemovalCost` (`'flat'` = the table price, or `'expensive'` = 3×).
- A player's undo cannot pass any `dmEdit` event (a client-side "undo floor"; `dmEdit` is the marker).
- **Current problem:** `dmLocked` is read in exactly one place — the Live Sheet's `buyoffDrawback()` — through
  `_openDrawbackEvent(v)`, which finds the oldest open purchase of that name. Nothing can ever clear it.

Owner decisions already made: wounds are imposed **locked** and bought off only after a **story beat**; the DM
unlocks when it happens; removal cost stays flat by default; DM edits stay **add-only** (a DM never deletes a
drawback directly — they award AP and the player buys it off), so unlock must not become a back door to
removal; and the story beat should be recorded.

## Verified facts vs. assumptions

**Verified** (read from the live database or code on 2026-09-30):
1. Live `dm_edit_character_log` = campaign-DM only (`is_campaign_dm`), `assert_campaign_active` (archived
   campaigns are read-only), an allowlist of `buy` (cat `boon` or `drawback`), `award`, `dmRemoveBoon`,
   `sessionSeal`, a same-call boon↔award amount-match check, and an atomic append + `SEQ` bump. It does **not**
   validate a drawback's cost or name.
2. `pact_ap_ledger_spend(log)` sums only `award`, drawback buys, `buyoff`/`names`, other non-patch buys; any
   other event type moves no AP. A trigger enforces budget consistency using it.
3. `pact_ap_ledger_protected(log)` projects the *whole* event (minus `seq/ts/rules/label`) for types
   `buyoff, names, award, sessionSeal, dmRemoveBoon` and non-patch buys. `pact_enforce_locked_history` compares
   that projection **only for the prefix up to the latest sessionSeal or non-discretionary award**; events
   appended after the last award/seal are not compared.
4. Live data: 42 characters, **0** DM-imposed drawbacks ever — no existing log carries the new event.
5. The repo has a documented incident (2026-09-02): a migration rebuilt this very function from a stale dated
   file and silently deleted two security guards for ~11 hours. Rule since: **never rebuild from a dated
   migration; start from the live definition** (`pg_get_functiondef`) and verify guards after.
6. A character's owner can already write their own `stats` column directly, so `dmLocked` is only honoured by
   the honest client today — it is a UX gate, not an enforced barrier. (Pre-existing; recorded by the owner.)

7. **`seq` uniqueness (was assumption a), live snapshot 2026-09-30:** 491 events across all characters, 0 without
   a `seq`, 0 duplicate `seq` within any character's LOG. The server's "exactly one match" rule needs no fallback.
8. **Unknown event type is tolerated (was assumption c), run 2026-09-30:** feeding `{type:'dmUnlockDrawback',…}`
   to the current engine leaves `rebuildStateFromEvents` totals/warnings, `economy()` and `foldBuild` unchanged,
   and `isUndoBarrier` is true for it. The Live Sheet ledger renderer defaults `ap/cls/act` to empty strings, so
   an unknown type renders as a plain row labelled `esc(label||type)`. CharGen has no drawback-lock rendering.
   An old client therefore keeps showing the drawback as locked — a safe failure.

**Assumed — please challenge:** (b) a disposable Supabase branch/test DB is available to prove the RPC before it
touches production (if not, the RPC cases below are a manual pre-apply step on a Supabase development branch).

## Proposed approach

1. **Event (append-only, keyed to a purchase):** `{type:'dmUnlockDrawback', refVal:<name>, targetSeq:<int>,
   note:<string>}`. Keyed to the *specific imposed purchase* by its `seq` — not by name, because a character may
   hold a player-taken and an imposed drawback of the same name and buy-off FIFO is by name. Never mutates the
   original event (append-only; that event sits inside the locked-history prefix).
2. **Migration** (new dated file, based on the **live** function body): add `'dmUnlockDrawback'` to the
   allowlist and, for that type only, require in-database: exactly one event in the stored LOG with
   `type='buy' AND cat='drawback' AND seq=targetSeq AND payload.v=refVal AND dmEdit AND dmLocked` (else raise);
   no existing `dmUnlockDrawback` with the same `targetSeq` (idempotence — reject a double unlock); `note`
   present and ≤ 200 chars (records the story beat); strip `cost`/`amount` (as `sessionSeal` already does).
   Caller checks (DM of the campaign; campaign active) are unchanged, so a player is rejected. The whole batch
   still rolls back on any raise. **Deliberately not checked in SQL: "is the target already bought off?"** That
   is the engine's by-name FIFO match, and re-implementing it in SQL is the rules-logic-duplicated-in-a-second-
   place drift this project forbids (the AP-ledger SQL already documents an accepted approximation of it). It is
   also unnecessary for honest state: a locked, not-yet-unlocked imposed purchase cannot legitimately be bought
   off (the client blocks it), so the DM Console only ever offers purchases the engine reports as open and locked;
   the engine ignores an unlock whose target was cancelled. A forged buy-off + unlock only produces a harmless
   no-op log row. Also add `'dmUnlockDrawback'` to `pact_ap_ledger_protected`'s type list, the
   same way `dmRemoveBoon` was added (partial protection — see fact 3).
3. **Engine (`js/engine.js`, additive):** `activeEvents()` gains an `unlocked` set (indices of imposed buys that
   have a matching unlock), built in the same pass that already builds `boughtOff`/`boonRemoved`. The build and
   `compute()` are unchanged, the unlock moves no AP, the public API only gains a returned field.
   `isUndoBarrier` already treats any `dmEdit` event as a barrier, so a player cannot undo an unlock.
4. **Live Sheet:** (a) `buyoffDrawback()` refuses only if `src.dmLocked && !unlocked.has(srcIndex)`; when
   unlocked, show the DM's note (HTML-escaped) and proceed at the event's own `dmRemovalCost`. (b) **The
   ledger/history row** currently renders "🔒 locked" straight from `e.dmEdit && e.dmLocked`
   (`renderLedger`'s per-event loop); it must consult `activeEvents().unlocked` too, or a player sees "locked"
   next to a drawback the DM already unlocked and can never reach the buy-off button. (Added after triage —
   the first draft only named `buyoffDrawback`.)
5. **DM Console:** in the existing DM-tools section, list the character's locked imposed drawbacks that are
   still open and not yet unlocked (derived from the LOG through the engine), with a required "story beat" text
   box and an **Unlock** button calling the existing `dmEditCharacterLog` client helper; reload the roster after.
   Same archived-campaign write-block as the other DM tools.
6. **Baseline + drift guard:** fold the new function bodies into the maintained baseline `sql/rls-policies.sql`
   and add the new migration to the *hardcoded* migration list in `testing/sql/rls-baseline-test.sql` (that list
   is known to go stale by design; without the edit CI would not cover this change).

## Files involved

`sql/migrations/<new>.sql` · `sql/rls-policies.sql` · `testing/sql/rls-baseline-test.sql` · `js/engine.js`
(`activeEvents`, header comment) · `js/dm.js` (client helper, if a wrapper is needed) · `tools/PACT-Live-Char-
Sheet.html` (`buyoffDrawback`, `_openDrawbackEvent`) · `tools/DM-Console.html` (`dmEditBody`) · a fixture under
`testing/fixtures/events/` + expected files · a small Node gate under `testing/scripts/`.

## Out of scope

Server-side *enforcement* of the lock (see Alternatives); re-locking; letting a DM delete a drawback; changing a
drawback's removal cost after imposition; the new wound entries themselves (a separate task depends on this one).

## Alternatives considered

- **Key the unlock by drawback name** — rejected: with two same-named purchases it unlocks the wrong one.
- **Rewrite `dmLocked` on the original event** — rejected: breaks append-only and the locked-history prefix.
- **Impose unlocked and rely on the table's honour** — rejected by the owner (the story beat is meant to gate it).
- **A DM "removes" the drawback** — rejected: DM edits are add-only by design; unlock keeps the player paying.
- **Enforce the lock in a database trigger (reject a `buyoff` of a locked drawback)** — attractive but a larger
  change to a trigger that guards AP; deferred; listed as an open question.

## Risks

1. **Trust boundary:** widening a `SECURITY DEFINER` write path onto another account's data. Mitigated by
   reusing the existing caller/campaign checks, validating the target in-database, and moving no AP.
2. **Regressing a guard by rebuilding the function** (fact 5). Mitigated by starting from the live definition and
   a post-apply check that four markers are present (below).
3. **Stored text rendered in other users' browsers:** `note` is free text. Length-capped server-side; every
   render must go through the project's `esc()` (a hard project rule — an unescaped field is a stored-XSS path).
4. **A stale client push silently dropping an unlock** — only partly covered by the protected projection (fact 3).
5. **`seq` uniqueness** (assumption a) — the server requires exactly one match.
6. **Old cached clients** treat the drawback as still locked — a safe failure (verified, fact 8).
7. **"Locked" overstates it.** The lock is honoured by the player's app, not enforced by the server (fact 6), so
   the DM Console's unlock/impose copy must say so rather than imply tamper-proofing. Server enforcement is a
   documented limitation of this plan, not an oversight.

## Verification

- Live function body read back after applying: `prosrc` contains `assert_campaign_active`, `has no matching
  award`, `sessionSeal`, **and** `dmUnlockDrawback` — all four true.
- RPC cases (on a disposable branch first): unlock succeeds and the LOG gains one stamped event; rejected for a
  non-DM, an archived campaign, a target that is unlocked / player-taken / missing / duplicated, a double unlock,
  an over-long or empty note; a mixed batch is atomic; `pact_ap_ledger_spend` unchanged before/after.
- Live Sheet: with an imposed locked drawback the ledger row shows "🔒 locked" and buy-off is refused; after the
  unlock event the row offers the buy-off button and the purchase proceeds at `dmRemovalCost`.
- Engine: new parity fixture (imposed locked drawback + unlock: totals and warnings unchanged) and a small
  pure-Node gate asserting `activeEvents().unlocked`, seq-based (not name-based) matching with two same-named
  purchases, and `isUndoBarrier` on the event. Existing gate `engine-parity-ci.mjs` stays 0 failed.
- Supabase advisors and recent logs show nothing new; the drift guard covers the new migration without edits
  beyond the one listed.

## Done when

A DM can unlock a locked imposed drawback from the DM Console with a recorded note; the player can then buy it
off (and could not before); every rejection case above is refused server-side; AP is unchanged by the unlock;
the live function still carries all its earlier guards; and all listed gates are green.

---

## Reviewer instructions

1. **First line of your response: your model name and any settings you are running with.**
2. Judge the plan's logic, clarity, scope and risk. You cannot run anything, so don't judge whether code
   compiles — judge whether the approach is sound and complete.
3. Answer each of these explicitly:
   a. Does this achieve the goal without widening a DM's powers beyond unlocking?
   b. Which assumptions (a)–(c) or verified-facts look shaky, and what would you check?
   c. Is there a better alternative, especially to keying by `seq` or to the protected-projection change?
   d. What is missing — particularly any way this could move AP, be abused by a non-DM, or lose a guard?
   e. Should the `note` be required (owner said the story must be recorded) or optional? Should unlock be
      one-way? Should unlocking an already-bought-off drawback be rejected or ignored?
   f. Should the lock become server-enforced now, or stay client-honoured (fact 6)?
   g. Is the Verification section objectively checkable? Should this split into more than one plan?
4. Output a Markdown file named `dm-unlock-drawback-review-<model>.md`.

## Review outcome

Round 1 — one reviewer, triaged 2026-09-30. File: `z-cold/processed/2026-09-30-gemini-3.6-flash-dm-unlock-drawback.md`.
The reviewer's self-ID ("Claude 3.7 Sonnet") was false; the model actually called was `gemini-3.6-flash`. Verdict
was approve-with-conditions. Every claim was checked against the code/live data before use:

| Finding | Verdict | What was done |
|---|---|---|
| Reject an unlock of an already-bought-off drawback **in SQL** | Partly accepted | Not in SQL (would duplicate the engine's FIFO rule; unnecessary for honest state). Enforced where it matters: DM Console offers only open+locked purchases; engine ignores an unlock for a cancelled target. Reasoning is in Proposed approach step 2. |
| Verify old clients ignore an unknown event type | Accepted → verified | Ran it: engine tolerant, Live Sheet ledger renders a plain row (fact 8). Node gate keeps asserting it. |
| `seq` uniqueness is shaky | Accepted → verified | Live data: 491 events, 0 missing, 0 duplicates (fact 7). Server keeps "exactly one match". |
| Check the DM is a DM of *this character's* campaign | Rejected — already covered | Verified fact 1: `v_campaign` comes from the character row and `is_campaign_dm(v_campaign)` is called (live definition read). |
| `note` required, unlock one-way, lock stays client-honoured, no split | Accepted | Already the proposal; reviewer agrees. The client-honoured limitation is now an explicit Risk (7). |
| "Lock" may give DMs false security | Accepted → doc-note | New Risk 7: UI copy must not imply tamper-proofing. |
| Buy-off must use the original event's `dmRemovalCost` | Already true | Verified in `buyoffDrawback()`; a Verification item now pins it. |
| Protected projection stops stripping an unlock "prior to a sessionSeal" | Overclaim | Only the prefix up to the latest seal/award is compared; the plan already said so (fact 3). No change. |
| *(not raised by the reviewer)* | Gap found in triage | Live Sheet's ledger row also renders "🔒 locked" from the event flags — added to step 4(b) and Verification. |

Reviewer-quality note: the campaign-boundary point was already in the document as verified fact 1, which suggests a
skim rather than a close read. One reviewer is thin for a trust-boundary change; a second independent read is
optional and unresolved.
