# D-GH-2026-08-24-missing-data-ref-warning-classification — fix 3 confirmed findings from /code-review ultra on feat/warn-missing-data-refs

Status: Active

## Context

`/code-review ultra` was run against the merged `feat/warn-missing-data-refs` work (PRs #458-464) as a
post-merge audit. Four finder agents ran; every proposed finding was verified against the live code and
live `DATA` before acting on it — two didn't survive verification and were dropped (a "no shared helper"
complaint, already deliberately decided and documented in that PR's own decision record; and an
"inconsistent label formatting" claim, refuted once live `DATA` samples showed each site's extraction
logic correctly matches its own key shape — flat keys for arts/boons/drawbacks/racialSpells vs.
`"Race: Name"`/`"Class: Name"` keys for racialTraits/features vs. `|`-delimited compound keys for
subAbilities/subSpellBundles). Three findings did survive and are fixed here.

## Decision

**1 & 2. `isAdvisory()` (CharGen) / `_lsIsAdvisory()` (Live Sheet) didn't recognize the new warning.**
Both classifier functions predate `feat/warn-missing-data-refs` and were never updated when that PR added
8 new "`<label>` is no longer in the rules data — no cost/effect applied" warning sites to `compute()`.
Verified consequences in CharGen: the new warning rendered with the urgent ⚠ icon and a "Jump to the
control that caused this" tooltip whose click target (`warnTarget()`) has no matching case — so the click
silently did nothing — and it inflated the top-level issue banner/`mtop-warn` indicator (both filter on
`!isAdvisory(w)`). Verified in Live Sheet: the identical warning inflated the `_hard` bucket feeding
whatever reads that count, despite the file's own comment claiming to mirror CharGen "verbatim" for
consistent classification — both were equally out of date. Fixed by adding
`/is no longer in the rules data/` to both regexes. Live Sheet's comment previously said "same two
patterns" (already stale before this fix, since a third pattern — `Creation AP not confirmed` — had been
added without updating the comment); corrected while touching the line.

**3. Test coverage gap.** Only 2 of the 8 new missing-data-ref warning sites (boons via CG-037,
racialSpells via CG-038) had fixture coverage. Added 6 more fixtures — CG-039 (arts), CG-040
(racialTraits), CG-041 (features), CG-042 (subAbilities), CG-043 (subSpellBundles), CG-044 (drawbacks) —
each a minimal build carrying one stale reference in that category. Expected values computed directly via
`compute()`, not guessed. This also gives regression coverage to the two *latent* label-derivation
findings from the same review pass (see Deferred below) — CG-042 and CG-043 pin today's actual output for
`subAbilities`'/`subSpellBundles`' extraction logic, so a future change to either is caught even though
the findings themselves are deliberately not being fixed now.

**Verification discipline.** Two new `tool-pricing-ci.mjs` checks (one per tool) confirm the classification
fix directly — push a stale-reference `boon` LOG event, render, and assert the resulting notice satisfies
`isAdvisory()`/`_lsIsAdvisory()`. Confirmed both fail red against the reverted fix first (exact expected
mismatch: `[true,false]` vs. the fixed `[true,true]`), and that reverting touched *only* those two tests —
nothing else in the 176-check suite moved — before trusting the restored fix as the real one.

## Deferred (not fixed here — recorded so they aren't silently lost)

Two more findings from the same review survived verification as **PLAUSIBLE, not currently reachable**:

- `js/engine.js:470` — `subAbilities`' missing-ref label (`String(key).split("|").pop()`) drops the
  class/subclass portion of a `Cls|Subclass|Name` key, so two same-named abilities in different
  subclasses would produce an ambiguous warning. Verified live: 0 of the current 192 `DATA.subAbilMap`
  entries share a terminal name — not reachable with today's data.
- `js/engine.js:499` — `subSpellBundles`' missing-ref label (`_p[1]||_bk`) can name a still-valid
  subclass as "no longer in the rules data" if only the class portion goes stale while a same-named
  subclass exists under a different class. Verified live: 0 duplicate subclass names exist across classes
  today — not reachable either.
- `tools/PACT-Live-Char-Sheet.html:829` — `SOFT_WARN` doesn't match the new message text, so if
  `legalCheck()` ever surfaced a missing-ref warning as genuinely NEW within one `buy()` call, it would
  hard-block that purchase. Verified `legalCheck()`'s dedupe-by-exact-string logic (line 811) means this
  only matters if that same call's own payload is itself the stale reference — no live UI dropdown can
  supply one (every purchase option is populated from real `DATA` keys), so this needs a hand-crafted or
  externally-imported LOG event to trigger. Lowest reachability of the six original findings.

None of these three misfire with current `DATA` or through any normal UI path, and fixing them would mean
either widening the label-derivation contract (deciding what a "fuller" label should look like for each
of 3 different key shapes) or hardening `buy()`'s classification against a LOG-injection scenario already
covered by this PR's own XSS-hardening work — both judgment calls, not the mechanical fix this pass was
scoped to. Left on the task board as a single follow-up rather than fixed reflexively.

## Why

- **A warning whose own wording says "no cost/effect applied" — i.e. nothing to fix — must not present as
  an urgent, clickable issue.** That contradiction is exactly what both tools' existing advisory/hard split
  exists to prevent for every other informational notice; the new warning class was simply never added to
  either allowlist.
- **A dead click target is worse than no click target.** The ⚠ icon's tooltip promises "jump to the control
  that caused this" — for a warning about a reference that no longer exists, there is no control to jump
  to, and the click silently doing nothing reads as a bug even though nothing is technically broken.
- **6 of 8 new code paths shipped with zero regression coverage.** A future edit to any of the
  label-derivation expressions — including the two latent bugs recorded above — could break silently with
  nothing in `engine-parity.html`'s "0 failed" gate to catch it.

## Verification

`engine-parity-ci.mjs`: **65/0** (59 pre-existing + 6 new fixtures, each value computed directly via
`compute()`). `tool-pricing-ci.mjs`: **176/0** (174 pre-existing + 2 new classification checks, both
confirmed to fail red against the reverted fix before being trusted green).

## Status

Shipped for findings 1-3. Findings 4-6 (the two latent label-derivation bugs and the `SOFT_WARN` gap)
deliberately deferred — see Deferred above; not added to the task board separately since they're recorded
in full here and none is independently actionable without a judgment call this pass wasn't scoped to make.
