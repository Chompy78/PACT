# D-GH-2026-08-24-livesheet-drawback-legalcheck — route Live Sheet drawback purchases through legalCheck()/buy()

Status: Active

## Context

`takeDrawback()` in `tools/PACT-Live-Char-Sheet.html` called `emit()` directly:

```js
function takeDrawback(v){ const refund=DATA.drawbacks[v]||0; emit({type:'buy',cat:'drawback',payload:{v},cost:-refund,label:'Drawback — '+v,level:foldBuild(null).hd}); }
```

No `legalCheck()` call at all — the only purchase category in this tool with no rules enforcement.
`D-GH-2026-08-08-drawbacks-phobias-expansion` (which added `DATA.drawbackReq`, the caster-only gate)
claimed "The Live Sheet's `buy()` already blocks anything not matched by `SOFT_WARN`, so both directions
were already refused there" — disproven by `/code-review max`: a Fighter could tick Mana Leak, and a
character could hold a drawback whose stat cap (`DATA.drawbackMaxStats`) their current score already
broke, with nothing in the tool's UI or save path surfacing it. `compute().warnings` already carries the
advisory `⛔` line for both violations; nothing in this tool's purchase path read it.

## Decision

Routed `takeDrawback(v)` through `buy('drawback',{v},'Drawback — '+v)` — the same path every other
purchase category in this tool already uses.

This was not a pure mechanical swap. `buy()`'s existing `cost=priceOf(cat,payload,b0)` line would have
been **wrong** for drawbacks: `priceOf()`'s default whole-build-delta path (`compute(cand).total -
compute(cur).total`) returns 0 for any category with no `_CTX_PRICERS` entry, and `js/engine.js`'s own
`compute()` comment (search "MODEL (b)") establishes that drawbacks are modeled as **income** since
v0.354 — kept at 0 AP in the `total` line by design, tracked via `earned`/`drawbackEarned` instead, not as
a negative delta to `total`. Verified this directly against the engine source before wiring anything, not
assumed — a naive swap would have silently frozen `cost:0` on every future drawback purchase, zeroing out
the AP grant entirely.

Added a `drawback` entry to `_CTX_PRICERS`, same shape as the existing `mbound`/`dbound` flat-price
entries:

```js
drawback:function(cur,p){return -((DATA.drawbacks[p.v]||0));}
```

This makes `priceOf('drawback',...)` return the identical value `takeDrawback()` computed manually
before this change, so `buy()`'s existing cost line now works correctly with zero special-casing.

**Same review pass, same code path, per this project's own established convention of folding a directly-
related finding into the same task rather than leaving it for a separate one:** CharGen's random builder
(`actDraw`/`tryAct`, `tools/PACT-CharGen-Webtool.html`) incremented its `_draws` counter *inside*
`actDraw`, before `tryAct`'s post-mutation rollback check ran — so a candidate drawback that cleared the
per-drawback stat-cap/caster-gate filter (added by `feat/drawbacks-phobias-expansion`) but still got
rejected by `tryAct`'s aggregate check (e.g. pushing the character's total drawback AP over a campaign's
enforced `drawbackCap` — a case the per-drawback candidate filter doesn't cover) silently cost the
character one of its few draw attempts for a drawback that was never actually added. Fixed by moving the
increment to the caller, at both of `actDraw`'s two call sites (the direct `tryAct(actDraw)` call, and the
generic weighted-action-pool loop that also picks it), incrementing only when `tryAct` returns `true`.

## Why

- **`buy()` is the tool's single enforcement point for purchase legality** — every other category already
  routes through it. A category-specific shortcut is exactly the kind of gap that survives review because
  nothing about the tool's overall shape suggests checking for one.
- **The `_CTX_PRICERS.drawback` addition is required, not optional polish.** Without it, this fix would
  have shipped a *worse* regression than the bug it closed (silently zeroing every future drawback's AP
  grant) — caught only by reading `compute()`'s actual drawback-pricing model before wiring the route,
  not by trusting "mirror the existing pattern" as a purely mechanical instruction.
- **The `_draws` leak is a genuinely separate bug** (present before `drawbackReq` existed, per the task's
  own note), but shares its root cause's code path closely enough that fixing it in the same change avoids
  a second review pass over the same ~15 lines.

## Verification

New browser-driven checks in `testing/scripts/tool-pricing-ci.mjs` (dependency-free CDP, matching this
project's established pattern for Live Sheet purchase-flow assertions): a stat-capped drawback is refused
(`drawbackMaxStats`), a caster-gated drawback is refused on a non-caster (`drawbackReq`), and a regression
guard confirms the same drawback still buys cleanly once neither gate applies. Confirmed the checks
actually catch the bug, not just pass trivially: reverted only the Live Sheet fix, re-ran, watched both
checks go red with the exact expected diff (`expected [true,false,true,true], got [false,true,false,false]`
on both), then restored the fix and confirmed green again. Full suite: 171/0. `engine-parity-ci.mjs`: 57/0,
unaffected — this touches tool-local purchase-flow code, not `js/engine.js`'s pricing rules themselves.

## Status

Shipped. `docs/TASK_BOARD_NEXT.md`'s entry graduated to `CHANGELOG.md` in the same change.
