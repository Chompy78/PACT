# 2026-08-06 — review PR #364, reverse a design choice under its own logic, two promotions, then four independent bugs off the NOW board

Continuation of 2026-08-05's pricing-model work. Started by reviewing the four-fix batch PR (#364)
adversarially, ended up reversing one of its own design choices a few hours after making it, promoting
`preview` → `main` twice, and closing out four separate 🔴 NOW board items — one of which changed
machines mid-task and caught a real bug in its own test via CI rather than locally.

## Reviewing PR #364 found real bugs in the fixes, not just nits

Two independent reviewers (correctness lens; regression/cross-tool-consistency lens) plus a direct read
of the diff turned up three genuine defects, all fixed before merge:

- `buy()` was storing the **unfiltered** `warns` array on an epic-boon purchase event. The history ledger
  paints any row carrying `warns` red forever — so buying an epic boon would have looked like a
  permanent rules violation, including after the player picked the ability, and `warns` travels inside
  the saved envelope.
- The buy panel (`ib()`) had no knowledge of the new `EXPECTED_FOLLOWUP` class, so all 12 epic-boon tiles
  stayed amber "warning" styled while clicking them bought cleanly.
- The drawback-itemisation loop had no unknown-value guard, unlike its five sibling itemised lines — a
  retired drawback rendered a phantom `<name> 0` row.

All three were confirmed **red** against a deliberately reverted guard before being trusted, matching
this session's standing practice.

## The maneuver pricing escape got reversed a few hours after being written

PR #364 shipped `buyManeuver()` routed through `buy()`'s affordability gate, with a new
`_UNCHARGED_PRICERS` table (`mvbuy`) alongside the existing `_CTX_PRICERS`. That table directly
contradicted an **Active** decision — `D-GH-2026-08-05-pricing-model` D1 says the three existing escapes
are "retired into that rule rather than joined by a fourth" — something I flagged in the PR body itself
as an open question rather than merging past it silently.

Owner said `compute() prices maneuverBuys`. That turned out better than the minimal fix: once `compute()`
prices the purchase, `priceOf()`'s ordinary whole-build diff returns the correct rung **on its own**
(verified: deltas 4, 5, 6, 7), so `_UNCHARGED_PRICERS` wasn't just relocated — it was **deleted**. The
fourth escape D1 warned against is genuinely gone, not merely better-organised. `DATA.version` bumped
(v0.339 → v0.340) since this changes `compute()` output; affordable specifically because the app is
pre-launch with no real characters to protect (D-GH37) — a `compute()` bump that increases a previously-
uncharged total can't retroactively cost anyone anything they'd already spent.

Wrote a second decision record, `D-GH-2026-08-06-reprice-preserves-uncharged-costs`, and marked the
first one (`maneuver-afford-gate`) **Superseded in part** rather than leaving two records disagreeing —
its *Outstanding* section (the `repriceDraft()` refund bug) is closed by the same change.

A latent bug caught along the way: no fixture anywhere carried `maneuverBuys`, so the entire pricing
category had zero test coverage while the suite reported green — the same blind spot that had earlier
hidden the Grit and Vigor ladders (2026-08-05). `EV-016` closes it.

## Version sync: found a 30-version drift the promotion checklist doesn't name

While tagging up for the v1.365 promotion, checked the claim "all tools now show v0.339" instead of
asserting it — and it was false. The Live Sheet's footer read `PACT v0.309` while `DATA.version` was
v0.339, thirty versions stale, and it's the *only* place that tool states a rules version at all (no
"PACT rules" chip like CharGen's). `docs/VERSION-SYNC.md`'s mirror list only names the `BUILD` sites, not
the rules-version ones — structurally why this drifted invisibly through however many promotions came
before it.

Fixed by wiring the footer to the `RULES` value `_lsBoot()` was *already* reading from `DATA.version`,
the same live-read pattern DM Console uses — one line of actual wiring. Filed the harder half
(`fix/chargen-rules-label-live`, CharGen's two labels are still hardcoded) rather than fixing it inline,
since its `<title>` mixes the BUILD axis (which `VERSION-SYNC.md` explicitly wants manual) with the
rules axis (which shouldn't be) and needed its own careful task, not a rushed fix under promotion
pressure.

## Two promotions, and confirmation the release-tag 403 is a standing, undocumented gap

Promoted `preview` → `main` twice this session (`v1.365`, then `v1.367` for the footer fix). Both times
followed `docs/VERSION-SYNC.md` literally: open the promotion PR first (so `BUILD`'s minor half is the
PR's own number), regular merge commit never squash, major carried forward unless told otherwise.

`git push origin v1.365` and `v1.367` both hard-403'd, confirming the doc's own note that tag pushes are
blocked from a cloud session. Checking the repo's actual tag list turned up something the session hadn't
been told: the newest tag on the repo was `v1.300` — meaning this has been silently un-done for several
releases in a row, not just this session's two. Solved with GitHub's `?target=<sha>` release-creation URL
trick (already `H-058` in `ai-lessons-learned`) rather than the Releases UI's Target dropdown, which
can't reach a commit that isn't a branch tip or existing tag — `v1.365`'s commit had already been
superseded on `main` by the time it needed tagging.

## The environment changed mid-session, and the fourth NOW-board fix exposed exactly why local mutation-testing matters

Partway through working the NOW board (epicBoonAbil round-trip loss, then a stored-XSS fix in CharGen's
house-rule names, then the maneuver-pricing engine change — three landed cleanly, each mutation-tested
locally before trusting the new gate assertion, same practice as every prior fix this session), the
session continued on a different machine. That machine has **no browser at all** — no Chromium installed,
apt's only candidate is a snap-wrapper package, and `sudo snap install` needs an interactive terminal
that isn't available non-interactively.

The fourth fix (`fix/buyoff-keyed-by-event` — a bought-off drawback could never be taken again, because
`activeEvents()` keyed cancellation by drawback *value* rather than by the specific purchase) was fully
correct and Node-verified on the engine side (direct execution against the task's own repro, a
common-case regression check, and the new fixture mutation-tested by reverting `js/engine.js` itself —
none of that needs a browser). But it also touched two Live Sheet UI call sites, and the new CDP-driven
gate assertions for those had to be written by tracing the real DOM-producing code by hand and pushed
**flagged as unexecuted** rather than silently claimed at the same verification bar as everything else.

CI's first real run of them failed both — and the cause was in the *test*, not the fix. `buyoffDrawback()`
has its own affordability gate (`cost=refund×3 > available` → silently refuse), and the test's only AP
income was the drawback's own +2 refund, well under the 6 AP a buy-off costs — so `buyoffDrawback()`
no-opped every single call, no `buyoff` event was ever appended, and the engine fix was never actually
exercised by either assertion. The failure numbers (`drawbackEarned:4` instead of `2`, a
supposedly-cancelled drawback still on the build) pointed straight at it once read carefully. Fixed by
funding the scenario with an `award` event; re-pushed; CI went green (60/0).

Worth keeping precisely because it's a positive result, not a near-miss: the "not executed locally" flag
existed to catch exactly this class of failure, and it worked as designed — a real gap surfaced by CI
instead of shipping as a silently-passing-but-untested assertion. The honest thing to do when a tool
genuinely isn't available is flag it and let the next real check catch what local testing would have,
not quietly lower the bar and call it the same.

## Design choice worth a second look later

The buyoff-keyed-by-event fix deliberately used plain FIFO-by-array-position matching instead of the task
board's own suggested `seq`-based targeting, because `js/engine.js` has no concept of `seq` at all (it's
tool-side bookkeeping; fixtures never carry one) — recorded in
`D-GH-2026-08-06-buyoff-keyed-by-event`. Worth another look only if a future case surfaces where FIFO's
"oldest open purchase" default genuinely isn't the right pick (e.g. two duplicate drawback purchases with
one buyoff) — not required by anything shipped so far.

## What's left on the NOW board

Four items remain: `fix/creation-lock-survives-reload` (needs a rules-shape answer), the
creation-vs-awarded-ap re-scope, campaign binding lost on refresh, and cloud saves being last-write-wins.
The last one specifically needs a signed-in browser session to verify meaningfully — likely a natural
stopping point for unattended work regardless of which machine picks it up next.
