# Plan: Fix the racial-trait-pricing regression in Live Sheet & DM Console; close the noLock gap in CharGen's export

## Goal
A code review found that a recent engine change (adding a `creationLocked`/per-purchase pricing-lock
mechanism to the shared rules engine) silently and permanently broke racial-trait pricing in two of the
project's three tools, and left a related safety mechanism unwired in a third. This plan fixes both,
restoring correct behavior without expanding scope into a much larger, separately-tracked migration.

## Context
This is a static, vanilla-JS, no-build-step tabletop-RPG tool suite. One shared rules module
(`js/engine.js`) is meant to be the single source of truth for all game rules; the project's own stated
rule is "never re-implement rules logic anywhere else." In practice, of the three UI tools, only one
(the character-builder tool) currently imports the shared `foldBuild`/`MUT`/`activeEvents`/`economy`
functions live; the other two (an ongoing event-sourced character-sheet tool, and a DM-facing roster
tool) each still have their OWN separate, hand-copied, *index-based* versions of `foldBuild`/`activeEvents`/
`economy` (this is a known, pre-existing, documented architecture fact — not something this plan
introduces or needs to fix). All three tools DO call the same shared, imported `compute(build)` function
on whatever build object their own fold logic produces.

A recent change to the shared engine added a `creationLocked` LOG-event mechanism: racial/species-trait
pricing now depends on a per-trait tag, `build._raceTraitLocked[traitName]`, which is populated **only**
inside the shared engine's own internal replay function (call it `_replay()`). Before this change, the
same pricing decision read a build-wide boolean field (`inPlay`) that a shared build-constructor function
always set to `true` — so every tool, regardless of how it built its `build` object, got consistent,
correct (expensive, current-tier) racial-trait pricing once a character was actually in play.

**The regression:** the two tools that have their own separate fold logic never call the engine's
internal replay function, so they never populate `_raceTraitLocked`. After the change, `compute()`
silently treats "no `_raceTraitLocked` entry for this trait" as "not locked," so racial-trait purchases
in those two tools now **always** price at the cheap creation rate — a permanent, silent regression
affecting every character in both tools, not a narrow edge case. A closely related display feature (a
"you're paying a premium vs. creation-basis pricing" comparison banner) that used to force creation-rate
pricing via `{inPlay:false}` is now also silently inert, for the same root-cause reason.

A separate, smaller gap: the mechanism includes an opt-out field, `noLock:true`, specifically designed
for a one-shot import/creation burst (documented in the engine's own code comments as anticipating
exactly this use case) so that burst doesn't self-trigger the new automatic locking threshold. The one
function that actually produces such a burst (the character-builder tool's "export to the other tool"
function) was never updated to set this field on the events it emits. This is currently dormant (nothing
in the shipped UI yet triggers the automatic threshold's other required precondition) but will silently
misprice racial traits in exported/re-imported characters once that precondition ships.

## Assumptions vs. verified facts
- **Verified (via independent code review + formal verification, not assumed):** the two tools' local
  fold functions genuinely never set `_raceTraitLocked`, confirmed by reading both files directly and
  grepping for the identifier. `compute()` genuinely no longer reads the old `inPlay` field anywhere.
  The build-constructor function genuinely still sets `inPlay:true` unconditionally (dead now, but still
  set on every build). The export function genuinely never sets `noLock` on any emitted event, and the
  character-builder tool genuinely supports building characters well above the pricing-lock threshold
  (its own UI already warns about this).
- **Assumed:** that no other caller anywhere in the codebase constructs a build object with racial traits
  already populated but bypasses both the old and new mechanisms in some other way not yet found — the
  review covered all three tools' `compute()` call sites but a fourth, not-yet-existing caller can't be
  ruled out.

## Proposed approach

**Fix 1 — a build-level/per-trait fallback inside `compute()` (the shared engine), not a change to either
tool.** For each racial trait being priced, check whether the build's `_raceTraitLocked` map has an entry
for that specific trait **by key presence, not by truthiness** — this distinction matters: the engine's
real replay function can legitimately set an entry to `false` (a trait bought before any lock trigger
fired, correctly determined "not locked"), and that must be treated as a definitive "not locked" answer,
not conflated with "no entry exists at all, we don't know, fall back." So: key present (`true` or `false`)
→ use that value directly, no fallback, regardless of which. Key absent entirely → fall back to the OLD
`inPlay`-based behavior. Since the build-constructor function still unconditionally sets `inPlay:true`,
and neither of the two affected tools ever touches `_raceTraitLocked`, this fallback **exactly restores
their pre-regression behavior** — no change to either tool's own files needed at all. As a side effect,
this also fixes the dead "creation-basis reprice" display banner in the event-sourced tool: since that
tool's builds always take the fallback path, forcing `inPlay:false` on the comparison copy works again
exactly as it did before.

This fallback is a deliberate, permanent compatibility contract, not a temporary shim: `compute()` now
knowingly supports two build formats — replay-derived builds (real `_raceTraitLocked` entries) and legacy
builds (no entries, `inPlay`-based) — and that dual support is the fix, not a workaround to later remove.
Document it as such in the decision record (see "Done when").

**Fix 2 — tag every event the export function emits with `noLock:true`.** A mechanical, single-function
change in the character-builder tool. Every event this function produces represents part of one atomic
creation/import burst by construction (that's the function's entire purpose), so every emitted event gets
the flag — no conditional logic needed. Add a short comment at the point of emission recording *why*:
"this function emits a synthetic creation/import burst; every event is intentionally tagged `noLock:true`
so the burst can never self-trigger the automatic pricing-lock threshold" — so a future maintainer doesn't
mistake the blanket tagging for an oversight and remove it.

**Fix 3 (verification only, no code change expected) — confirm the fix doesn't regress the one tool that
*does* use the new mechanism correctly.** The character-builder tool's *import* path (a separate function
from the export path in Fix 2) already goes through the engine's real replay function and already
populates `_raceTraitLocked` correctly for every trait it processes — Fix 1's fallback should never
trigger for that path, since every trait it owns will have a real entry. Re-run the existing regression
fixtures plus a manual round-trip check after Fix 1 lands to confirm this holds.

## Files involved
- **The shared engine module** — `compute()`'s racial-trait pricing block: change the lock-state lookup
  from truthiness (`!!map[trait]`, which conflates "false" with "absent") to explicit key-presence testing
  — "key present (either value) → use it directly; key absent → fall back to `build.inPlay`."
- **The character-builder tool's export function** — add `noLock:true` to every emitted event, with the
  invariant comment described in Fix 2.
- **Test fixtures** — no expected-value changes anticipated for existing fixtures (the two tools with the
  regression aren't exercised by the engine-level fixture suite at all — that's precisely why this
  regression wasn't caught before shipping; see Risks). Four new fixtures:
  1. A build with racial traits and NO `_raceTraitLocked` entries at all (proving the fallback restores
     old behavior identically to `inPlay:true`).
  2. A build with a MIXED `_raceTraitLocked` state — one trait with a real entry, one trait with no entry
     at all — proving the fallback is applied per-trait, not per-build (the entry'd trait uses its real
     value; the entry-less trait falls back to `inPlay` independently).
  3. A build proving presence-vs-value are handled distinctly: one trait with `_raceTraitLocked[x]=true`,
     one with `_raceTraitLocked[y]=false`, one with no entry for `z` — asserting `x` prices locked, `y`
     prices unlocked (NOT falling back to `inPlay` just because the value is falsy), and `z` falls back.
  4. One exercising the export function's `noLock` tagging directly (a burst whose total exceeds the
     pricing-lock threshold, confirming it doesn't self-trigger the automatic lock).

## Out of scope
- Actually bridging the two affected tools onto the shared engine's real, array-parameter
  `foldBuild`/`activeEvents`/`economy` functions (replacing their local, index-based copies). That is a
  separately tracked, already-known-nontrivial migration (signature-incompatible closures, needs its own
  design work) — doing it now would be a large, unrelated scope expansion disguised as a bug fix.
- The other six lower-severity findings from the same code review (a minor engine-internal efficiency
  cleanup, a small amount of duplicated spend-accounting logic, one dead regex clause in two tools, an
  already-disclosed-and-intentional temporary rules-duplication exception, a stale/incomplete duplicate
  build-constructor helper, and a redundant one-line wrapper function). None of these affect correctness;
  they're independent, low-risk, single-file cleanups that don't need cold review.
- Updating the "creation-basis reprice" comparison banner's *implementation* — Fix 1 makes its existing
  code correct again as a side effect; no direct edit to that display logic is anticipated.

## Alternatives considered
- **Bridge the two affected tools' fold logic onto the real engine replay function now, instead of adding
  a fallback.** Rejected for this plan: this is exactly the separately-tracked, already-flagged-as-larger
  migration mentioned in Out of Scope. A previous investigation into this exact migration already found
  real, nontrivial signature-incompatibility problems needing their own design decision — pulling it into
  a bug-fix-scoped task would both blow the scope and preempt that separate work.
- **Have each affected tool's local fold logic manually compute and set its own `_raceTraitLocked` map**
  (a third, tool-local copy of the same bookkeeping the engine's replay function already does). Rejected:
  this is exactly the kind of "reimplement rules logic outside the shared engine" the project's own
  stated rule forbids, and would create a third copy of logic to keep in sync — the opposite direction of
  a recent, related cleanup in the same area (which had *removed* duplicate copies for the same reason).
- **Leave the fallback out and just accept the two tools' racial-trait pricing is cheap now.** Rejected:
  this is a live, shipping regression with real economic effect (players getting racial traits without
  the "hard to grow into your heritage late" tier upcharge the rules intend) — not a display nit.

## Risks / open questions
- **Why didn't the test suite catch this?** The project's automated regression fixtures only exercise the
  shared engine's own functions directly (`compute`, `rebuildStateFromEvents`) — never either tool's own
  hand-copied local fold logic, because doing so isn't currently automatable (no headless runner for the
  full HTML tools exists yet, a separately tracked gap). This class of regression is structurally
  invisible to the existing safety net; worth a documented callout so a future engine change doesn't
  repeat it, but building that automation is out of scope here.
- **Does the per-trait fallback design definitely match the intended pre-regression behavior in every
  case**, or only the common one? Since the build-constructor function's `inPlay:true` default is truly
  unconditional and neither affected tool has ever set it to anything else, the fallback should be exact —
  now covered by regression fixtures 2 and 3 above (mixed-state and presence-vs-value), not just a
  spot-check.
- **Should the existing "clean generator export" fixture also get `noLock:true` added to its events**,
  for realism, even though its outcome is unaffected (it has no racial traits)? Minor, not blocking.
- **Forward-looking dependency, not a current blocker:** the fallback's correctness depends on the
  build-constructor function's `inPlay:true` default staying unconditional. If a future change makes that
  default conditional (unlikely, but worth recording), the compatibility path this fix establishes would
  need re-examining alongside it.

## Verification
- `testing/tests/engine-parity.html` reports all fixtures passing (current baseline plus the four new
  fixtures proposed above).
- Manual/browser check, stated as an objective comparison: build a mid-tier character with an own-race,
  non-pack racial trait in the event-sourced character-sheet tool; confirm the displayed price for that
  trait equals `DATA.MASTER[tier][band]` (the current-tier Master Cost Table rate) — the same value
  `compute()` would have produced under the pre-regression `inPlay:true`-always behavior — not the flat
  origin/cross creation rate. Repeat for the DM-facing tool's read of the same character, expecting the
  same number in both tools.
- Confirm the "creation-basis reprice" comparison banner in the event-sourced tool once again produces a
  number strictly less than the headline total for a character with a locked (current-tier-priced)
  racial trait — i.e. `reprice < r.total`, not `reprice === r.total` (the currently-broken state per the
  code review finding).
- Re-run the character-builder tool's export→import round-trip check (already used earlier in this
  effort) for a build whose total cost exceeds the pricing-lock threshold and includes racial traits;
  confirm the exported/re-imported traits' displayed price is byte-identical to the pre-export
  `compute()` total for the same build (not just "looks right").

## Done when
`compute()`'s racial-trait pricing produces identical output to the pre-regression behavior for any build
that never went through the shared engine's real replay function; the character-builder tool's export
function tags every emitted event `noLock:true` with the invariant comment from Fix 2; all four new
fixtures pass; the manual checks above confirm correct pricing in both previously-affected tools and a
working drift banner; a new decision record documents the regression, its root cause, and the fix,
cross-referenced from the two decisions that introduced the mechanism this fixes, and explicitly captures
the general lesson for future engine changes: **an engine change that introduces state derived only from
replaying a LOG (rather than a value every build starts with) must either (a) remain compatible with
callers that construct build objects independently of that replay path, or (b) explicitly define and
document the compatibility boundary where it doesn't** — this regression happened because neither was
done for a caller (the two hand-copied local fold implementations) that already existed and was already
known to bypass the engine's own replay function.

---

## Reviewer instructions
You are reviewing this plan **cold, with no access to the codebase** — only the text above. You are a
general reasoner, not a code analyzer: judge the plan's **logic, clarity, scope, and risk — not code
correctness you cannot verify.** If the plan relies on knowledge you don't have, that itself is a finding.
Find gaps, unstated risks, and better alternatives — including structural/redesign suggestions, not just
"missing detail" — but do not implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Which of the plan's **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated for the goal?
4. What's missing — an edge case, a risk, a dependency, a **verification step** the plan doesn't mention?
5. Are "Verification" and "Done when" objectively checkable, or do they hide ambiguity?
6. Should this task be split? Is anything in "Out of scope" actually load-bearing?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the plan
yourself unless asked. **If a section is genuinely solid, say so briefly rather than inventing concerns** —
false findings cost the implementer a wasted cycle.

---

## Review outcome
- Reviewer findings: 10 → accept 0 (no implementation-strategy change) / convert-to-plan-addition 6
  (mixed-state fixture, presence-vs-value fixture, strengthened decision record, exporter invariant
  comment, two verification-wording tightenings) / noted-no-change 4 (the "two build formats" framing is
  the fix, not a problem; rejecting the "bridge everything now" alternative stands; the `inPlay:true`
  forward-dependency is recorded as a risk, not acted on; the legacy-compatibility-contract point is now
  explicit in Fix 1's text).
- Materially changed the plan? **No** — the core fix (per-trait presence-based fallback in `compute()`,
  `noLock` tagging in the export function) is unchanged. The review strengthened test coverage (2 fixtures
  → 4, explicitly covering presence-vs-truthiness) and documentation (an explicit compatibility-contract
  statement, an architectural lesson for the decision record, an invariant comment at the `noLock` call
  site) without changing what code gets written.
- Without the review, what would have happened: **a real implementation bug would likely have shipped.**
  The original Fix 1 description said "check whether the build has a `_raceTraitLocked` entry" in prose,
  but didn't rule out an implementer reaching for the obvious-looking `!!map[trait]` truthiness check
  instead of explicit key-presence testing — which would silently mis-treat a legitimately-`false`
  (real, replay-derived "not locked") entry as "absent, fall back to `inPlay`," reintroducing a
  narrower version of the same class of bug this plan exists to fix. The review's presence-vs-value
  fixture requirement makes that specific mistake fail a test instead of shipping silently.

## Implementation status: DONE
Both fixes implemented exactly as planned (presence-based fallback via `Object.prototype.hasOwnProperty`,
`noLock:true` injected in `buildToLiveLog()`'s single `ev()` funnel rather than per-call-site). All three
regression fixtures (`CG-004`–`CG-006`) match hand-derived expected values, including the
presence-vs-truthiness regression guard producing 12 (not the 10 a truthiness-only implementation would
give). Both fixes independently verified live: a Live-Sheet/DM-Console-shaped build now prices racial
traits at 11 AP (was 6 before the fix); the creation-basis reprice banner now produces 29 vs. a 32
headline (was always equal); `buildToLiveLog()` in a real browser tags all 13 emitted events `noLock:true`
and a 150-AP import burst with racial traits stays correctly creation-priced (6 AP) after a later
`campaignBound` event, instead of mispricing to 11. `testing/tests/engine-parity.html` → 16/0.
`DATA.version` v0.334→v0.335. Full record: `DECISIONS.md` D-GH34.
