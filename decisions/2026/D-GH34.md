# D-GH34 — compute() supports two racial-trait pricing formats: replay-derived (presence-based) and legacy (inPlay fallback)

Status: Active

- **Context:** an 8-angle code review of the D-GH31/32/33 work (run before any further Phase 2
  implementation) found that D-GH31 introduced a live, shipping regression: `compute()`'s racial-trait
  pricing switched from reading a whole-build `b.inPlay` flag (unconditionally `true` via `baseBuild()`,
  so every tool always got correct, expensive current-tier pricing) to reading a per-trait
  `b._raceTraitLocked[label]` map populated **only** inside the engine's own internal `_replay()`. Two of
  the three UI tools (the ongoing event-sourced character-sheet tool and the DM-facing roster tool) each
  have their own separate, hand-copied, index-based `foldBuild` — a known, pre-existing, documented
  architecture fact, not something D-GH31 touched — that never calls `_replay()` and so never populates
  `_raceTraitLocked`. Result: racial-trait pricing in those two tools silently and permanently dropped to
  the cheap creation rate for every character, forever — not a narrow migration edge case, a total loss
  of the tier upcharge the rules intend ("always hard to grow into your heritage late"). A related display
  feature (a "paying a premium vs. creation-basis pricing" comparison banner, driven by forcing
  `inPlay:false` on a comparison copy) went silently inert for the same root-cause reason. Separately, the
  `noLock:true` mechanism (built in D-GH31 specifically anticipating "a future CharGen-style export") was
  never actually wired into the one function that produces such an export (`buildToLiveLog()`) — currently
  dormant since nothing yet emits `campaignBound`, but would have mispriced racial traits in
  higher-budget imported characters as soon as that landed. Both were confirmed via independent code
  review (4 of 8 finder angles independently converged on the pricing regression) and formal verification
  before this fix; a cold-reviewed plan (`docs/plans/2026-07-08-racial-trait-pricing-regression-fix.md`)
  was written and revised before implementation.
- **Options considered:** (A) a presence-based per-trait fallback inside `compute()` itself — if a trait
  has a real `_raceTraitLocked` entry, use it (whichever value); if the entry is absent entirely, fall
  back to `b.inPlay`. (B) actually bridge the two affected tools onto the engine's real, array-parameter
  `foldBuild`/`activeEvents`/`economy` (replacing their local index-based copies) — the already-separately-
  tracked `feat/engine-bridge-all-tools` migration, previously found to have real signature-incompatibility
  problems needing its own design work. (C) have each affected tool's local fold logic manually compute
  and set its own `_raceTraitLocked` map — a third, tool-local copy of the same bookkeeping `_replay()`
  already does.
- **Decision:** (A). `compute()`'s racial-trait pricing now checks **key presence, not truthiness** —
  `Object.prototype.hasOwnProperty.call(b._raceTraitLocked, label)` — because the engine's real replay can
  legitimately set an entry to `false` (a trait bought before any lock trigger fired, a genuine "not
  locked" answer), and that must not be conflated with "no entry at all, unknown, fall back." Present
  (either value) → use it directly. Absent → fall back to `b.inPlay`, which `baseBuild()` still sets `true`
  unconditionally, exactly restoring the two affected tools' pre-D-GH31 behavior. This is a **permanent,
  intentional dual-format contract**, not a temporary shim: `compute()` now knowingly supports
  replay-derived builds and independently-constructed ("legacy") builds side by side. Separately,
  `buildToLiveLog()`'s single `ev()` emission funnel now tags every event `noLock:true` unconditionally
  (not per-call-site), so no future addition to that function can accidentally skip the tag.
- **Why:** (A) over (B) because bridging the two tools' fold logic is a large, already-separately-tracked
  migration with known unresolved design problems — pulling it into a bug-fix-scoped task would both blow
  the scope and preempt that work. (A) over (C) because manually re-deriving the lock state in tool-local
  code is exactly the "reimplement rules logic outside the shared engine" the project's own rule forbids,
  and would create a third copy to keep in sync — the opposite direction of D-GH33's cleanup in the same
  area. The general lesson for future engine changes, worth restating: **an engine change that introduces
  state derived only from replaying a LOG (rather than a value every build starts with) must either
  remain compatible with callers that construct build objects independently of that replay path, or
  explicitly define and document the compatibility boundary where it doesn't** — D-GH31 did neither for a
  caller (the two hand-copied local folds) that already existed and was already known to bypass the
  engine's real replay function.
- **Status:** DONE. `DATA.version` v0.334→v0.335. Presence-based fallback verified directly: a
  Live-Sheet/DM-Console-shaped build (racial traits, `inPlay:true`, no `_raceTraitLocked` at all) now
  prices at 11 AP (locked/expensive), matching pre-regression behavior exactly, vs. 6 AP (cheap) before
  this fix; the "creation-basis reprice" banner now produces a genuinely different number again
  (32 vs. 29 for a test build) instead of always matching the headline total. `buildToLiveLog()` verified
  in a real browser: all emitted events carry `noLock:true`; a high-budget (150 AP) build with racial
  traits, exported and later bound to a campaign, stays correctly creation-priced (6 AP) instead of
  mispricing to the locked rate. Three new fixtures (`CG-004`–`CG-006`) cover the no-map fallback, mixed
  per-trait state, and a specific presence-vs-truthiness regression guard (a value chosen so a future
  regression to `!!map[label]` truthiness-only checking would produce a different, wrong total — 10
  instead of the correct 12 — making that exact mistake fail a test instead of shipping silently).
  `testing/tests/engine-parity.html` → 16/0.
