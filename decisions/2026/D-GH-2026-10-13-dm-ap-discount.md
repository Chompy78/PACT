# D-GH-2026-10-13-dm-ap-discount — a DM can take AP off any purchase, and the total given is recorded

**Status:** code DONE on the branch. **The SQL migration is NOT applied** — the owner applies
`sql/migrations/2026-10-13-dm-ap-discount.sql`, then runs `get_advisors`. Apply it **before** the client reaches
`main` (see *Deploy order*). `DATA.version` **not** bumped (see *Why no rules-version bump*). Plan, cold review and owner
decisions: `docs/plans/2026-10-13-dm-ap-discount.md`.

## Context

The owner asked (2026-10-13) for a DM to be able to "assign a discount to any purchase for a player" and for "the total
discounts for AP to be recorded". The prompt was a wizard learning a spell in the story without paying for it. Until now
the only tool was Award AP with a note. That AP is not tied to anything, so the player can spend it elsewhere, nothing
adds up what a DM has given away, and the existing boon grant (a buy plus a matching `award`) has the same weakness.

## Options

- **A. Edit the purchase's `cost`.** Rejected: the log is append-only, and `dm_edit_character_log` exists to refuse
  being a general editor.
- **B. Keep using `award`.** Rejected: not tied to the purchase, no running total. That is the problem.
- **C. Lower `spent` by the discount.** Rejected by owner decision B1: equivalent level and the creation threshold would
  see the smaller figure.
- **D. A later `dmDiscount` event pointing at the purchase, counted as AP the character earned.** Chosen.

## Decision

New event `{type:'dmDiscount', targetSeq, targetCat, amount, note}`, written only through `dm_edit_character_log`
(which stamps `seq/ts/dmEdit/dmId`).

**Engine (`js/engine.js`).** `activeEvents()` resolves each discount to its purchase and returns `discounts`
(purchase index → net AP). `economy()` keeps `spent` at full price and adds the discount to `earned`, plus new
additive fields `discounted`, `apValue` (= `spent`), `apPaid` (= `spent − discounted`) and a per-purchase `discounts`
list. `foldBuild()`/`rebuildStateFromEvents()` put it on the build as its own pool, `b.dmDiscount` (the awards-only
`b.budget` is unchanged). `compute()` adds that pool to `spendable` and reports `dmDiscountAp`. `earnedWithDm()` keeps
it under `ignorePlayerAp`. `creationCeiling()` adds it to the ceiling as `discountBonus`.

**Two totals (owner decision B1).** "AP value" is `spent`, the full price of everything owned — equivalent level and
the creation threshold read it. "AP paid" is `spent − discounted`, what the player actually spent. "AP left" is
unchanged in formula and comes out as AP paid against what was earned, because the discount is earned.

**Which reader uses which total.** Every existing reader was left on its existing figure, and that figure is the right
one under B1, so no reader changed meaning:
- Equivalent level / "Earned Lv" (`earnedWithDm`, both player tools; DM Console `apLevel`) — reads earned, which now
  includes the discount: rises as if the AP had been awarded. **AP value semantics.**
- Live Sheet "≈ Track-Level" (`trackLevel(eco.spent)`) — full price. **AP value.**
- Creation ceiling (`creationCeiling`, `wouldExceedCeiling`, CharGen's ceiling helpers) — `spent` at full price, ceiling
  raised by `discountBonus` (owner decision F1), so a gift never uses up the player's own creation budget. The lock
  itself is manual (the automatic threshold lock was retired), so a gift cannot end creation.
- "AP left" everywhere (`compute().spendable − economy().spent`; DM Console card `available`) — spendable now includes
  the discount. **AP paid semantics.**
- Live Sheet "ignore player AP" review check — compared full spend with DM AP alone; now subtracts the discount.
- New displays: DM Console card (discounts given, AP value / AP paid, history) and campaign total; Live Sheet summary
  line ("N AP value · M paid · D DM discount") and the purchase row ("DM discount −D AP (you paid …)").

**Matching rules.** Keyed by `seq` plus the target's category (`targetCat`: the buy's `cat`, or `buyoff`/`names`) — a
purchase has no other stable identity (payloads differ and many carry no name), and the category is a cross-check
against a wrong seq. A discount counts only when DM-stamped (`dmEdit === true`), after its target, with exactly one
event carrying that seq (ambiguous → nothing), and the target still costs AP. A purchase's net discount is the sum of
its discounts, clamped to [0, cost]; **a negative amount is how a DM corrects a mistake** — nothing is ever deleted.

**SQL (`sql/migrations/2026-10-13-dm-ap-discount.sql`, folded into `sql/rls-policies.sql`).** The RPC validates the
target against the stored log (plus the same call's earlier events), requires a whole non-zero JSON-number amount and a
1–200 character note, keeps each purchase's net discount within [0, cost], and rebuilds the event from a whitelist.
`dmDiscount` joins the protected (frozen) types. A new `pact_ap_ledger_discount()` feeds the budget trigger, outside the
`ignore_player_ap` switch. A new trigger, `trg_pact_dm_discount_authorship`, refuses any change to a log's discounts by
anyone but a DM of the character's campaign, and refuses a discount arriving in a campaign from outside (a campaign
character inserted with one, or a character holding one bound to a campaign).

## Deviations from the reviewed plan (decided during the build)

- **`targetCat` instead of `refVal`.** The plan said `refVal` would hold "the target's value (e.g. the spell or skill
  name)". Real purchase events have no common name field (`payload.v`, `payload.to`, or nothing), so the cross-check is the
  category, which every purchase has.
- **A DM-removed boon keeps its discount.** The plan said a discount disappears if its purchase is "removed". But a DM
  boon removal refunds nothing — its cost stays in `spent` — so dropping the discount would charge the player again
  retroactively. The discount follows the purchase's *spend*: it lasts as long as that spend counts. (Drawbacks, the
  only purchases a buy-off cancels, cannot be discounted at all: they pay AP rather than cost it.) Undoing the purchase is
  not possible after a discount, because a DM event is an undo barrier.
- **Forgery check stands alone.** The plan expected to extend `pact_enforce_player_ap_ceiling`. The live database on
  2026-10-13 still ran the 2026-09-03 version of that function (`2026-10-12-server-player-award-after-lock.sql` is not
  applied), so a separate trigger was written instead; it does not depend on that migration.

## Why no rules-version bump

No price, ladder, gate or existing `compute()` output changed: every existing fixture and every live character
computes identically (engine-parity unchanged for all 104 prior fixtures; 0 live events of type `dmDiscount`). The new
pool is 0 unless a DM writes a discount. The Players Guide already gives the DM this power ("the DM can waive or reduce
any cost at any time, AP, gold, or downtime", §17), so the engine now implements what the guide says rather than
changing a rule.

## Known gaps (accepted)

- The server's sum does not check that the discounted purchase is still owned (owner decision I1). It can only make the
  server more generous than the app, by at most discounts a DM gave.
- A discount on a CharGen `patch` purchase is counted by the server although that spend is not (the server has never
  counted patch spend). Same direction, same bound.
- Admin sessions (SQL editor, no JWT) are not DM sessions; a hand repair that changes a log's discounts must disable
  `trg_pact_dm_discount_authorship` for that transaction.
- Solo characters: a DM discount can only be written to a campaign character, and the trigger refuses any player change
  to discounts, so a solo character can only hold discounts it kept when it left a campaign.

## Deploy order

Apply the migration first. A client that ships first only renders a control whose RPC is refused ("the server has not
been updated" message); a server that is updated first changes nothing until a DM uses the control.

## Verification

`testing/scripts/dm-ap-discount-ci.mjs` (37), engine-parity fixture `EV-034` (105/0), all 26 Node gates, the SQL
harnesses (`rls-baseline-test.sql` +29 discount checks, drift guard widened 18 → 21 functions; `session-seal-test.sql`;
`campaign-npcs-test.sql`; `run-freeze.sh`; `run-award.sh`), a migration/rollback round-trip (rollback restores the three
functions byte-identically), and `testing/scripts/dm-ap-discount-e2e.mjs` (32) driving the real DM Console, Live Sheet
and CharGen. Live blast radius measured 2026-10-13: 37 characters, 10 campaign-bound, 0 `dmDiscount` events.

## Follow-ups

`feat/dm-grant-purchase` (a 100% discount written with the purchase in the same call — the RPC already accepts a target
from the same call) and `feat/wizard-scribe` (a DM-set discount, owner decision C) build on this.
