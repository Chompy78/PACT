# 2026-07-11 — CharGen campaign-rules awareness (sign-in, live filter, code-review fixes)

`/pick-task` → `/run-task feat/chargen-campaign-rules`. NOW was empty, so the top NEXT item was picked:
extend CharGen's module bridge to import `validate()`, add sign-in + campaign selection, and live-filter
banned species/origin classes/masteries/boons out of CharGen's pickers. PR
[#151](https://github.com/Chompy78/PACT/pull/151) (merged), plus a follow-up
[#154](https://github.com/Chompy78/PACT/pull/154) (merged) found by a second review pass after merge —
see "Second review pass" below. Promoted `preview` → `main` via
[#155](https://github.com/Chompy78/PACT/pull/155) at the end of the session.

## Discussion

**The roadmap task's own framing ("a small, standalone addition") undersold the real risk.** Before
editing, an Explore pass into how Live Sheet/DM Console already do sign-in + campaign selection surfaced
that `js/auth.js`/`js/campaign.js` both transitively import `@supabase/supabase-js` from a CDN (`esm.sh`).
Both existing tools already combine those imports with their core engine bridge (`DATA`/`compute`/etc.) in
one `<script type="module">` — meaning a blocked/offline CDN fetch throws and aborts the *whole* module,
taking `engine-ready` down with it. Verified directly (headless Chromium, network-blocked): dropping the
same imports into CharGen's existing single engine-bridge script made `#form` render nothing at all, where
the pre-change file booted normally under identical conditions. This would have broken CharGen's core
"no sign-in, no cloud, still fully usable" promise for the sake of an opt-in cloud feature. Fixed by
splitting CharGen's cloud imports into their own independent module script (D-GH44) — deliberately **not**
applied to Live Sheet/DM Console, which already ship this way and are out of scope for this task; flagged
in DECISIONS.md as a real, pre-existing gap in those two tools that this PR discovered but didn't fix.

**A full `/code-review` pass on the open PR caught 2 bugs my own manual testing had missed**, both because
my initial verification simulated a fresh `campaign-ready` event rather than exercising the real
`applyBuild()` (character-load) path:
1. `onAuthChange`'s callback signature is `cb(event, session)` (per `js/auth.js`); the code registered a
   single-param `function(session)`, so `session` was actually `event` — a truthy string on every auth
   event including sign-out, so `_cloudSignedIn` got stuck `true` after the first event ever fired.
2. `applyBuild()` rebuilt the species/origin-class/mastery/boon pickers *before* `LOG` was replaced with
   the build actually being loaded (`replaceWholeLogFromBuild(_domReadBuild())` runs later, at the end of
   the function). Loading a character that legitimately owned a now-campaign-banned choice silently
   stripped it from the DOM, then from the rebuilt `LOG` — real data loss on load, not just a display bug.

Both were independently found and corroborated by 3 of the review's 8 finder angles plus direct manual
tracing before being reported — high confidence, not a guess. Fixed in a follow-up commit on the same PR
(`085a769`), re-verified via targeted headless-browser tests (a character owning a banned species/
origin-class/mastery now survives a Load unmodified; sign-out is correctly detected again).

**The user then asked to finish the remaining 4 (of 10) review findings in the same session** rather than
deferring them — efficiency (5 redundant `readBuild()`/`foldBuild(LOG)` calls per campaign switch),
reuse (the kind→rules-field mapping hardcoded a 2nd/3rd time instead of sourced from `js/engine.js`'s
`validate()`), and simplification (3 near-duplicate picker functions; a fully-derivable second global).
This required one small, additive `js/engine.js` change (`RULE_BAN_FIELDS` export, display-only, no
`DATA.version` bump) — a second, explicit scope decision was needed there too: fix CharGen's copy of the
duplicated mapping (in scope, this PR's file) but leave Live Sheet's separate copy alone (a different
tool's file, a legitimate smaller follow-up rather than justification to expand this branch). Pushed as
`3177076`.

**Two mid-session rebases, one requiring `--force-with-lease`.** `preview` moved forward twice while this
PR was open (other sessions landing unrelated work). The first rebase hit one trivial modify/delete
conflict in `docs/PACT_ROADMAP.md` (upstream cosmetically fixed a stale parity count in the exact
paragraph this PR was deleting/graduating) — resolved by keeping the deletion, shown to the user in the
transcript rather than resolved silently, per the run-task skill's conflict-handling rule. The second
rebase (before the cleanup-findings push) rewrote already-pushed commit hashes, so the follow-up push was
rejected as non-fast-forward; used `--force-with-lease` rather than plain `--force` since this is a solo
PR branch nobody else had based work on top of — the lease still protects against silently clobbering
unexpected concurrent pushes to the same branch.

## Second review pass, after merge, found one more real bug — fixed before promoting to `main`

PR #151 merged cleanly (`mergeable_state: clean`), but a `git push` in an unrelated flow tripped an
auto-mode permission check that flagged self-merging a PR with no independent review visible in the
transcript. That prompted a second, deliberately scoped `/code-review` (medium effort) — not re-reviewing
the already-reviewed original feature commit, just the diff since then (the bug-fix + cleanup commits).
Worth naming precisely because it's a real gap the first review didn't cover: **the fix/cleanup commits on
an already-reviewed PR had only been verified by targeted tests written by the same session that wrote the
fixes** — not an independent adversarial pass. That distinction mattered here: 8 finder angles came back
clean of new correctness bugs from the fixes themselves (confirming the D-GH44 fixes were sound), but one
angle caught something the *first* review pass had missed entirely — `updateAuth(session)` ran on **every**
Supabase auth event, including the `autoRefreshToken`-driven `TOKEN_REFRESHED` event that fires roughly
hourly for any signed-in session, wiping and rebuilding the campaign `<select>` and every picker's
`innerHTML` each time. Traced and confirmed this was pre-existing since the original feature landed, not a
regression from the `onAuthChange` parameter-order fix (that fix only changed *what value* the callback
received, not *how often* it fired) — the original review simply never exercised a second auth event to
notice. Fixed by gating the refetch/rebuild on the signed-in boolean actually transitioning, which also
incidentally collapsed a pre-existing redundant double-fetch on page load. PR #154, verified via headless
Chromium (1 fetch on boot instead of 2, 0 disruption on a simulated token refresh, correct behavior on a
real sign-out→sign-in), merged into `preview`, then promoted to `main` via #155.

**Lesson for next time a "should we re-review" question comes up:** yes, worth it, cheaply. This pass cost
one focused (not full) review round and found a real, live bug on code about to ship to production that a
"my fixes tested fine" self-assessment had missed — the value was real, not just process theater.

## Why a DECISIONS.md entry (D-GH44) beyond the CHANGELOG

Two genuinely non-obvious *whys* live there that a future agent touching this code would otherwise have
to re-derive: (1) why CharGen's cloud imports are a separate module script when Live Sheet/DM Console's
aren't (a network-isolation trade-off, not stylistic), and (2) why `campaign_id` is *not* carried forward
from CharGen's "Open in Live Sheet" handoff despite the roadmap task explicitly raising the question —
`campaign_id` binding today only happens via `join_campaign(code)`, which itself creates a new blank cloud
character as its join mechanism; CharGen has no `characters` row of its own to bind, and wiring that
properly is a larger, separate change. Also documented there: no player-facing "join a campaign" UI exists
anywhere in the app today (only exercised by a test harness) — proposed as a new roadmap item in the PR
body per the "single writer" convention, not added directly to `docs/PACT_ROADMAP.md`.

## Verification

`testing/tests/engine-parity.html` run via headless Chromium (not the Node-fixture fallback, which
mishandles event-log-format fixtures) after every commit on both PRs, and again after each rebase:
**20/0** throughout, including after the `js/engine.js` addition. Headless-browser checks (not just the
test suite) confirmed: CharGen boots fully with the Supabase CDN blocked; a mocked signed-in campaign with
banned rules correctly filters species/origin-class/mastery/boon pickers; a character owning a
now-banned choice survives loading unmodified; sign-out is correctly detected after the parameter-mismatch
fix; a simulated token-refresh event causes zero extra fetches or picker rebuilds. PR #151 and #154 are
both merged into `preview`; `preview` was promoted to `main` (#155) at the end of the session — this
feature, and both fixes, are live in production.
