# 2026-07-08 — Live Sheet "undo() bug" turned out to be a display divergence (D-GH30)

This note exists because the roadmap task's premise was **wrong about the root cause**, the fix
required picking between two valid design options a future agent could reasonably second-guess, and an
earlier subagent pass on this same task stopped without committing — a second pass (this one) made the
actual call. A future agent revisiting AP-display logic, or picking up the deferred reconciliation task,
should read this first.

## What the task asked vs. what was actually wrong

The 🔴 NOW roadmap task `fix/livesheet-undo-bug` was filed on the suspicion that `undo()` in
`tools/PACT-Live-Char-Sheet.html` didn't correctly restore the permanent "−1 AP, floor 1" discount from
Martially/Magically Bound toggles, producing incorrect state after an undo.

An investigation pass (an Opus subagent, run before this session's user-facing turns) replayed `undo()`
across every event type and diffed the result against a full LOG re-fold via `rebuildStateFromEvents()`.
They matched byte-for-byte in every case. **`undo()` was never broken.**

The actual bug: buying a cross-class feature, then binding that class (Martially/Magically Bound), made
the headline "AP left" — `compute().remaining`, which retroactively discounts every feature of the bound
class including ones bought *before* the bind — drift one AP above `economy().available`, the
frozen-purchase-price ledger that actually gates spending in `buy()`. Concretely: award 30 → buy a
cross-class Wizard feature (cost 3) → bind Martially Bound: Wizard → headline said "30 AP left" while the
buy-gate only allowed 29. `priceOf()` already hard-codes a `-2` delta for `mbound`/`dbound` specifically
to dodge this same "refund bug" in the frozen ledger (tools/PACT-Live-Char-Sheet.html:421) — the headline
display just hadn't been given the same treatment.

## The decision (D-GH30) — Option A, chosen by the owner

The investigating subagent stopped and reported rather than fixing, because both of the task's own
stop-triggers fired: the root cause differed from the description, and the correct fix touches a genuine
design fork with cross-tool blast radius. Two options were laid out for the owner:

- **Option A (chosen):** point Live Sheet's "AP left" at `economy().available` instead of
  `compute().remaining` — display-only, no `js/engine.js` change, no `DATA.version` bump. Matches the
  app's own "prices freeze at purchase / no retroactive refund" tooltips and the buy-gate. Trade-off:
  Live Sheet's number then diverges from the engine's own `rebuildStateFromEvents().remaining`, which
  still carries the old retroactive-discount value — a cross-tool inconsistency, not resolved by this fix.
- **Option B (not chosen):** make `compute()`/`rebuildStateFromEvents()` stop retroactively discounting.
  Rejected because that behavior is *correct* for CharGen (a one-shot, order-free recompute — there's no
  "purchase order" to freeze), so this would need to be event-order-aware, risks a CharGen regression,
  and would force a `DATA.version` bump + `testing/expected` update for a bug that only shows up in one
  event-sourced tool's one display line.

**Shipped:** all three "AP left" displays in Live Sheet (desktop econ line, mobile sticky bar, floating
badge) now read `eco.available`. Verified in a real browser (see Verification below) that the phantom-AP
divergence is gone and the headline now agrees with the buy-gate.

**Deferred (handed to the roadmap as `feat/ap-model-reconcile`, NEXT):** whether `js/engine.js` should
grow a frozen-ledger-aware remaining-AP export so every event-sourced tool shares one implementation, or
whether the current per-tool split (CharGen: `compute().remaining`; event-sourced tools: local
`economy()`) is the permanent, intended design. Either answer needs to be logged as a decision.

## Verification

No headless runner exists yet (REV-11), so verification was done in a real Chromium browser via a static
`python -m http.server`, served under a `/PACT/` path prefix (the app hard-codes absolute paths for
manifest/service-worker). The Supabase CDN import (`https://esm.sh/@supabase/supabase-js@2`) is
unreachable in this sandbox even through the configured egress proxy — mocked via Playwright
`page.route()` with a minimal stub `createClient()` (auth no-ops, a `Proxy`-based chainable query
builder) so the module bridge's `engine-ready` gate still fires and `DATA`/`compute`/`economy` load for
real.

Repro before the fix (confirmed by reading `compute().remaining` directly, without reverting the code):
`compute().remaining` = 30, `economy().available` = 29, in the award-30/buy-Wizard-feature/bind-Wizard
sequence above. After the fix, the on-page headline (`#apFloatN`) reads 29, matching `economy().available`
and the buy-gate.

`js/engine.js` was not touched, so `testing/tests/engine-parity.html`'s 5/0 baseline is unaffected by
construction; spot-checked via the Node fallback in `docs/HOW-TO-WORK.md` (CG-001/002/003 `compute()`
output unchanged) rather than running the full browser harness.

## Process note: a roadmap single-writer slip

`docs/PACT_ROADMAP.md`'s house rule is "single writer — agents *output* new items for the human to fold
in, don't append directly" (see the 2026-07-05 engine-bridge session note for the same rule correctly
followed). This session's roadmap edit correctly **removed** the resolved `fix/livesheet-undo-bug` NOW
item (removing a DONE task in the same change it graduates to `CHANGELOG.md` is the explicitly correct
pattern), but then also **directly appended** the new `feat/ap-model-reconcile` NEXT item via a normal
file edit, rather than outputting it in the paste-ready format for the owner to fold in. A same-day
follow-up commit reverted the direct append and re-posted the item as a plain output block instead (see
`CHANGELOG.md`'s entry for that follow-up commit).

## A cross-project lesson worth keeping

Playwright's `proxy.bypass` list works *with* Chromium's implicit loopback bypass, not by replacing it:
Chromium already skips the configured proxy for `localhost`/`127.0.0.1`/`[::1]` by default. The special
bypass token `<-loopback>` **disables** that default (it's for the rare case you want loopback traffic to
go through the proxy) — passing it while trying to *add* a bypass entry does the opposite of what it
looks like it does, and every local request silently starts round-tripping through the proxy, which
403/405s inbound-loopback destinations as an SSRF guard. Pushed to `ai-lessons-learned`.
