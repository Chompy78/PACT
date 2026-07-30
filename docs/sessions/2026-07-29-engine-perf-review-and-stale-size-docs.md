# 2026-07-29 — Engine perf review (PR #279): benchmarked instead of trusted, then traced its wrong premise to the review prompt itself

## What happened

Started as a request to look at a pasted external review (GitHub Copilot Chat's suggestions for
`js/engine.js`) and act on the approved subset. Every claim was verified against the real code first
(via an `Explore` agent), then — rather than implementing the review's stated "low-risk, big-win" set on
trust — each accepted change was benchmarked before and after. That benchmarking **inverted the review's
own priority order**: its top-ranked suggestion (`structuredClone`) turned out to be a net loss, and the
one genuinely high-impact fix (an O(n²) dedupe) was ranked 5th of 9. Fixing the docs' stale file-size
claims afterward (user follow-up: "Fix it now") led to finding the *same* wrong number in the prompt
template used to commission this exact kind of external review — a plausible root cause for why the
review was shaped the way it was.

## The perf work (`js/engine.js`, PR #279 → `preview`, squash-merged `57ea50f`)

Verified all 7 of the review's numbered claims against the code (line numbers, call sites, actual array
contents) before acting on any of them — see `decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md` for
the full per-claim table. User approved rollout tier "A1, then A2."

**Taken, and why the ranking mattered:**
- The Set-based dedupe in `_replay()` (review's item 5, ranked 5th) turned a per-element full-array
  rescan (`O(n²)`) into `[...new Set(arr)]` (`O(n)`). Measured: `foldBuild()` on a 2000-event log went
  **6.48 ms → 0.44 ms (~14.6×)**, and stopped being quadratic in log length — the actual bottleneck the
  review never identified as such.
- Consolidating the duplicate `activeEvents()` pass (review's item 2) — `foldBuild()`/
  `rebuildStateFromEvents()` each independently re-derived the same event snapshot via `_replay()` and
  `economy()`. Shipped as a **private** `_economyFrom()` core rather than the review's suggested public
  `economy(events, pre)` second parameter, because `economy()` is bridged into all three tools in
  single-argument form and `AGENTS.md` requires the engine's public API stay stable — same win, zero
  public-surface change (verified by diffing the export list before/after).
- Set-based membership tests for `unlockedClasses`/`racialTraits`/`skillList` (review's item 3) — small,
  safe, no order change since the underlying arrays are untouched.

**Rejected on measurement, not judgment call:**
- `structuredClone` (the review's **#1**-ranked item) is 1.9–3.1× *slower* than the existing JSON
  round-trip for every shape this engine actually clones (a tiny `weaponProf` map, one snapshot field at
  a time) — it's a host-boundary call whose fixed setup cost dominates on small payloads. Implementing it
  measurably cost ~20% on `rebuildStateFromEvents()` before being reverted. `clone()` now carries an
  inline comment recording the benchmark specifically so a future pass doesn't "modernize" it back in.
- Caching `DATA.*` sub-tables as locals (review's item 7) measured as a **negative** delta (V8's inline
  caches already make repeated monomorphic property reads free) — not worth touching dozens of lines in
  the highest-risk function in the repo for an unmeasurable win.
- Async Web Crypto signing (review's item 6) was rejected outright: `_sha256hex`'s own comment states the
  synchronous implementation exists specifically for `file://` compatibility (no secure-context/
  SubtleCrypto requirement), and the async form would be a breaking API change on top of contradicting
  that.

**Verification, in increasing order of confidence:** `engine-parity-ci.mjs` 20/0 → `log-fuzz` clean at
10k iterations → a purpose-built differential test comparing the pre-change and post-change engines
side-by-side over the real fixtures plus 4000 randomly generated LOGs (20,021 checks, 0 mismatches) →
before merging, an independent adversarial review (a `general-purpose` agent standing in for
`/code-review ultra`, which wasn't invokable as a skill in this session) that traced every write site for
the three Set-backed fields, confirmed `_replay`'s two callers previously discarded its return value
entirely, and ran its *own* 900-log A/B comparison. No findings survived. `DATA.version`/`BUILD`
deliberately not bumped — no mechanics or user-visible change.

## The stale-size docs fix (same PR)

While investigating claim 1, `Explore` flagged that `js/engine.js`'s header comment and `AGENTS.md`'s
read-budget section both said "~237/238 KB" for a file that measured at ~66 KB. User said "Fix it now."
Checking further, **every** figure in that `AGENTS.md` section was stale (not just the one flagged): the
actual big file, `js/engine-data.js` (~189 KB on ~13 lines, split out by REV-14a), wasn't in the list at
all; the Player's Guide was understated by more than half; tool sizes were off by up to 2.5×. Root cause:
the number predated the REV-14a split and never got re-attached to the file it actually described.

The part worth a session note on its own: `docs/AI_review_prompt.md` — the live template this project
uses to commission exactly this kind of external `engine.js` review — carried the same wrong number,
framed as "~237 KB (mostly a large DATA blob)". The Copilot review behind this whole session was almost
certainly produced from that template, and its recommendations are consistent with believing the file
was large and data-heavy: leading with allocation/GC micro-optimizations, ranking the one real
algorithmic defect 5th. A reviewer with no repo access can only reason from what the prompt tells it — so
the prompt now also states that `compute()` costs ~0.02 ms over per-character arrays, which is the fact
that would have pointed the review at the right place from the start. This is why claim-by-claim
verification (rather than a straight implement-and-ship) was the right call here: not a hypothetical
caution, but the actual mechanism that produced a misleading review in this session.

Historical mentions of the old "~237/238 KB" figure elsewhere (`decisions/2026/D-009.md`, the
PWA-migration decision record, `docs/sessions/*`, the changelog archive) were deliberately left alone —
those numbers were correct at the time they were written; rewriting them would falsify the historical
record rather than fix a live-guidance bug.

## Outcome

PR #279 merged into `preview` (squash `57ea50f`) — two commits' worth of work (perf + docs) shipped as
one squash commit. `preview` is now 1 commit ahead of `main` (this one), queued for a future promotion
decision. No task-board item was involved (this session was sourced from a pasted file, not the board),
so nothing to graduate. Full decision record: `decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md`.
