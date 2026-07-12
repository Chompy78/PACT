# Session 2026-07-12 — campaign AP model: implementation

Continuation of the handoff in `docs/sessions/2026-07-12-campaign-model-session.md` (engine foundation +
cold-reviewed plan already on `preview`). This session did the tool-side work end to end, including an
unplanned scope expansion and a `/code-review` pass that reversed one of this session's own earlier calls.

## What shipped
- **Live Sheet:** stopped pre-mixing DM AP into `b.budget`; every AP-gating call site (`render()`,
  `refreshBuy()`, `renderSheet()`, `buy()`, `buyoffDrawback()`, `buildBuyPanel()`, paid spell-swap costs)
  now shares `apCeiling()`/`apAvailable()`, built on `compute(b,{dmAp,ignorePlayerAp})`.
- **CharGen:** its first cloud character-load/save feature (see `DECISIONS.md`
  `D-GH-2026-07-12-campaign-ap-model` for why this went beyond "display-only"), plus the AP-source
  breakdown, Player-AP lock, and four-state display.
- **Both tools:** a non-blocking grandfather notice on the `ignore_player_ap` toggle-flip case, and a
  `window._dmApStatus` fourth display state ("DM AP unavailable"), reset on every non-cloud load path.

## Pivots & decisions a future agent might second-guess
- **CharGen scope: user picked "build the full cloud feature now" (A1) over the assistant's recommended
  A2 ("wire only what's free, defer DM-AP load").** Recon (the plan's own "VERIFY FIRST" gate) found
  CharGen had no cloud character concept at all, not just an unwired field — a bigger gap than the plan
  anticipated. Full option analysis in `DECISIONS.md`.
- **The `displayRemaining` formula was NOT what shipped first.** The plan's own wording implied flooring
  "AP left" at 0 (`max(0, min(spendable−spent, spendable))`) so a post-toggle-flip character never reads
  negative. First implementation did exactly that — then `/code-review` (angle B, "removed-behavior
  auditor") caught that flooring **silently discarded the true overspend magnitude** for the far more
  common case (a plain, non-campaign character who's simply over budget — previously showed e.g. "−12 AP
  left" in red, now would've shown a bare "0"). Re-derived: the plan's literal "never negative" wording
  only had to hold for the one worked toggle-flip example, not as a blanket display rule; the actual
  invariants that matter (never let a NEW purchase exceed the ceiling; grandfather old purchases; warn,
  don't block) don't require flooring at all. Shipped `apAvailable = spendable − spent`, unclamped —
  simpler code, matches CharGen's own already-unclamped `r.remaining`, and fixed a second bug for free (a
  0-cost item was previously purchasable through `buy()`'s gate while overspent, because `0 > floor(avail)`
  can be false when `0 > raw avail` was true).
- **A pre-existing, unrelated Live Sheet bug got fixed in-session, reversing an earlier "log it, don't
  fix it" call.** Mid-implementation, this session found (and initially declined to fix, to protect scope)
  that the Live Sheet's cloud "Load character" handler writes `window.LOG=`/`window.SEQ=`/
  `window.__charId=` — dead writes, since those are top-level `let` bindings, not `window` properties — so
  clicking Load updated the new DM-AP display correctly but silently left the OLD character's data
  in place. `/code-review` (two independent angles, ranked "highest confidence/highest impact") re-surfaced
  it; given the fix was well-understood (mirror the file's own already-correct `_lsConsumeHandoff()`
  pattern) and directly touched the exact function this session was already editing, the earlier
  "defer" call was reversed and it shipped fixed + re-verified in a real browser (Playwright).
- **8-angle `/code-review` at `high` effort surfaced real, fixable issues a solo pass would likely have
  missed** — 3 independent angles converged on the same "displayRemaining hand-duplicated 4×" finding, 2 on
  the `window.LOG=` bug, and one caught a genuine gap (`refreshCloudCampaignRules()`, which resolves the
  campaign-rules badge on every page reload while signed in, was never wired to also resolve the AP-model
  fields — so a returning player would see accurate campaign-rules filtering but a stale "player AP only"
  chip until they re-opened the Cloud menu). All fixed and re-verified before this branch was considered
  done.

## Verification approach (no headless test runner for the tools exists — REV-11)
Both tools' `engine.js`-dependent logic was verified in Node (direct `js/engine.js` imports — the
before/after blocker check, the `displayRemaining` formula against the plan's stated cases). The actual
DOM/UI code was verified in a **real headless browser** (Playwright, pre-installed in this environment) —
necessary because the tools' cloud modules import `js/supabase-client.js`, which imports
`@supabase/supabase-js` from `esm.sh`, unreachable from this sandbox. Worked around with
`page.route()` stubbing the CDN import (letting the real local engine/sync/auth/campaign module graph
resolve) and, for exercising the actual save/load click handlers, `page.addInitScript()` injecting mock
`_syncBridge`/`_campaignBridge` objects before the page's own `sync-ready` dispatch — so the tests run the
*actual shipped* `onLoadClick`/`onSaveClick`/`render()` code, not a re-implementation of it. This is a
reusable pattern worth keeping in mind for any future PACT session verifying cloud-dependent UI without
live Supabase credentials.

## Handoff / open follow-ups (see roadmap output at end of session)
- Filed: extend Live Sheet's `_rulesStatus`→`window._dmApStatus` duplication cleanup (low priority —
  `simplification` review angle flagged it, not fixed this session, low risk either way).
- Filed: `apCeiling()`/`apAvailable()` re-fold+recompute on every call from `buy()`/`buyoffDrawback()`/
  paid-swap-cost sites, where the old code needed only a ledger read — flagged by the `efficiency` review
  angle, not fixed this session (judged negligible at this app's LOG sizes; a `(b,eco)`-accepting overload
  would be the fix if it ever matters).
- Deferred (already tracked in `AGENTS.md`/roadmap as `feat/ap-model-reconcile`): whether the
  `displayRemaining` formula should move into `js/engine.js` as a shared export instead of being
  hand-copied per tool.
