# Plan: Bridge Live Sheet's and DM Console's foldBuild/activeEvents/economy/MUT to js/engine.js

> **STATUS: Commit 1 (fold/economy bridge) is BLOCKED — see "Addendum" below, added after this plan was
> approved but before any code was written.** Commit 2 (DM Console's `MUT` bridge) is unaffected and can
> proceed independently; see the addendum for why they're now decoupled.

## Addendum — post-approval discovery, before any implementation
While working through this plan's Preconditions (specifically, tracing engine internals for the
before/after equivalence check), a load-bearing fact surfaced that neither cold review could have caught
(no code access): **this exact "bridge Live Sheet/DM Console's fold logic" idea was already proposed and
explicitly rejected**, one to two sessions ago, in `DECISIONS.md`'s **D-GH34** entry — as the fix for a
*different*, already-shipped-and-fixed regression.

**What D-GH34 established (verified by reading `js/engine.js` and `DECISIONS.md` directly):**
- The engine's real `foldBuild()`/`_replay()` sets a per-trait `b._raceTraitLocked[label]` flag on every
  racial-trait purchase, which `compute()` uses to decide whether that trait re-prices at the expensive
  current-tier rate or stays at the cheap creation-time rate (the D-GH31 mechanism: "always hard to grow
  into your heritage late").
- Live Sheet's and DM Console's local folds never call `_replay()`, so they never populate that map.
  `compute()` treats a *completely absent* map as "fall back to `b.inPlay`" — which `baseBuild()` sets
  `true` unconditionally — meaning **today, every racial trait in these two tools prices at the expensive/
  locked rate, always**, regardless of when it was purchased.
- D-GH34's own "Options considered" section literally lists bridging these two tools onto the engine's real
  `foldBuild`/`activeEvents`/`economy` as **Option B**, and rejects it: *"bridging the two tools' fold logic
  is a large, already-separately-tracked migration with known unresolved design problems — pulling it into
  a bug-fix-scoped task would both blow the scope and preempt that work."* They shipped a different fix
  instead (Option A: a permanent dual-format contract inside `compute()` itself, keyed on whether
  `_raceTraitLocked` has a real entry for a trait at all).
- The reason Option B is dangerous: without historical `creationLocked`/`campaignBound` events already
  present in an existing character's LOG (and none exist today — these tools never emit them), a real
  `_replay()` pass over that LOG would leave the lock-state `false` for the entire replay. Every racial
  trait would flip from "expensive/locked" (today's actual behavior) to "cheap/creation-priced" — the
  **inverse** of the regression D-GH34 already found and fixed once.

**What this means for this plan:** Commit 1 as originally written ("bridge `foldBuild`/`activeEvents`/
`economy` — behavior-preserving, both tools") is **not actually behavior-preserving** for any character
with racial traits. It would silently change real AP totals for existing Live Sheet/DM Console characters.
This is new, unsolved design work — not an implementation detail the Preconditions section can absorb —
and needs a decision before Commit 1 can proceed: e.g., whether to synthesize a lock-state migration for
existing LOGs (and what that migration should actually do — locking everything from the start would
reproduce today's pricing exactly but also permanently forecloses these tools from ever getting the
"cheap during creation, expensive after" behavior D-GH31 introduced elsewhere), or to leave Commit 1 out of
scope entirely and let this remain the already-tracked, not-yet-designed `feat/engine-bridge-all-tools`
follow-on that D-GH34 itself deferred it to.

**Commit 2 (DM Console's `MUT` bridge) is unaffected** — `MUT` has nothing to do with `_raceTraitLocked` or
replay-driven pricing; it only maps individual buy-event categories onto build mutations. It can proceed on
its own merits, decoupled from Commit 1's now-open question.

**No code has been written.** The remainder of this document (Preconditions, Proposed approach, etc.) is
kept as-drafted/reviewed for Commit 2 and for whatever Commit 1 becomes once its blocking question is
resolved — read Commit 1's steps below as **paused pending that decision**, not ready to execute.

## Goal
Two of PACT's three tools (`tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`) each maintain their
own hand-copied implementation of the event-replay core (`foldBuild`, `activeEvents`, `economy`) instead of
using the shared implementation already exported by `js/engine.js`. This plan converts both tools' local
implementations into thin adapters that delegate to the engine's versions, so a future bug fix or change to
"how a character's event log gets folded into a build" only has to be made once. It also resolves one
already-diverged copy — DM Console's local `MUT` — by bridging it to the engine's version (decision made;
see "MUT decision" below), fixing two confirmed bugs along the way.

## Context
This is a static, vanilla-JS (no framework/build step) tabletop-RPG character tool suite, three separate
HTML files, each a standalone tool. Verified repo rule: `js/engine.js` is documented as "the single source
of truth for all game rules" and the project's hard rule is "never re-implement rules logic anywhere else."

A third tool in this same suite, `tools/PACT-CharGen-Webtool.html`, already completed an equivalent bridge
(logged as decision "D-GH33" in this repo's decision log): it now imports `foldBuild`, `activeEvents`,
`economy`, and `MUT` directly from `js/engine.js` and calls `foldBuild(LOG)` with the tool's full in-memory
event array. It could do this cleanly because CharGen's undo/redo works by snapshotting whole copies of the
event log, so it only ever needs to fold "the current log," which matches the engine's function signature
exactly: `foldBuild(events: array)`.

Live Sheet and DM Console are different: both have a "time travel" feature (scrub to how the character
looked after event #N), so their local versions take an **index**, not an array:
`foldBuild(uptoIdx)`/`activeEvents(uptoIdx)`/`economy(uptoIdx)`, and internally do
`LOG.slice(0, uptoIdx)` before running the same fold logic the engine already has. Live Sheet already
imports `MUT` from the engine (confirmed byte-identical to the engine's copy). DM Console does not — it
still has its own local `MUT`, which has already drifted from the engine's version (see Verified facts
below) — a real, pre-existing divergence, not something this plan introduces.

There is a project-wide numbered decision log (append-only, `DECISIONS.md`) and a numbering convention
(`D-GH<N>`) where the next number must be checked against the live remote branch immediately before
claiming it (collisions have happened before from stale local reads) — this plan requires that check happen
immediately before the edit that uses the number, not just "before landing" the change. A separate test
suite (`testing/tests/engine-parity.html`) must report all tests passing after any change — currently 20
passing / 0 failing — but this suite never loads either HTML tool, so it verifies engine internals only,
not that the tools' imports/adapters actually wire up correctly in a browser (see Verification below).

## MUT decision (resolved before implementation, not deferred)
This plan went through two independent cold reviews. Both, unprompted, converged on the same recommendation
without seeing each other's response: bridge DM Console's `MUT` now rather than leave it diverged. The task
owner has confirmed: **Option A — bridge it.** DM Console will import `MUT` from `js/engine.js` exactly as
Live Sheet already does, deleting DM Console's local copy. This is a deliberate behavior change (see
"Verified facts" for the two bugs it fixes) and is treated as its own commit, separate from the
behavior-preserving fold/economy bridge (see "Proposed approach").

## Preconditions — must be completed and confirmed BEFORE any code is written
These were "assumptions" in an earlier draft of this plan; both cold reviews flagged that they're
load-bearing enough to be hard gates instead.

1. **Call-site audit.** Grep every call site in both `tools/PACT-Live-Char-Sheet.html` and
   `tools/DM-Console.html` for `foldBuild(`, `activeEvents(`, `economy(`, `MUT.`, and `baseBuild(`, plus any
   destructuring of these names. Classify every argument passed to `foldBuild`/`activeEvents`/`economy` into
   one of: numeric index / `null`/`undefined` / a derived numeric value from UI state / anything else. Any
   "anything else" (e.g., an array, an object, a string) blocks the adapter change at that call site until
   resolved — do not proceed past this audit with an unresolved "anything else."
2. **`uptoIdx` edge-case matrix.** Before replacing any function body, write down and verify (against the
   *current* local implementations, as a baseline) the expected behavior for: `null`, `undefined`, `0`, `1`,
   `LOG.length`, `LOG.length + 1`, and any negative value the call-site audit shows is actually reachable.
   `Array.prototype.slice(0, -1)` means "everything except the last element," not "empty" — if a negative
   value can reach this code, that ambiguity must be resolved explicitly (documented expected behavior, or a
   guard), not left to accidental JS slice semantics.
3. **Before/after equivalence check.** For a representative set of event logs — empty log, single event,
   multiple/mixed event types, a log containing falsy/null/tombstoned entries (to check the engine's
   `filter(Boolean)` normalization matches what the local versions did), a multi-tradition `found` sequence,
   and a `dbound` event — compare the *old* local `foldBuild`/`activeEvents`/`economy` output against
   `engineFoldBuild(LOG.slice(0, uptoIdx))` etc. for the same inputs, at multiple `uptoIdx` values including
   the edge cases from #2. This replaces the earlier draft's unverified claim that the implementations are
   "functionally identical" with an actual comparison.
4. **Mutation / object-identity check.** Confirm the engine's `foldBuild`/`activeEvents`/`economy` do not
   mutate the event objects passed in (only the array reference is sliced; the event objects inside are
   shared with the live `LOG`), and confirm nothing downstream in either tool relies on the *old* local
   functions' specific return-object identity, caching, or mutation behavior (e.g., expecting a fresh object
   every call vs. a cached/reused one).

## Proposed approach
Three separate commits, in this order, so a problem discovered in a later commit doesn't force reverting an
earlier, independently-good one:

**Commit 1 — bridge `foldBuild`/`activeEvents`/`economy` (behavior-preserving, both tools):**
1. Complete all four preconditions above for `tools/PACT-Live-Char-Sheet.html`.
2. Add `foldBuild`, `activeEvents`, `economy` to the existing
   `import { validate, DATA, compute, baseBuild, MUT } from '../js/engine.js';` line, aliased (e.g.
   `foldBuild as _engineFoldBuild`) to avoid colliding with the tool's own function names. Replace the three
   local function *bodies* with thin adapters built on one shared local helper (per reviewer suggestion —
   avoids repeating the same slice logic three times and makes the index semantics auditable in one place):
   ```js
   function eventsUpTo(uptoIdx){ return uptoIdx == null ? LOG : LOG.slice(0, uptoIdx); }
   function foldBuild(uptoIdx){ return _engineFoldBuild(eventsUpTo(uptoIdx)); }
   function activeEvents(uptoIdx){ return _engineActiveEvents(eventsUpTo(uptoIdx)); }
   function economy(uptoIdx){ return _engineEconomy(eventsUpTo(uptoIdx)); }
   ```
   No call site elsewhere in the file changes — every existing `foldBuild(uptoIdx)` call keeps working.
3. Repeat steps 1–2 (preconditions + adapter) for `tools/DM-Console.html`.
4. Run `testing/tests/engine-parity.html` — confirm still all-passing.
5. Browser-level smoke test (see Verification) for both tools.

**Commit 2 — bridge DM Console's `MUT` (behavior change, Option A):**
1. Import `MUT` from `js/engine.js` into `tools/DM-Console.html`, delete the local copy.
2. Manual test: found a second/later tradition in DM Console and confirm it now actually creates the
   tradition slot (previously silently did nothing); set/toggle `dbound` on a discipline and confirm DM
   Console now reflects it (previously couldn't process the event type at all).
3. Run `testing/tests/engine-parity.html` again — confirm still all-passing.

**Commit 3 — documentation (describes the landed state, written last, not planned state):**
1. Update `AGENTS.md`'s Architecture section — it currently documents Live Sheet/DM Console as still
   hand-copying `foldBuild`/`activeEvents`/`economy`, and DM Console's `MUT` as diverging; both are now
   stale once Commits 1–2 land.
2. Log a new decision-log entry under the next free `D-GH<N>` — **check the live remote branch immediately
   before making this edit**, not earlier in the session — covering both the fold/economy bridge and the
   `MUT` bridge (including the two bugs it fixes).
3. Add `CHANGELOG.md` line(s).

## Files involved
- `tools/PACT-Live-Char-Sheet.html` — import bridge extended; local `foldBuild`/`activeEvents`/`economy`
  bodies replaced with adapters over a shared `eventsUpTo` helper; no call-site changes.
- `tools/DM-Console.html` — same adapter change, plus `MUT` bridged (local copy deleted).
- `testing/tests/engine-parity.html` — no changes expected; used to verify (see Verification for why this
  alone is not sufficient).
- `AGENTS.md` — Architecture section updated to reflect the new state (Commit 3).
- `DECISIONS.md` — new entry (Commit 3).
- `CHANGELOG.md` — new line(s) (Commit 3).

## Out of scope
- Changing CharGen — it already completed this bridge (D-GH33).
- Changing `js/engine.js`'s exported function signatures or fold/economy logic itself — considered and
  rejected adding an optional `uptoIdx` parameter to the engine's own functions (see Alternatives).
- Redesigning or rewriting the time-travel/scrub UI in either tool — call sites stay untouched.
- CharGen's separate, already-tracked open production bug (subclass abilities not costing AP) — unrelated.

## Alternatives considered
- **Rewrite every call site to pass arrays instead of indices, matching the engine's signature exactly,
  instead of keeping index-based wrapper functions.** Rejected: much larger diff across two tools whose
  entire time-travel UI is built around "the index of the currently-viewed event," for no behavioral
  benefit over the thin-adapter approach — the goal is one shared fold implementation, not a specific
  call-site shape.
- **Leave DM Console's `MUT` divergence unresolved and undocumented.** Rejected outright — a known, verified
  behavioral bug should not stay silent.
- **Add an optional `uptoIdx` parameter to the engine's own `foldBuild`/`activeEvents`/`economy` so the
  tools could call the engine directly without a local wrapper.** Rejected: this would complicate the
  source-of-truth API to serve two tool-specific UI needs (time-travel scrubbing) that the engine itself has
  no concept of; keeping the index-handling local to the tools that actually need it is cleaner.

## Risks / open questions
- The `uptoIdx` edge-case matrix (Precondition 2) may surface a real discrepancy between the two tools'
  existing local implementations and the engine's normalization (`filter(Boolean)`) — if so, that's a
  pre-existing bug independent of this refactor, and should be logged/handled as its own finding rather than
  silently "fixed" by the adapter change.
- Bridging DM Console's `MUT` (Commit 2) changes real, currently-displayed behavior for any campaign with a
  multi-tradition caster or a pact-bound discipline viewed in DM Console. No evidence has been found of live
  data or DM workflows depending on the current buggy behavior, but this hasn't been exhaustively ruled out
  — if something looks wrong for an existing campaign after Commit 2, that's the first place to look.
- Performance of repeated `LOG.slice()` during an active scrub/drag interaction is assumed fine (a
  character's event log is expected to be at most a few hundred events, and the old implementations already
  sliced-then-folded) — not worth dedicating verification time to beyond a passing glance during the browser
  smoke test.

## Verification
- **Preconditions 1–4** (see above) completed and any findings resolved *before* Commit 1's code changes.
- `testing/tests/engine-parity.html` → still all passing (20/0 baseline as of this plan) after each commit.
- **Browser-level smoke test, both tools, required (not optional even if the above pass):** fresh browser
  tab, hard reload, zero console errors, confirm the module import resolves and `engine-ready` fires.
- **Live Sheet acceptance criteria:** the same character produces identical visible stats before and after
  the migration; scrub to position 0, a midpoint, and the final event all match pre-change output; undo/redo
  still functions.
- **DM Console acceptance criteria:** the same roster loads; the same character's history displays
  identically at a past event index; after Commit 2, the two `MUT` regression cases (multi-tradition
  `found`, `dbound`) pass where they previously silently failed.
- `AGENTS.md`, `DECISIONS.md`, `CHANGELOG.md` updated as described in Commit 3.

## Done when
- Live Sheet's and DM Console's local `foldBuild`/`activeEvents`/`economy` are thin adapters (via the shared
  `eventsUpTo` helper) over the imported `js/engine.js` versions — no duplicated fold/economy logic remains
  in either tool.
- DM Console imports `MUT` from `js/engine.js`; its local copy no longer exists.
- `testing/tests/engine-parity.html` reports all-passing.
- The browser smoke test and both tools' acceptance criteria (above) pass.
- `AGENTS.md`'s Architecture section reflects the new state; `DECISIONS.md` and `CHANGELOG.md` are updated.

---

## Review outcome
- **Reviewer findings:** 2 independent cold reviews, ~25 distinct findings combined (heavy overlap between
  the two). Accepted essentially all: call-site audit and edge-case matrix promoted from assumptions to hard
  preconditions; equivalence/mutation checks added as preconditions; MUT decision made explicit (Option A,
  both reviewers independently recommended it — task owner confirmed); split into 3 ordered commits;
  browser-level smoke test added as a required (not optional) verification gate; adopted the shared
  `eventsUpTo` helper; widened the audit grep scope to include `MUT.`/`baseBuild(`; D-GH numbering check
  moved to "immediately before the edit." Nothing rejected outright; the only deferred item was the MUT
  A/B choice itself, which went back to the task owner rather than being decided by either reviewer or by
  synthesizing the two reviews — resolved as Option A.
- **Materially changed the plan?** Yes — the original draft left the MUT decision and the "functionally
  identical" claim unresolved/unproven; the revised plan makes both a hard gate (preconditions, explicit
  commit) rather than an assumption carried into implementation.
- **Without the review:** the plan would likely have shipped with an unverified equivalence claim and a
  test suite (`engine-parity.html`) that doesn't actually exercise either HTML tool — a broken import or a
  silent `uptoIdx` edge-case divergence could have landed undetected.

**Post-approval addendum (this session, before implementation):** a further, more serious finding surfaced
while starting the Preconditions work — see "Addendum" at the top of this document. Commit 1 conflicts with
an already-merged decision (D-GH34) that explicitly rejected this exact approach for a documented reason
(silent racial-trait pricing regression). Commit 1 is paused; Commit 2 is unaffected and can proceed.
