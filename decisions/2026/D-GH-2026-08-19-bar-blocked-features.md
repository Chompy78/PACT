# D-GH-2026-08-19-bar-blocked-features — one `DATA.features[lab].bar` flag, not a per-tool blocklist

**Status:** DONE · no `DATA.version` bump (`compute()`'s pricing output is unchanged for every existing
build; `bar` only gates whether a *new* purchase can be emitted, never re-prices an owned one)

## Context

Owner needed `Barbarian: Rage`, `Druid: Wild Shape`, and `Bard: Bardic Inspiration die` off the market
immediately — real defects in each, fixes pending — without touching `compute()` or bumping the rules
version.

A precedent already existed: v0.314 barred five other features (`Fighter/Paladin/Ranger/Rogue: Weapon
Mastery`, `Fighter: Additional Fighting Style`) via a hardcoded `BARRED_FEATURES` array inside CharGen's
`buildClassPickers()`. The obvious shallow fix was to extend that array with the three new labels. A gap
audit before touching anything found that shape was already failing silently:

- The array only ever reached **one** of CharGen's three purchase paths — the class-picker grid. Its 🎲
  Randomize action pool and its free-typed "+ search all" box's reconciliation validator both iterated
  `DATA.features` independently and had never excluded even the original five.
- **Live Sheet never had a bar mechanism at all.** All three of its own buy-list builders (origin-class,
  cross-class, all-classes browse) had been offering the original five features for purchase since
  v0.314 shipped — the bar had only ever reached CharGen.
- DM Console has no feature-purchase path; nothing to check there.

So the pre-existing "fix" was a single array read by a single call site, silently unenforced everywhere
else it needed to be. Extending it with three more strings would have reproduced the same gap for the new
features and left the old five's five-tool-wide hole exactly as open as it already was.

## Decision

Generalize into a data flag — `DATA.features[lab].bar === true` — read independently by every purchase
path in both tools, rather than a list threaded through call sites:

- CharGen's `buildClassPickers()` derives its barred set from the flag instead of a second array.
- CharGen's Randomize action and its search-all reconciliation validator (`_CG_RECONCILE_VALID.feature`)
  each gained their own `!f.bar` check.
- Live Sheet's three buy-list filters each gained the same check, closing the gap that had existed since
  v0.314 for the original five features too, not just the three new ones.

All eight barred features (five original + three new) now carry the flag; `BARRED_FEATURES` is deleted.

## Why a flag, not a shared exported list

A shared array still requires every call site to remember to import and check it — the exact failure
mode that let five of the eight escape enforcement for months. A property on the data the call site is
*already reading* (`DATA.features[lab]`) can't be forgotten the same way: there is no second thing to
import, only a field to check on a value already in hand. This is the same shape as `f.inv`, `f.hidden`,
`f.noncore` — existing per-feature flags the same call sites already gate on.

## What stays true for an existing owner

`bar` gates `emit()` for a *new* purchase only. It is never consulted by `compute()`'s pricing lookup, so
a character that already owns a barred feature (hypothetically — checked and confirmed **no live
character owns any of the three** via a direct `characters` table query) continues to price identically.
CharGen's free-typed validator closing is the one path that could plausibly be mistaken for retroactive:
it fires only on `input`/`change` DOM events from active typing, never during LOG replay on load, so it
cannot retract an already-owned row.

## Verification

`testing/tests/engine-parity.html` 40/0 (unchanged — no pricing moved). `tool-pricing-ci` 158/0, run four
times locally: two runs hit an already-documented CDP readiness flake with two unrelated symptoms
(`Live Sheet never became ready`, then a null `#spec` element mid-flow in a *different* CharGen step),
neither reproducing and neither touching the filter predicates this change edited; isolated by stashing
the diff and confirming the pre-edit tree also passed clean, ruling the diff out as the cause before
trusting the next two clean runs. `chargen-flows-e2e` 66/66, `dm-console-ui-e2e` 96/96, `sw-cache-e2e`
pass, `guide-theme-e2e` 24/24, `log-fuzz` 500/500.
