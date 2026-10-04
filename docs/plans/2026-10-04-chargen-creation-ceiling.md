# Plan — CharGen refuses a purchase past the DM's creation limit (W1) and prompts at the limit (W2)

> **Status: PLAN FOR OWNER REVIEW — no code written.** Written 2026-10-04. Task: `fix/chargen-creation-ceiling`
> (NEXT board). Owner decisions W1 + W2 were taken the same day; the three open questions at the end are not.
> Decision record to extend when built: `D-GH-2026-10-01-creation-lock-integrity`.

## 1. The gap, and the evidence

`docs/plans/2026-08-30-creation-ceiling.md`, "Done when" #2: *a purchase exceeding the ceiling is refused in
**both** CharGen and Live Sheet.* Only Live Sheet got it.

- `tools/PACT-CharGen-Webtool.html` imports `wouldExceedCeiling` and puts it on `window`, and **never calls it**
  (0 call sites; checked 2026-10-04 by `grep -c "wouldExceedCeiling("`). CharGen's whole creation-limit feature is
  the "Finish creating" button (`cgFinishCreating`, shown only while unlocked **and** a limit is stamped), whose
  tooltip carries the numbers.
- Live Sheet refuses in `buy()` (~line 995): `wouldExceedCeiling(LOG, cost, _ceilOpts(b0))` → an alert naming the
  composition (limit = DM figure + drawback bonus) and both exits (Finish creating, or ask the DM to raise it).
- Live data (2026-10-04, backups of the six Amble characters): the four **CharGen** characters overspent — Moss
  101 / Skylar 98 / Fenwick 97 / Archer 79 against real ceilings of 83 / 80 / 78 / 68 — while the two **Live Sheet**
  characters kept a working block. Missing limits made it worse (Moss's was never stamped; Skylar's, Fenwick's and
  Archer's were deleted by the reload and stale-copy bugs, both now fixed and guarded), but with a limit stamped
  CharGen would still not have refused.

## 2. Why it is not a copy-paste of Live Sheet

Live Sheet is purchase-by-purchase: one `buy()` call, one cost, one refusal point. **CharGen is a whole-build
editor.** Controls (checklists, selects, ability steppers, the budget field) write the DOM; handlers reconcile the
DOM into the event log through a handful of mutation paths, and `repriceDraft()` re-prices the **entire** draft
after every change. There is no single `cost` to test beforehand. What *is* single:

- `_cgRepriceDraft()` — 9 call sites, by its own comment the one place every LOG-mutating path funnels through
  ("a future LOG-mutating path cannot forget one"). The two paths that deliberately skip it (a whole-log pass and
  the lock helper) are exactly the ones that must **not** be refused.
- `commitHistory()` / `_snapshotFrame()` / `restoreFrame()` — the existing undo machinery already knows how to put
  LOG **and** the form back to an earlier state.

## 3. Proposed design

**Rule (W1).** After a LOG mutation, if the character is *unlocked*, a limit is *stamped*
(`creationCeiling(...).enforced`), the edit **increased** spend, and spend is now **over** the ceiling
(`spent > ceiling`; reaching it exactly is allowed, as in Live Sheet), then **refuse**: restore the last accepted
state and show Live Sheet's message with both exits. The "increased spend" clause is the important one: it means

- an edit that lowers or keeps spend is never refused, even if the character is already over (the four overspent
  characters, a limit the DM lowered, a rules re-pricing);
- a drawback (which raises the ceiling and lowers spend) is never refused;
- a character **loaded** over its limit (file, cloud, handoff, autosave restore) is never blocked — only a *user
  edit that makes it worse* is.

**Where.** One check at the end of `_cgRepriceDraft()`'s callers' common tail — i.e. immediately after the reprice
and before `render()` — through a single helper `_cgEnforceCeiling(prevSpent)`. `prevSpent` is the spend at the last
accepted state, kept in a module variable updated whenever a state is accepted (end of `render()`, after the
check). Skipped paths (`_histSuspended` whole-build flows, the lock helper, loads) never reach it.

**Revert mechanism.** Keep a `_cgLastGood = _snapshotFrame()` refreshed on every accepted state. On refusal call
`restoreFrame(_cgLastGood)` (the same primitive `undo()` uses, so LOG, SEQ and every form control are repainted),
then drop the undo frame the refused edit just pushed (`HIST.pop()`, guarded) so a refused edit leaves **no undo
step**, and `REDO.length = 0` is untouched. Alternative considered: call `undo()`. Rejected — it depends on the
edit having recorded a frame (coalesced typing and `_turnLatched` handlers may not), it is subject to the undo
barrier, and it would push a REDO frame for something that never happened.

**Message.** Reuse Live Sheet's text verbatim, factored into `js/ui-helpers.js` (one copy loaded by both tools, the
pattern `_undoBarrierMsg` already follows) so the two tools cannot drift. Shown once per refused edit with `alert`
(the existing house style for refusals), not per keystroke: a refusal restores the state, so typing a digit that
would cross the line is refused once and the field snaps back.

**Prompt at the limit (W2).** After an *accepted* edit, if `ceiling - spent === 0`, unlocked, limit stamped, and the
latch `_cgLimitPrompted` is clear: set the latch and `confirm("You've used all N of N AP. Finish creating now?\n\n
OK = finish (in-play prices from here) · Cancel = not yet")`; OK calls the existing `cgFinishCreating()` flow
(no second confirmation). Re-arm the latch when `remaining > 0` again. Never prompts for a locked character, a
character with no limit, a load, or a refused edit. (Live Sheet already refuses with both exits, so W2 is CharGen
only.)

## 4. Cases the implementation must handle (each gets a test)

| Case | Expected |
|---|---|
| Unlocked, limit 74 (+9), edit takes spend 82 → 83 | accepted; 83 = ceiling, prompt fires once |
| Same, edit takes 83 → 84 | refused, state and form restored, message shown, no undo step left |
| Edit that lowers spend while over the ceiling | accepted |
| Taking a drawback while at the ceiling | accepted (ceiling rises) |
| Locked character, any edit | never refused, never prompted |
| No limit stamped (solo characters, 30 of 34 unlocked live characters) | never refused, never prompted |
| Load / file import / `?handoff=` / autosave restore of an over-limit character | not blocked |
| 🎲 Random roll on a limited character | see open question B |
| Type-ahead in a number field crossing the line | refused once; field returns to its last accepted value |
| Undo after a refused edit | undoes the edit **before** it, not the refused one |
| DM raises the limit (cloud refresh) | ceiling rises; nothing to revert; latch re-armed |

## 5. Not in scope

Server-side enforcement of the ceiling (the guard protects lock and limit entries, not spend; the app is static and
players own their rows, so a tool-side block is a UI guarantee only — same caveat the 2026-08-30 plan states). The
"⚠ no limit" DM Console flag (T1, PR #560). Changing any price, so **no `DATA.version` bump** is expected; the
Players Guide's text about the creation limit must still be checked and reconciled in the same change, per the
"engine AND guide land it" rule in `AGENTS.md`.

## 6. Risks

- **Highest:** the revert path repaints a ~600 KB tool's form from a snapshot; a stale `_cgLastGood` could restore an
  older state than the user expects. Mitigation: refresh it at one place only (end of `render()`), assert in a test
  that accepted → accepted → refused restores to the *second* accepted state.
- A refusal inside an autosave debounce window must not leave the autosave holding the refused state: the check runs
  before `_cgAutosave()`, and a test reloads after a refusal.
- Behaviour change is confined to *unlocked + limit stamped* CharGen characters. Today that is **0** of the six
  campaign characters (all locked) — measured 2026-10-04 — so no live character is affected on release; the first
  one affected will be the next campaign joiner whose DM stamps a limit.

## 7. Open questions for the owner (not decided)

- **A. Hard refuse, or warn?** Hard refuse matches the 2026-08-30 "Done when" and Live Sheet. The alternative is to
  *allow* the edit with a loud banner until the player finishes creating — softer, but it is the behaviour that let
  four characters overspend. **Recommendation: hard refuse.**
- **B. Random roll.** A 🎲 roll builds from scratch against the *Budget* field. Should it be capped at the DM
  ceiling (recommended — it would otherwise hit the new refusal mid-roll), or bypass it? Capping is a one-line
  `min(budget, ceiling)` in the roll's setup; bypassing leaves a way around the block.
- **C. The prompt wording / when.** Prompt at exactly 0 left (this plan), or also at a warning threshold (e.g. ≤ 3 AP
  left)? **Recommendation: exactly 0 only** — anything earlier is nagging.
