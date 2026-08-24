# 2026-08-24 — Full task-board sweep, a discovered bookkeeping gap, and a post-merge code-review cycle

One continuous session, fully unattended after a single batch-size question. Three arcs: (1) `/sweep-code-
tasks-jc` executed 6 mechanically-eligible task-board items; (2) closing out the sweep surfaced a real
gap — some of its own PRs had shipped without their required bookkeeping, and one PR believed merged
wasn't — both corrected live rather than left standing; (3) a post-merge `/code-review ultra` audit of the
sweep's riskiest change found real bugs, three of which got fixed in a follow-up PR, with two more
deliberately deferred and recorded rather than fixed reflexively.

## 1. The sweep — 6 tasks, "All 6"

`/sweep-code-tasks-jc` asked once for batch size (recommended 3; offered "All 6" and "1 — just the
safest one"); the answer was **All 6**, so everything after ran unattended per the skill's own design.
Read every open task's own body, not just its Effort/Risk tag, before queuing anything — this eliminated
11+ tasks that carried a low/medium tag but actually needed a design call, were self-scoped "not sweep-
eligible" in their own text, or spanned a project outside this repo (`pact-guide`'s own cap-wording
reconciliation).

Six genuinely eligible, executed ascending-risk:

| Task | PR | Effort/Risk |
|---|---|---|
| 7 CI gates never trigger on a `js/engine-data.js`-only change | #458 | low/low |
| Cache Chromium in browser CI jobs + install timeout | #459 | low/low |
| `guide-price-check.mjs` zero drawback-price coverage | #460 | low/low |
| Purge "pace curve" mislabel from 5 historical records | #461 | low/medium |
| Live Sheet drawback purchases bypass `legalCheck()` | #462 | medium/medium |
| Warn when `compute()` hits a retired DATA reference | #463 | medium/medium |

The last two needed real judgment, not just execution: #462's naive fix would have zeroed drawback cost
(the default whole-build-delta pricer is wrong for drawbacks, modeled as income since v0.354 — verified
against `engine.js`'s own "MODEL (b)" comment before wiring anything) and would have newly hard-blocked an
advisory-only cap warning through `legalCheck()`. #463's audit found 8 silent-skip sites in `compute()`,
one more than the task board's own named 3, with `subSpellBundles`' lookup needing care to avoid a false
positive (overloaded between "genuinely missing" and "legitimately sells no bundle").

## 2. Closing out the sweep surfaced its own gap

Writing the sweep-log entry required checking each of the 6 PRs' actual state on GitHub rather than
trusting the in-session record — and that check found two real problems, both corrected before the sweep
was called done:

- **PR #462 (`fix/livesheet-drawback-legalcheck`) was still open, not merged**, despite an in-progress
  record claiming it was. It had 6/6 green CI and a clean merge state, so it was merged as part of closing
  the sweep rather than re-executed.
- **PRs #458–460 had shipped without their `CHANGELOG.md` entry or task-board graduation** — a direct
  violation of `AGENTS.md`'s own per-change checklist step 5/7. Confirmed by diffing each PR's actual
  changed-files list (workflow YAML / `verify-guide.mjs` only — never `CHANGELOG.md` or the task board)
  rather than trusting the earlier claim that they were fully bookkept. Backfilled in a same-day follow-up,
  `docs/graduate-458-459-460-task-board` → **PR #464**.

Two more merge conflicts came out of the resulting PR sequencing (#463 landing after #462, then again
after #464, both on `CHANGELOG.md`'s newest-first insertion point) — resolved by merging `preview` into
each PR branch and re-verifying `engine-parity-ci.mjs`, never a rebase or force-push, per this repo's own
merge-conflict rule for a branch it created.

**Why this matters more than the individual fix:** the failure mode here wasn't a bad change, it was an
*unverified status claim surviving past where it should have been checked* — twice, in one sweep. The
sweep-log itself exists specifically to be "the only place a pattern of repeated parks/drops... leaves a
trace" (its own header), so treating "write the sweep-log" as a live verification step rather than a
transcription step is what caught both gaps here.

## 3. Post-merge `/code-review ultra` — 3 fixed, 2 deliberately deferred

Once the sweep was closed, a `/code-review ultra` audit ran against the merged state (its riskiest change
— #463's 8-site engine warning + the earlier session's own XSS-hardening pass on the same code). Four
finder agents ran; every proposed finding was verified against live code and live `DATA` before acting —
two didn't survive verification and were dropped (a "no shared helper" complaint, already a deliberate,
documented decision in #463's own record; an "inconsistent label formatting" claim, refuted once live
`DATA` samples showed each site's extraction logic correctly matches its own key shape — flat keys for
arts/boons/drawbacks vs. `"Race: Name"` keys for traits/features vs. `|`-delimited compound keys for
subAbilities/subSpellBundles).

Three survived and shipped in a follow-up PR (#465):

- **Both tools' advisory-warning classifiers** (`isAdvisory()` in CharGen, `_lsIsAdvisory()` in Live
  Sheet) were never updated for the new "is no longer in the rules data" notice. It rendered as an urgent
  ⚠ hard issue with a dead "jump to control" click target (`warnTarget()` has no matching case) and
  inflated the top-level issue banner — directly contradicting the message's own "no cost/effect applied"
  wording. Fixed both; verified with two new regression tests confirmed to fail red against the reverted
  fix first.
- **Test coverage gap** — only 2 of the 8 new warning sites had fixtures. Added CG-039 through CG-044, one
  per remaining site, each value computed directly via `compute()`.

Two more findings were real but **verified not currently reachable**: `subAbilities`'/`subSpellBundles`'
label-derivation logic can theoretically drop or misname a stale reference if `DATA` ever gains a name
collision (checked live: 0 collisions exist today across 192 entries), and Live Sheet's `SOFT_WARN` regex
doesn't cover the new message text (checked live: `legalCheck()`'s dedupe-by-exact-string logic means this
only matters if a single `buy()` call's own payload is itself the stale reference — no live UI dropdown
can supply one). Recorded in full in the decision record rather than fixed reflexively, since fixing
either means a judgment call — a label-derivation contract change, or LOG-injection hardening — outside
this pass's mechanical scope.

**A small process note from writing this session's own close-out:** re-reading `DECISIONS.md` during
close-session verification caught a real formatting defect from the #465 edit — the new entry had landed
above the `## Index` header instead of below it, out of place relative to every other entry. Fixed
directly (PR #466) rather than left standing, on the same principle as §2 above: checking a file's actual
state, even one written earlier in the same session, is cheaper than trusting the record.

## Branch cleanup

`/cleanup-branches-universal-jc` ran separately (user-approved "all") and removed 14 stale local branches
— all either fully merged (12) or an abandoned local-only ref with 0 unique commits (`docs/sweep-log-2026-
08-24`, superseded when the sweep-log entry was committed directly to `preview` instead per that file's
own documented convention). Two more branches from this close-out itself (`fix/missing-data-ref-warning-
classification`, `docs/decisions-index-ordering-fix`) are now also fully merged and stray — left for the
next cleanup pass, per that skill's own scope (report, not delete, from inside a different skill).

## What's outstanding

- Nothing from this session is unshipped. The 2 deferred code-review findings (§3) are recorded, not
  task-boarded separately — each needs a judgment call this pass wasn't scoped to make, not a mechanical
  fix a future sweep could pick up blind.
- The 2 newly-stray branches noted above are safe-to-delete candidates for the next `/cleanup-branches-
  universal-jc` run.
