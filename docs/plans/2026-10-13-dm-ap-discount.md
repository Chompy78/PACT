# Plan — DM AP discount on any purchase (`feat/dm-ap-discount`)

Date: 2026-10-13 · Status: draft for cold review · Task: `docs/TASK_BOARD_NEXT.md` → `feat/dm-ap-discount`

## Goal
A campaign DM can take AP off any purchase a player character has made (an amount or a percentage, up to its full
price, with a note). The discount belongs to that purchase. The total AP a DM has discounted is recorded and visible.
A 100% discount is how a DM later "gives" a spell or skill for free (follow-up task), and a wizard scribing a found
spell will be a DM-set partial discount (second follow-up).

## Context (everything the reviewer needs — no repo access assumed)
- PACT is a static web app (no build step, vanilla JS) for a points-buy tabletop RPG. Characters spend **AP**
  (advancement points). Three browser tools: a character builder (CharGen), a play-time sheet (Live Sheet) and a
  DM Console. A hosted Postgres database (Supabase) with row-level security is the only backend. There is no
  server code other than SQL functions and triggers.
- A character is stored as an **append-only event log** (`LOG`): `buy` (with a frozen `cost`), `award` (AP in),
  `buyoff` (removes an earlier drawback), DM-only events, and so on. All rules live in one engine module.
  `economy(log)` folds the log into `{earned, spent, available}`. `earned` = awards plus drawback refunds.
  `spent` = the sum of each active purchase's frozen cost. Purchases that later events cancel are excluded first
  (`activeEvents()`).
- Rule from the project: **never edit a past event**. A change to an earlier purchase is made by appending a later
  event that refers to it. Existing examples: `buyoff`, `dmRemoveBoon`, `dmUnlockDrawback` (which points at its
  target by the target's server-assigned `seq` number).
- DMs write to a player's log only through one SQL function, `dm_edit_character_log`. It deliberately allows only
  a short list of event types (`buy` of a boon or drawback, `award`, `dmRemoveBoon`, `sessionSeal`,
  `dmUnlockDrawback`). It stamps `dmEdit: true`, `seq`, a timestamp and the DM's id on each event, so a player
  cannot forge a DM event. Events with `dmEdit` are **undo barriers**: a player cannot undo past them.
- Today the only way to give AP is an `award`. The existing "grant a boon" writes a boon `buy` plus an `award`
  of the same amount. The award is not tied to the boon, so it outlives the boon if the boon is removed, and
  nothing adds up how much has been given away.
- **Owner decision B1 (2026-10-13):** a discounted purchase counts its **full price** toward the character's
  equivalent level and the creation lock. Carry two named totals: **AP value** (the full price of everything
  owned) and **AP paid** (what the player actually spent). "AP left" uses AP paid.
- Live data: about 35+ real characters across 4 campaigns. Changes must not move any existing character's numbers.

## Verified vs. Assumed
**Verified** (read in the code, 2026-10-13):
- Equivalent level ("Track-Level") is computed from **earned** AP (`earnedWithDm()`), not from spent.
- Creation ends ONLY when someone presses the lock button (an explicit `creationLocked` event). The old automatic lock on
  crossing a spend threshold was retired. That threshold is now only the creation **ceiling**'s figure: a purchase that
  would take `spent` past it is refused while the character is still in creation. (Corrected after review: the first
  draft wrongly said spend crossing the threshold fires the lock.)
- The creation ceiling is `threshold + drawback refunds − spent` (`creationCeiling()`).
- A campaign switch `ignorePlayerAp` drops player `award`s from the spendable pool, but keeps drawback refunds
  (they are a trade the player made, not a gift).
- The database has its own copy of the AP sum (`pact_ap_ledger_spend`), used by a trigger that refuses a save whose
  spend exceeds `characters.ap` (DM-granted AP) plus the log's earnings. That SQL sum does **not** resolve
  cancellations the way the engine does. It just adds up every `buy`/`buyoff`/`names` cost and every `award`.
- Another trigger refuses a **non-DM** save that raises the log's total `award` amount once a campaign character
  is locked or sealed. It identifies a DM by WHO is writing, not by a flag in the event.
- A character's owner can write their own log directly, so **a player can forge any event, including `dmEdit: true`**.
  The database notes say this was accepted for the drawback unlock because that event moves no AP. A discount does move AP.
- About 65 call sites in the three tools read `economy()`, `earnedWithDm()`, `creationCeiling()` or
  `creationLockState()` (DM Console 19, CharGen 22, Live Sheet 29).

**Assumed** (to be confirmed during the build):
- No existing log contains an event type named `dmDiscount`, so adding one changes no current character.
- Percentages are converted to a whole AP amount when the DM saves, so the log only ever stores AP.

## Proposed approach
The key idea is to treat a discount as **AP income that is bound to one purchase**. Under B1 this makes most
existing readers correct without being changed. **AP value** stays the same as today's `spent` (full price), so
the creation lock is unchanged. The discount is added to `earned`, so equivalent level rises as if the AP had been
earned. **AP paid** = `spent − discounted`, and "AP left" (`earned − spent`) comes out right automatically.

1. **New event `dmDiscount`** `{targetSeq, refVal, amount, note}`. DM-only, written through
   `dm_edit_character_log`, and pointing at its purchase by `seq`, exactly as `dmUnlockDrawback` does. `refVal` is the
   target's value (e.g. the spell or skill name), cross-checked against the target so a wrong `seq` is refused.
   `amount` is whole AP, stored as a JSON number. A percentage is converted in the DM Console: round to the nearest
   whole AP, at least 1, never more than the cost not yet discounted.
   **Correcting a mistake:** the DM appends another `dmDiscount` on the same target with a NEGATIVE amount. The
   purchase's net discount is clamped between 0 and its cost. No delete, no edit, so the log stays append-only and
   the correction is visible in the history.
2. **Engine (`activeEvents` / `economy`).** Resolve each `dmDiscount` against its target. If the target is not an
   active priced purchase (cancelled, bought off, removed or missing), the discount counts 0. Cap the total
   discounts on one purchase at its frozen cost. Add `discounted` to `earned`, and expose new additive fields
   `discounted`, `apValue` (= `spent`) and `apPaid` (= `spent − discounted`), plus a per-purchase list. A discount
   **survives `ignorePlayerAp`**, as drawback refunds do, because it is DM-given. `foldBuild()` adds it to the
   budget it hands to `compute()`.
3. **SQL migration.** Add `dmDiscount` to `dm_edit_character_log`. Validate the target there: it must exist by
   `seq`, be a priced `buy` or `buyoff`, and existing discounts plus this one must not exceed its cost. Rebuild the
   event from a whitelist of fields. Teach `pact_ap_ledger_spend` to count a `dmDiscount` as income, and count it even when the
   campaign ignores player AP (it is DM-given). Add it to the protected (frozen) event types.
   **Anti-forgery (required):** extend `pact_enforce_player_ap_ceiling` (the trigger that already refuses a non-DM rise
   in `award` totals) so that on a campaign character, a save by anyone other than a DM of that campaign may not raise
   the log's total `dmDiscount` amount, in any lock state. Any `dmDiscount` amount that is not a JSON number is refused.
   Add a negative test: a player save appending a forged `dmDiscount` is refused. Then run the database advisor
   (`get_advisors`) and check recent logs.
4. **DM Console.** On each character card, "DM edit — discount a purchase": pick a priced purchase from the log,
   enter AP or %, note required. Show that character's discount total, and a campaign total. Every player-set
   string goes through the escape helper.
5. **Live Sheet and CharGen.** On the discounted line in the purchase history, show "paid X AP (list Y, DM discount
   Z)". Show **AP value** and **AP paid** where the totals are shown today.
6. **Tests.** Engine fixtures for: a discount; a discount whose purchase is later bought off (it goes away); an
   over-discount (capped); a discount with `ignorePlayerAp` on. An end-to-end browser test drives the DM Console and
   checks the Live Sheet. Before and after, replay every live character and confirm no figure moved.

## Files involved
`js/engine.js` (`activeEvents`, `_economyFrom`, `economy`, `foldBuild`, `earnedWithDm`, `creationCeiling`) · a new
`sql/migrations/<date>-dm-ap-discount.sql` (+ rollback) · `tools/DM-Console.html` (`dmEditBody` and its click
handler) · `tools/PACT-Live-Char-Sheet.html` and `tools/PACT-CharGen-Webtool.html` (ledger and totals display) ·
`testing/fixtures/`, `testing/expected/` · a decision record mapping every reader to AP value or AP paid.

## Out of scope
Discounts on gold or downtime (a separate deferred task). DM-adding a purchase for free (`feat/dm-grant-purchase`).
Wizard scribing (`feat/wizard-scribe`). Moving the existing boon grant onto discounts (that belongs to the grant task).

## Alternatives considered
- **Edit the purchase's `cost`.** Rejected because the log is append-only, and widening the DM function into a
  general editor is exactly what it was built to refuse.
- **Keep using `award`.** Rejected because the AP isn't tied to the purchase and there's no running total. That's
  the problem being solved.
- **Lower `spent` instead of raising `earned`.** Rejected because it breaks B1: the creation lock and equivalent
  level would both see the smaller figure.

## Risks / open questions
1. **Creation ceiling — DECIDED (owner F1, 2026-10-13).** A discount raises the creation ceiling by its amount, the same
   way drawback refunds do (`creationCeiling()` gains the discount alongside `drawbackBonus`), so a gift never uses up the
   player's own creation budget. The creation lock still fires on full value (AP value), per B1. The lock itself is manual (see Verified), so a gift cannot end creation early.
2. **Database sum without cancellation — ACCEPTED as a known gap (owner I1, see Review outcome).** The SQL sum doesn't drop cancelled purchases, so it may still count a
   discount whose target was bought off. That can only make the server *more* generous than the engine. Is that
   acceptable, or must the SQL check the target is still active?
3. **Forged discounts — RESOLVED in the approach** (step 3, anti-forgery). Both reviewers flagged it; the code confirms
   players can write any event, so this is a required server check, not an open question.
4. **Existing quirk:** in an `ignorePlayerAp` campaign, today's boon-grant `award` is dropped from the pool while the
   boon's cost still counts. Not fixed here, but the grant task should move boons onto discounts.

## Verification
Engine parity test: 0 failed, with the new fixtures. `expected-results.csv` is unchanged for every existing fixture.
The end-to-end DM Console → Live Sheet test passes. A read-only replay of every live character shows identical
`earned`, `spent` and `available` before and after. The database advisor shows no new findings.

## Done when
A DM can discount any priced purchase, and correct a discount. The discount disappears with its purchase. A forged
player-side `dmDiscount` is refused by the database, proven by a negative test. AP value and AP paid are shown in
all three tools. The campaign discount total is visible to the DM. All checks above pass. A decision record (`decisions/2026/D-GH-<date>-dm-ap-discount.md`) maps every reader of the AP
totals to AP value or AP paid.

---

## Reviewer instructions
1. On your first line, state your model name and settings.
2. Judge the logic, clarity, scope and risk of this plan. Don't judge code correctness you can't check from text.
3. Answer each question: Does this plan achieve the goal? Are any of the assumptions shaky? Is there a better
   alternative? What's missing? Is the Verification section objectively checkable? Should this be split into more
   than one plan?
4. Give your opinion on Risks 2–3, and flag any problem with the decided Risk 1.
5. Output a markdown file named `dm-ap-discount-review-<model>.md`.

## Review outcome
Round 1, 2026-10-13. Two reviewers via API: Gemini (`gemini-3.8-flash`; self-identified wrongly as gemini-2.5-pro) and
OpenRouter Nemotron (`nvidia/nemotron-3-ultra-550b-a55b:free`; self-identified wrongly as gpt-4o). Both: approve with conditions.
- **Accepted:** percentage rounding rule (both); DM correction path (Gemini); forged `dmDiscount` must be refused by the
  database (both; confirmed in code, now a required step with a negative test); `refVal` meaning (Nemotron); discount
  survives `ignorePlayerAp` on the server too; decision record promoted to Done-when (Nemotron).
- **Rejected:** "a free gift can lock creation early" (Gemini). The automatic lock was retired; creation ends only by an
  explicit lock. But it exposed a wrong Verified fact in this plan, now corrected.
- **Rejected:** "the ledger object type is unclear" (Nemotron). It is a SQL function; context the reviewer could not see.
- **Decided (owner I1, 2026-10-13):** Risk 2, the server sum not dropping cancelled purchases, is ACCEPTED as a known gap
  and stated in the decision record. It only helps a tampered client, by at most a discount on a purchase it has given up;
  making SQL resolve buy-offs would put a second copy of the engine's rules in the database.
- **Deferred to the build:** confirm no live log already contains a `dmDiscount` (a one-line SQL count).
