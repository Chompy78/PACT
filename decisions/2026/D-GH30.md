# D-GH30 — Live Sheet's "AP left" reads the frozen ledger (`economy()`), not `compute()`'s retroactive recompute

Status: Active

- **Context:** the roadmap task `fix/livesheet-undo-bug` was filed as "undo() produces incorrect state,"
  suspecting the permanent "−1 AP, floor 1" discount from Martially/Magically Bound toggles wasn't being
  restored on undo. Investigation (replaying `undo()` across every event type and diffing against a full
  LOG re-fold) disproved that: `undo()` is a pure pop-and-refold and already matches
  `rebuildStateFromEvents()` byte-for-byte in every case tested. The real defect was a display bug: buying
  a cross-class feature *then* binding that class makes the headline "AP left" (`compute().remaining`,
  which retroactively discounts every feature of that class, including ones bought before the bind) drift
  one AP above the frozen-ledger `economy().available` that actually gates purchases (`buy()`,
  tools/PACT-Live-Char-Sheet.html:445) — a "phantom AP" the sheet advertises but won't let you spend.
  `priceOf()` already hard-codes a `-2` delta for `mbound`/`dbound` specifically to dodge this same
  "refund bug" in the frozen ledger (tools/PACT-Live-Char-Sheet.html:421) — the headline display just
  hadn't been given the same treatment.
- **Options considered:** (A) point the Live Sheet's three "AP left" displays (desktop econ line, mobile
  sticky bar, floating badge) at `economy().available` instead of `compute().remaining` — display-only,
  no engine change; (B) change `compute()`/`rebuildStateFromEvents()` in `js/engine.js` to stop
  retroactively discounting — but that logic is *correct* for CharGen's one-shot, order-free recompute,
  so this would need to be event-order-aware and risks CharGen regressions, a `DATA.version` bump, and
  `testing/expected` updates.
- **Decision:** (A). Live Sheet now displays `eco.available` in all three "AP left" locations
  (tools/PACT-Live-Char-Sheet.html:593-594). No `js/engine.js` change, no `DATA.version` bump,
  `engine-parity.html` stays 5/0 unaffected. Normal characters (who never bind a class after buying that
  class's other features) see no change in the displayed number.
- **Why:** smallest change that makes the sheet self-consistent with its own buy-gate and matches the
  app's existing "prices freeze at purchase / no retroactive refund" tooltips; avoids touching shared
  rules logic that CharGen depends on behaving the current way. The underlying model conflict — `compute()`
  is stateless/order-free by design, but event-sourced tools want frozen-at-purchase pricing — is **not**
  resolved by this fix, only the one user-visible symptom. That reconciliation (whether `js/engine.js`
  should grow a frozen-ledger-aware remaining-AP export, or the current per-tool split is the permanent
  design) is intentionally deferred — see the new NEXT roadmap item.
- **Status:** DONE for the display fix. The long-term engine-vs-ledger reconciliation is open — tracked in
  `docs/PACT_ROADMAP.md` NEXT.
