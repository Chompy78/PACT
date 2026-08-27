# D-GH-2026-08-25-dm-console-warnings-race-flake — a "flake" verdict on `dm-console-ui-e2e.mjs` was wrong; root-caused and fixed the real race

## Context
`dm-console-ui` failed once in CI on PR #469 (the `preview` → `main` promotion), with 5 assertion
failures all pointing at the same symptom: the campaign-warnings-banner check block returned `[]` where
3 warning lines were expected. The PR's own diff at that point was a one-line `TOOL_VERSION` string bump
— nothing that could plausibly touch invite-warning logic. Re-ran the exact same commit content locally
(96/96, twice) and via a CI job re-run (passed) before concluding "CI flake, not a real regression" and
proceeding to merge PR #469.

**That conclusion needed re-checking, not just accepting.** `CHANGELOG.md` already documents a directly
analogous prior incident (2026-08-22, PR #447): the *exact same test file's* invite-warnings-banner
checks failed twice in CI while passing 96/96 locally on the same commit — and that one was **not** a
flake, it was a genuine stale-campaign-switch-response race, fixed with a `_isCurrentCamp(id)` guard.
Given that precedent, "passes locally" is specifically *weak* evidence for this test file — noticed only
while writing this session's close-out log, after PR #469 had already been merged.

## Decision
**Traced the actual code path rather than re-running until green a second time.** Read
`selectCampaign()` → `loadInvites()` in `tools/DM-Console.html` directly:

- `selectCampaign(id)` fire-and-forgets `loadInvites()` (not awaited) as part of selecting a campaign.
- `loadInvites()` calls the REAL, unstubbed `B.listCampaignInvites(forCampId)` — confirmed by grep that
  `testing/scripts/dm-console-ui-e2e.mjs` never stubs `window._campBridge.listCampaignInvites` anywhere,
  unlike the RPC spies used elsewhere in the same file for write-path checks.
- The file's own header comment explains why an unstubbed, failing network call is normally harmless
  here ("No stack needed... only network calls fail, which is irrelevant to wiring and arithmetic") —
  true for every other check in the file, which only inspect synchronous UI state.
- **The campaign-warnings-banner block (the one that failed) is the one place that assumption is false.**
  `loadInvites()` unconditionally calls `renderCampWarnings()` at the end of BOTH its success and error
  path (`tools/DM-Console.html`, right after the try/catch). The test block selects `'live-1'`
  (triggering that real, fire-and-forget `loadInvites()`), waits a fixed 60ms, then calls the test's own
  `seedInvites([...])` to directly set `_invites` and assert on the resulting banner. If the real network
  round-trip (an unauthenticated call against the live Supabase project — the actual source of the
  400/401 console errors visible in the failing CI log) takes longer than 60ms to settle, it lands
  *after* the test's `seedInvites()` calls, and its error handler (`_invites = []`) plus its trailing
  unconditional `renderCampWarnings()` silently overwrites the test's synthetic data and wipes the
  banner — producing exactly the observed `[]` result, on all 5 failing assertions at once.

**Confirmed by elimination, not just theory:** the same file calls `P.select('live-1')` twice more
(peek-mode checks) with no failure in either CI run — both of those blocks only read state
`selectCampaign()` itself sets synchronously (lock booleans, `peekCamp`), never anything populated by
the async `_invites` fetch, so they were never exposed to this race regardless of timing.

**Fix:** stub `window._campBridge.listCampaignInvites` to resolve immediately (`() => Promise.resolve([])`)
for the duration of the warnings-banner block only, restoring the real function afterward. This removes
the non-deterministic real network call from the race entirely, rather than guessing at a longer fixed
delay — consistent with this same file's own established rule, written into a different check's history
in this file: *"waiting on a condition beats sleeping on a guess even when the guess is currently
harmless."* Verified: 96/96 passing on 3 consecutive local runs after the fix (a single pass is exactly
what this whole investigation started by distrusting).

## Why
**Why this wasn't caught before merging PR #469.** The session's own flake-verification method (local
repro + one CI re-run) is this project's own documented standard practice for a suspected flake — and it
produced a clean, consistent "pass" every time it was tried. The gap wasn't in the verification method
executed; it was in stopping at "verified, not a regression" without cross-checking that conclusion
against this exact test file's own known history, which was sitting in `CHANGELOG.md` the whole time.
The lesson isn't "run it more times" (more local runs would have kept passing — the race's local/CI
timing skew is the whole reason it's called a race) — it's **when a project's own history already records
a real incident matching the current symptom, that's a search to run before trusting a fresh "probably a
flake" verdict, not after.**

**Why this rides in the next promotion rather than an emergency fix to `main` right now.** This is a
test-infrastructure-only change (`testing/scripts/dm-console-ui-e2e.mjs`) — no `tools/`, `js/`, or `sql/`
file is touched, so `main`'s shipped app code is unaffected by the bug this fixes; the race lives
entirely in how the test harness exercises that code, not in the code itself. `main` is not carrying a
live defect. Landing this into `preview` normally (branch, PR, merge) and letting it ride the next
promotion is proportionate; force-promoting a CI-only fix outside the normal cadence isn't warranted.

## Status
Fix written and locally verified (`testing/scripts/dm-console-ui-e2e.mjs`, 96/96 × 3 runs;
`engine-parity-ci.mjs` 65/0 and `tool-pricing-ci.mjs` 176/0 confirming no unrelated regression). Not yet
committed/branched/PR'd as of this record — proposed at session close for the user's go-ahead, per this
skill's propose-then-approve default, rather than pushed unilaterally.
