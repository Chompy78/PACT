# D-GH-2026-08-10-ledger-show-lost-purchases — a new "Lost purchases" ledger line, adds to compute().total

Status: **Active**, 2026-08-10.

## Context

Successor to `feat/ledger-itemise-drawbacks` (PR #364), which itemised the *active*-drawback half of the
ledger. What remained, per the owner's 2026-08-05 scope extension: the ledger must also show what was
**lost** — a bought-off drawback, a DM-removed boon — not only what a character currently holds.

MEASURED 2026-08-05: a drawback taken for 2 and then bought off for 6 appeared in NO ledger line. The
categorised lines summed to 0 while `economy()` reported 6 spent. `compute()` is a pure function of the
*build* `b`, and a bought-off drawback (or a DM-removed boon, once `feat/dm-edit-events` shipped 2026-08-10)
is no longer on the build — `_replay()`'s fold skips it entirely (see the `boughtOff`/`boonRemoved` guards).
The buyoff's cost — and a removed boon's original purchase cost, which is never refunded — lived only in
the LOG, invisible to `compute()`'s input.

## Decision

1. **Shape (a): a new ledger line ("Lost purchases") that ADDS to `compute().total`.** Decided by the
   owner at sprint kickoff (this session), independent of `feat/ap-model-reconcile` — the two tasks'
   task-board text pointed at each other ("settle this once, there") anticipating the frozen-vs-repriced
   question would resolve it, but `ap-model-reconcile` settled a different question (Earned Lv/apLevel
   composition, card-vs-ledger labelling) and explicitly left this one to be decided here. Simplest to
   render: no new renderer plumbing in either tool, since both already generically itemise **any** ledger
   line via `r.lines`/`r.itemize` (CharGen's `renderLedger`/`LGROUPS`, DM Console's `ledgerOverlayHTML`/
   `LG`, the Live Sheet's flat `r.lines` table) — a brand-new label just needs its own entry.
2. **`activeEvents(events)` gained a fourth return key, `lost`** (`{evs, boughtOff, boonRemoved, lost}`):
   built in the SAME FIFO-matching pass that already resolves `boughtOff`/`boonRemoved`, because only that
   pass knows *which specific purchase* a `buyoff`/`dmRemoveBoon` event actually cancelled — `compute()`
   sees only the post-fold build, never the log. Each entry is `{kind:'drawback'|'boon', label, cost}`:
   for a drawback, `cost` is the buyoff event's own cost (what was actually spent to remove it, e.g. 3× the
   drawback's value); for a boon, `cost` is the ORIGINAL purchase's cost (still counted in
   `economy().spent` — a removal grants no refund — but no longer shown by the Boons line once the label
   drops out of `b.boons`). Only pushed when the FIFO match actually lands (`q && q.length`), same gating
   as `boughtOff`/`boonRemoved` themselves.
3. **`_replay()` stamps `b._lostPurchases = ae.lost`** — the same "record log-only context on the build so
   `compute()` can read it without a log" pattern as the existing `b._raceTraitLocked`/`b._vigorRankTier`
   stamps. `compute()` itemises it with the identical `add()`/`addItems()` pattern every other ledger line
   uses; absent on a hand-built `b` (empty array default), same as the other two stamped fields.
4. **The re-purchase case (bought, bought off, bought again) shows BOTH states, simultaneously, by
   construction — no special-casing needed.** The retake is a fresh, still-open purchase (FIFO leaves it
   unmatched), priced normally by the existing Drawbacks/Boons line; the ORIGINAL cancelled purchase stays
   in `_lostPurchases` regardless, since the FIFO match happened at a specific index that never un-resolves.
   Verified against EV-017's exact shape: Drawbacks line -2 (active retake) + Lost purchases 6 (the earlier
   buyoff) = total 4.
5. **Line-item labels name the action, not just the value** — `"Bought off — <name>"` / `"Removed by DM —
   <name>"` — so the ledger reads as a sentence ("you did buy this, and then lost it") rather than a bare
   number, satisfying the task's own framing without a second, struck-through row in the Boons/Drawbacks
   section itself (considered and rejected as unnecessary rendering complexity for the same information).
6. **`DATA.version` bumped (v0.341 → v0.342)** — this is a real `compute()` output change for any
   character who has bought off a drawback or had a boon removed (three existing fixtures moved: EV-010
   +6, EV-017 +6, EV-018 +25 — `testing/expected/expected-results.csv` updated in this PR, all deltas
   independently hand-verified against the new mechanism before being accepted as correct, not just copied
   from the failing gate's "got" value).
7. **Grouping**: `"Lost purchases"` added to the `"Boons & Gold"` line-prefix group in both CharGen's
   `LGROUPS` and DM Console's `LG` (and to CharGen's `SECTIONS`, so the section-nav AP subtotal doesn't
   silently drop it), so it itemises inline with its siblings rather than falling into each renderer's
   generic "Other" bucket.

## Why

`compute()` staying a pure function of `b` (never reading the log directly) is the whole reason
`_raceTraitLocked`/`_vigorRankTier` exist as stamped fields rather than `compute()` taking `events` as a
second argument — extending that established pattern to `_lostPurchases` keeps the same architectural
invariant instead of introducing a second way for build-derived info to reach the ledger. Building `lost`
inside `activeEvents()`'s existing FIFO pass (rather than a second pass over the log) avoids re-deriving
the match logic anywhere else — the exact trap `D-GH-2026-08-06-buyoff-keyed-by-event` warns against
repeating.

## Verification

`testing/scripts/engine-parity-ci.mjs`: 30 fixtures, 0 failed (was 27/3-failed before
`testing/expected/expected-results.csv` was updated for EV-010/EV-017/EV-018's new totals — all three
deltas match the new "Lost purchases" line's contribution exactly: EV-010 +6 (the buyoff), EV-017 +6 (the
cancelled purchase's buyoff, alongside the still-active retake's own -2), EV-018 +25 (the removed boon's
original cost, alongside the retake's own +25)). `testing/expected/expected-warnings.json` unchanged for
all three — this feature adds no new warnings.

`testing/scripts/tool-pricing-ci.mjs`: 120/0 (was 116/0) — 4 new checks under "CharGen — the Lost
purchases ledger line reconciles with economy().spent": EV-010's exact shape (6 AP lost line,
`total===economy().spent`), EV-018's exact shape (25 AP, same identity), both combined on one build
(itemised as two separate rows, still reconciling), and EV-017's repurchase shape (both the active retake
AND the lost buyoff visible, neither silently dropped). This is the gate the task's own "Done when"
criteria asked for — the reconciliation identity (`compute().total === economy().spent`) is asserted
directly for the single-buyoff, no-repurchase, no-price-drift case (the one case where the identity is
expected to hold exactly; a repriced/drifted or repurchased build is NOT expected to satisfy it, by the
same frozen-vs-repriced distinction G1/`ap-model-reconcile` already established).

## Related

- `feat/ap-model-reconcile` (`D-GH-2026-08-10-ap-model-reconcile`) — settled a different question (Earned
  Lv/apLevel composition with DM AP, frozen-vs-repriced labelling); did NOT settle whether historical spend
  belongs in `compute()`'s ledger. This task's own decision (recorded here) is the one that does.
- `feat/dm-edit-events` (`D-GH-2026-08-10-dm-edit-events`) — landed `dmRemoveBoon`/`boonRemoved` first,
  unblocking this task's boon half to be verified against a real fixture (EV-018) rather than deferred.
- `D-GH-2026-08-06-buyoff-keyed-by-event` — the FIFO-by-purchase pattern `lost` reuses verbatim.
