# 2026-07-11 — CharGen campaign-rules awareness (sign-in, live filter, code-review fixes)

`/pick-task` → `/run-task feat/chargen-campaign-rules`. NOW was empty, so the top NEXT item was picked:
extend CharGen's module bridge to import `validate()`, add sign-in + campaign selection, and live-filter
banned species/origin classes/masteries/boons out of CharGen's pickers. PR
[#151](https://github.com/Chompy78/PACT/pull/151).

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
mishandles event-log-format fixtures) after every one of the 3 commits, and again after each rebase:
**20/0** throughout, including after the `js/engine.js` addition. Headless-browser checks (not just the
test suite) confirmed: CharGen boots fully with the Supabase CDN blocked; a mocked signed-in campaign with
banned rules correctly filters species/origin-class/mastery/boon pickers; a character owning a
now-banned choice survives loading unmodified; sign-out is correctly detected after the parameter-mismatch
fix. PR #151 is open, `mergeable_state: clean`, not yet merged as of session end.
