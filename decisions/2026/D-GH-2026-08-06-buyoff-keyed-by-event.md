# D-GH-2026-08-06-buyoff-keyed-by-event — a buy-off cancels the purchase it targets, not every purchase of that value, and no event schema change is needed to do it

Status: Active. Shipped 2026-08-06.

## Context

`activeEvents()` built its `boughtOff` map keyed by drawback **value**: `boughtOff[e.refVal] = 1` for
every `buyoff` event in the log. `_replay()` and `_economyFrom()` then skipped *every* `buy` event
carrying that value — including ones that happened **after** the buy-off. Measured (the task's own
repro, now `EV-017`):

```
buy "Asthmatic" (+2 AP) -> buy it off (-6 AP) -> take "Asthmatic" again
  build has the drawback?  false      <- silently dropped
  drawbackEarned:          0          <- no AP for it either
```

The second purchase was accepted by the UI, written to the log, and then ignored by the engine with no
warning. The bug reached further into the UI than the engine bug alone: the Live Sheet's buy panel read
the same value-keyed map to decide whether to offer a drawback for purchase, so once bought off, a
drawback rendered as a permanently disabled *"Bought off (3× cost paid)"* tile — `ibOwned()`, whose
`onclick` only flashes a message, never calls `takeDrawback()`. The retake wasn't just silently dropped
if attempted; the UI made attempting it structurally unreachable in the first place.

## Options

- **A — match by `seq`, as the task itself sketched:** add a `targetSeq` field to new `buyoff` events,
  fall back to "cancel the first un-cancelled purchase of that value" for old logs lacking it. Rejected:
  `js/engine.js` has no concept of `seq` at all — it's a tool-side bookkeeping field the engine never
  reads, and `testing/fixtures/events/*.json` never carry one. Adopting it here would make the fixture
  format need a field the engine doesn't otherwise use, purely to satisfy this one mechanism.
- **B — match by array position (FIFO), no schema change** (chosen).

## Decision

**Resolve cancellation by array position in one forward pass, matching each `buyoff` to the OLDEST
not-yet-cancelled purchase of that value.** `boughtOff` changes shape from `{[value]: 1}` to a `Set` of
purchase-event **indices** within `activeEvents()`'s own `evs` array. No new event field; no schema
change; `_replay()`'s existing per-event loop index (`_i`) and `_economyFrom()`'s new `evs.forEach((e,i))`
are the only additions needed engine-side.

For every existing log holding the common one-buy/one-buyoff shape, FIFO resolves to the exact same
purchase the old blanket-by-value check would have caught — **existing characters' totals are
unaffected**, verified directly (`economy()`/`foldBuild()` on a plain buy+buyoff log return the same
`drawbackEarned:0`, drawback absent from the build, as before). For a buy→buyoff→buy sequence, the
buyoff consumes the queue's one entry while it's non-empty; the second buy arrives to a now-empty queue
and stays open — the fix.

The two Live Sheet consumers (the history-ledger "dead" row marking, and the drawback buy panel) both
move from value-keyed to index-keyed lookups. The buy panel's separate *"Bought off (3× cost paid)"*
blocking branch is **removed outright**, not adapted — once cancellation is per-purchase, a drawback
that isn't currently held is simply available to take, regardless of its history; keeping a value-keyed
"was this ever bought off" flag around would just be a smaller version of the same bug, one layer up.

`DATA.version` bumps v0.340 → v0.341 (`compute()` output changes for the affected — previously
incorrect — log shape). New fixture `EV-017`, mutation-tested by reverting the engine change and
confirming it fails (`EV-015`/`EV-016` unaffected by the same revert, confirming no collateral scope).

## Why

**Because FIFO-by-position needs no identifier at all, and covers every case this bug can construct** —
verified by hand-tracing one-buy/one-buyoff, buy→buyoff→buy, two-buys→one-buyoff, and a stray buyoff with
no open purchase (a no-op, not a crash). The task's own suggested `seq`-based fix is a reasonable design
in isolation, but it solves a problem plain ordering already solves for free, at the cost of asking the
engine to understand a field that belongs to the tools. Preferring the option that needs less machinery
to reach the same correctness is the more durable choice, not merely the smaller diff.

## Verification note — this session's environment had no browser, and it caught a real gap

Every other fix landed this session was mutation-tested against a real headless Chromium before being
trusted (revert the guard, confirm the new assertion goes red, restore, confirm green). This task's
machine has no Chromium installed, apt's only candidate (`chromium-browser`) is a snap-wrapper package,
and `sudo snap install` requires an interactive terminal this session doesn't have — so the two new Live
Sheet UI assertions in `testing/scripts/tool-pricing-ci.mjs` were written by careful tracing of the real
DOM-producing code, not by execution, and pushed flagged as unverified.

**GitHub Actions' `pricing` check caught a genuine bug on the first real run — in the test, not the
fix.** Both assertions failed: `drawbackEarned` came back `4` instead of `2`, and a supposedly-cancelled
drawback was still on the build. The cause was `buyoffDrawback()`'s own affordability gate
(`cost=refund*3 > available` → silently refuse): the test's only AP income was the drawback's own +2
refund, well under the 6 AP a buy-off costs, so `buyoffDrawback()` no-opped on every call and no
`buyoff` event was ever appended — the engine fix was never actually exercised. Fixed by funding the
scenario with an `award` event before the buy-off. Re-verified against the real CI browser; see the PR
for the corrected run.

This is the exact failure mode the "not executed locally" flag exists to catch, and it worked as
intended: the gap was caught by CI rather than shipped silently as a passing-but-untested assertion. The
engine half was never in question — it was fully verified via direct Node execution and mutation testing
against `js/engine.js` itself throughout, independent of any browser.

## Related

- `feat/dm-edit-events` (task board) — boon removal needs the same identity-based matching; this fixes
  the mechanism first so that feature inherits it correctly rather than repeating the bug for boons.
