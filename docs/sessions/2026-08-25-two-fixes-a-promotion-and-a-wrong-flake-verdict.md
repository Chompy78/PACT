# 2026-08-25 — Two NEXT-board fixes, a promotion to `main`, and a wrong "flake" verdict caught while closing out

One continuous session. Four arcs: (1) picking the next actionable NEXT-board task, skipping three that
weren't genuinely ready; (2) shipping the archived-campaign RPC/RLS lockdown, cold-reviewed and applied
directly to production; (3) shipping the password-reset fix, with `/code-review ultra` catching a real
timing bug before merge; (4) promoting `preview` → `main`, where a CI failure was called a flake, merged
anyway, and then — while writing this very close-out — turned out to need a second, more careful look.

## 1. Picking a task — three skips before landing on one

The board's topmost item, REV-14b (splitting `compute()` into named sub-pricers), had a cold-reviewed
plan from 2026-07-17 — but `compute()` had grown from the plan's assumed ~370 lines to ~638 since then
(the whole file from ~930 lines to 2080), so the plan's own pre-flight step would need redoing from
scratch. Flagged that staleness explicitly rather than starting on a plan that no longer matched the
code; skipped on request.

The next two were structurally not ready, not just risky: the signed-out invite banner fix is explicitly
blocked on `feat/invite-rate-limiting`, which is itself still an open TODO further down the same board —
not actionable regardless of risk appetite. The DM per-player character-limit task carries its own
explicit "get this design reviewed before implementing" gate with no existing plan document — same shape
as REV-14b, just without a stale plan to point at.

Landed on the password-reset fix: unblocked, already root-caused into two named defects, medium/medium.

## 2. Archived-campaign write lockdown (PR #468, part 1)

"Archived campaign is read-only" was a client-side-only convention (`tools/DM-Console.html`'s
`_dmPeekActive` guards) with no RLS/RPC backing. This task already had a 5-reviewer cold review from
2026-08-23 recorded in `docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-review.md` — the
plan itself was current (unlike REV-14b's), so no re-planning was needed, just implementation.

One mistake caught before it shipped: the first draft of `dm_edit_character_log`'s migration body was
reconstructed from memory rather than copied from the actual source in `sql/rls-policies.sql`, and it
diverged — wrong variable names, wrong FIFO-matching logic. Caught with a plain `diff` against the real
function *before* applying anything, not after. Every other touched function was diffed the same way
afterward as a blanket check; all four were byte-identical except the one added line each.

Applied directly to the production Supabase project (no branching capability on this project, and this
repo's own migration workflow is direct-apply). Verified with a fixture-based role/state matrix run as
the real `authenticated` Postgres role (not the MCP tool's default elevated context, which bypasses RLS
and would have proven nothing) — all seven write paths confirmed to reject while archived and restore
after unarchiving; negative-authority-ordering, positive-still-readable, and cross-campaign-isolation
controls all held. Test fixtures cleaned up after, confirmed zero rows remain.

## 3. Password-reset fix, `/code-review ultra`'s one real finding (PR #468, part 2)

Two defects: `forgotPassword()` redirected to the homepage (no recovery handling at all), and even a
correct redirect would have landed nowhere — `updatePassword()` existed but nothing called it. Read the
actual vendored `supabase-js` source rather than assuming library behavior from memory, to get the
`type=recovery` vs `error=` URL-fragment detection right, and to confirm the default `flowType` this
project's client actually uses (`implicit`, confirmed in the vendored file — not assumed).

`/code-review ultra`, run at the user's explicit request after the PR was opened, found one real bug: the
recovery-detection timeout unsubscribed from the auth listener before showing the "expired" fallback, so
a `PASSWORD_RECOVERY` event arriving even slightly late (a visitor with another PACT tab open —
supabase-js serializes auth work across tabs via a lock — or just a slow connection) would permanently
mislabel a perfectly valid link as expired. Fixed by not unsubscribing on timeout, so a late event still
overrides the fallback. PR #468 merged clean after that fix.

**Left explicitly unverified, not silently assumed:** the real end-to-end path with a live recovery
email, and the Supabase dashboard's Auth → URL Configuration → Redirect URLs allow-list entry needed for
it to work in production — the second is a setting no available tool exposes; confirmed via two separate
tool searches before reporting it as genuinely out of reach, then handed to the user, who did it manually
mid-session.

## 4. Promoting `preview` → `main` (PR #469) — and a flake verdict that needed a second look

Followed `docs/VERSION-SYNC.md`'s promotion procedure exactly: opened the promotion PR first to get its
number, bumped `BUILD` to `v1.469` (major carried forward from `v1.446`) across all four mirror sites in
a follow-up commit to that same PR, left `DATA.version`/`index.html` untouched, merged with a regular
merge commit (never squash — the file's own documented reason: squashing a promotion severs shared
history and breaks the *next* promotion's 3-way merge).

`dm-console-ui` failed once in CI with 5 assertions all resolving to the same empty-array symptom. The
PR's only code change at that point was a one-line `TOOL_VERSION` string bump — nothing that could touch
invite-warning logic. Reproduced the exact same commit content locally (96/96, twice), re-ran the CI job
once (passed), and called it a flake — a conclusion that matched this project's own documented
flake-handling process to the letter. Merged.

**That conclusion was wrong to stop at, not wrong to reach.** Writing this close-out session note meant
re-reading `CHANGELOG.md`, which already records a directly analogous incident from 2026-08-22 (PR
#447) — the *same test file's* invite-warnings-banner checks failing in CI while passing locally on the
same commit, and that one was a genuine race, not a flake. Re-investigated properly this time: traced
`selectCampaign()` → `loadInvites()` in the actual `tools/DM-Console.html` source. `loadInvites()` calls
the real, unstubbed `listCampaignInvites()` against live Supabase (the source of the 400/401s visible in
the failing log) and unconditionally calls `renderCampWarnings()` on both its success and error path. The
failing test block selects a campaign (triggering that real fire-and-forget call), waits a fixed 60ms,
then injects synthetic invite data and asserts on the banner — and if the real network round-trip
outlasts that 60ms guess under CI's timing, its error handler silently overwrites the test's synthetic
data right as the assertion runs. Confirmed by elimination: the same file calls `P.select('live-1')`
twice more elsewhere, both passing reliably in both runs, and both only touch state `selectCampaign()`
sets synchronously — never anything populated by the async fetch this race depends on.

Fixed by stubbing `listCampaignInvites` for that one check block, removing the non-determinism instead of
guessing a longer timeout — the same rule this exact file already states elsewhere in its own history
("waiting on a condition beats sleeping on a guess even when the guess is currently harmless"). 96/96 on
3 consecutive local runs after the fix. Full record: `D-GH-2026-08-25-dm-console-warnings-race-flake`.

**Why this is worth naming as its own lesson, not just a bug fix:** the gap wasn't in the verification
method — local repro plus one CI re-run is this project's own standard, and it produced a clean result
every time it was tried. The gap was stopping at "verified, not a regression" without checking that
conclusion against this exact test file's own recorded history, which was sitting in `CHANGELOG.md` the
entire time. Logged as a lesson (`/log-lesson-universal-jc`) rather than left as a one-off: *when a
project's own history already records a real incident matching the current symptom, that's a search to
run before trusting a fresh "probably a flake" verdict, not after.*

## What's outstanding

- The `dm-console-ui-e2e.mjs` race fix is written and verified but **not yet committed** — proposed for
  approval in this close-out's Part 3, per this skill's propose-then-approve default, rather than pushed
  unilaterally. Test-only change; `main` isn't carrying a live defect from it (the race lives in the test
  harness, not the shipped app), so it rides the next normal promotion once landed on `preview`.
- Tagging `v1.469` on the `main` promotion commit is a human-judgment call this session flagged but did
  not make — this promotion carries a real security fix and a real bug fix, which per
  `D-GH-2026-08-20-tag-only-meaningful-promotions` likely warrants a tag, but that decision and the tag
  push itself (blocked from this cloud session by a hard platform 403) are both left for the user.
