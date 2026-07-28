# D-GH-2026-07-14-livesheet-eco-track-level-review-followups — Fix 4 review findings inline, defer 2 cross-tool findings to the roadmap

Status: Active

- **Context:** an independent `/code-review` (8 finder angles + 1-vote verification per candidate) run
  against the merged `D-GH-2026-07-14-livesheet-eco-track-level` PR (#210) surfaced 6 findings that
  survived verification (1 CONFIRMED, 5 PLAUSIBLE). Two other candidates (a naming-ambiguity concern and
  an `awardToNext()` "inconsistency") were REFUTED — both turned out to be intentional, already-documented
  design choices and were dropped.
- **Options:** (a) fix all 6 findings in this follow-up; (b) fix only the findings confined to
  `tools/PACT-Live-Char-Sheet.html` with an unambiguous correct fix, and defer the rest; (c) fix nothing,
  just log all 6 as roadmap items.
- **Decision:** (b). Fixed inline:
  1. **Triple curve resolution per render** — the eco line called `_levelCurve()` directly and again via
     `trackLevel(ap)`; the header added a third independent call. `resolveRules()` can fall through to an
     O(LOG length) backward scan, and `render()` fires on every buy/undo/redo and continuously (no
     debounce) while the time-travel slider drags. `trackLevel(spent, curve)` now accepts an optional
     pre-resolved curve; `render()` resolves `_levelCurve()` once and threads it into every call site.
     Verified 3→1 `resolveRules()` calls per `render()` via a browser console instrumentation check.
  2. **Explicit `0` discarded** — `_levelCurve()`'s `+bc.l1||79`/`+bc.inc||24` treated a DM-configured `0`
     as "unset" and silently substituted the default. Changed to `!=null` checks so an explicit `0` for
     `l1` is honoured (an `inc` of `0` still floors to `1` — see next item, `0` isn't a valid increment
     either way).
  3. **Zero/negative `inc` breaks monotonicity** — `trackLevel()`'s unbroken scan assumes each level's
     threshold is `>=` the previous one; a DM-tuned `inc<=0` (reachable — DM Console's `min="1"` on the
     field is a cosmetic HTML attribute, never enforced, since the save handler is a button click, not a
     form submit) makes the scan return a near-top level for very little AP. `inc` is now floored to `1`.
  4. **`nx` truthy-check mislabel** — the "top level" fallback used a bare `nx?` check; the old fixed-ladder
     `nx` was always a large positive number or `undefined`, so this worked, but the new DM-tunable-curve
     `nx` can legitimately be `0` for a non-top level. Changed to `nx!=null`.
  Deferred to the roadmap (not fixed here): DM Console's roster `apLevel()` still reads the untuned fixed
  ladder even though DM Console is where the tuned curve is configured (a real, confirmed inconsistency,
  but it's a different file with its own scope/design question — should DM Console's roster migrate to
  `trackLevel`/`_levelCurve`, and would that need its own review); and the observation that the same
  "highest level whose per-level threshold `<=` amount" loop now exists in 4 places across 3 tool files,
  none in `js/engine.js` — a real architectural cleanup, but bigger than a follow-up fix and needs its own
  scoping decision (single shared helper vs. per-tool, and whether `js/engine.js` is the right home for
  arguably-display-only logic).
- **Why:** the 4 fixed findings are each a small, mechanical, unambiguous correction confined to the same
  file the original PR touched — low risk, no design judgment required, and each was independently
  verified against the actual code before being applied. The 2 deferred findings are different in kind:
  fixing them means touching a second tool file and making a design call (does DM Console's roster
  concept need to match Live Sheet's, and where should shared level-lookup logic live) — exactly the kind
  of decision that shouldn't be bundled into a "quick fix" follow-up without its own consideration.
- **Status:** Shipped. `testing/scripts/engine-parity-ci.mjs` unaffected (20/0 — no `js/engine.js` or
  `compute()` change, display-only). All 4 fixes manually verified in a local browser preview: negative
  `inc` (`-8`) correctly floors to `1` (confirmed via `_levelCurve()`/`trackLevel()` called directly with a
  monkey-patched `resolveRules()`); explicit `l1:0` is now honoured instead of falling back to `79`;
  `nx=0` under a synthetic curve no longer renders "top level" (`nx!=null` vs. the old bare-truthy check);
  `resolveRules()` call count during one `render()` measured 1 (down from 3) via instrumented override.
