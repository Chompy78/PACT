# 2026-07-29 — `/make-code-cold-plan-review` hardening (PR #276) + archive-feature bug discovered via background `/code-review`

## What happened

Started as a scoped skill-improvement request (research cross-model plan review, strengthen
`/make-code-cold-plan-review`), grew a second round of fixes when the user's own local `/code-review`
found gaps in the first change, then — while that `/code-review` run's background finder agents kept
reporting in — surfaced an unrelated, already-shipped production correctness bug in the archive feature
(2026-07-25), which got filed as its own high-risk task-board item rather than folded into this session's
work.

## `/make-code-cold-plan-review` hardening (PR #276, `claude/custom-skills-commands-v3oae2` → `preview`)

Researched how cross-AI plan/code review is done elsewhere (cross-vendor blind spots, "try to refute" vs.
"check this over" framing, weighting cross-family consensus over same-family repeats, the "don't let it
grade its own homework" self-triage bias) and, after the user picked all four proposed options (A1/B1/C1/D1
via `AskUserQuestion`), applied them to the skill:
- Step 4 now tells the user to prefer a reviewer from a different vendor family than the plan's author.
- The generated "Reviewer instructions" reframe from "check this over" to actively **refute** the plan, with
  per-finding severity (blocking/moderate/minor) and confidence (high/low) tags.
- The "Review outcome" stub is now a structured table (finding, severity, confidence, raised-by,
  cross-family agreement, disposition) instead of free text.
- Step 7's triage routes `blocking`/disputed findings through a fresh, context-free `Agent` call before the
  drafting session decides.

Logged as `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md` + a `CHANGELOG.md` entry, committed
(`0c3d2cf`), pushed, PR #276 opened against `preview`.

### Follow-up round — `/code-review` found two gaps in the above (same PR)

The user ran `/code-review` locally against the PR diff. Two real findings came back:
1. **Step 7 triage gap** — no defined next step for a `blocking`-severity finding that reviewers agreed
   on and that hit none of the four stop-and-ask triggers; separately, "reviewers disagreeing with each
   other" was ambiguous about whether it was an unconditional stop-trigger or only one the new
   disinterested-agent pass could clear.
2. **`docs/SKILLS.md` drift** — the project's stated human-readable authority on what each skill does
   (`docs/SKILLS.md`'s own header) wasn't updated alongside the skill-file change.

Fixed both: `blocking` findings now always return to the user for the final call even after the agent pass
confirms them; unresolved disagreement is now an unconditional stop, while a *resolved* non-blocking
disagreement can be applied directly. `docs/SKILLS.md`'s cold-review-loop walkthrough and skill-reference
bullet updated to match. Logged as an addendum in the same decision record (not a new `D-GH` — a same-day
correction, not a new design choice), plus a second `CHANGELOG.md` entry. Committed (`fda3898`), pushed.

## Archive-feature bug discovered via the same `/code-review` run's background agents

While the fix above was in flight, the same local `/code-review` invocation's 8 finder agents (it was
scoped to the 10-commit diff between `preview`'s prior tip and the user's local checkout, which turned out
to already include the 2026-07-25 archive-feature commits merged into both `preview` and `main`) reported
in one by one as background task notifications — each one explicitly flagged as *not* user input per the
harness's own notification framing, so nothing was actioned until the user responded directly. Across
7-8 agents (~22 findings total), the dominant, independently-confirmed story: **`js/sync.js`'s
`listCharacters()` — still called by CharGen's and Live Sheet's own "Load saved character" cloud-load
menus — never selects `archived_at`, only the newer `listMyCharacters()` does**, so archiving a character
from the new "My Characters" page doesn't stop it from loading normally in the two tools where characters
are actually played. A secondary, weaker finding: archiving a campaign doesn't revoke its `join_campaign()`/
`redeem_player_invite()` invite codes.

Confirmed via `git log`/`git merge-base` that this is **already live in production** (`main`), not sitting
in an open PR — so it needed the normal capture-then-fix workflow, not an ad-hoc patch mid-session. Given
the user's A1/B1 picks, filed as a `docs/TASK_BOARD_NOW.md` task (`fix/archive-filter-parity`,
`Risk: high` — damage scale and likelihood both high since it touches live user data with no automated
gate; not `/sweep-code-tasks`-eligible), committed directly to `preview` (`5d96c96`) per this skill's
single-writer convention. Scoped to the root-cause fix (generalize `listCharacters()`/`listMyCharacters()`,
propagate the archived-campaign filter into `js/campaign.js`'s `listMyCampaigns()` so CharGen's own picker
inherits it, fix the archive/unarchive silent-fail row-count gap, escape the unescaped campaign `id` in
`DM-Console.html`); explicitly left the invite-code gap and several smaller duplication/efficiency findings
as separate future task-board items rather than growing this one task's scope.

## Why this note exists

Two of the five session-note trigger criteria: the plan changed mid-session (a scoped skill-improvement
task grew a same-day follow-up fix round once `/code-review` found real gaps in it), and the session
surfaced a decision a future agent could reasonably second-guess (scoping the archive-bug fix to the
root cause only, deferring the invite-code gap and smaller findings rather than bundling everything the
review pass found into one task).

## Follow-ups

- PR #276 (`claude/custom-skills-commands-v3oae2` → `preview`) — open, both fix commits pushed, ready for
  review/merge.
- `docs/TASK_BOARD_NOW.md`'s `fix/archive-filter-parity` task — open, not yet started (`/pick-code-task` →
  `/run-code-task` whenever ready).
- Deferred, not yet filed as their own task-board items: the campaign-invite-code-doesn't-revoke gap,
  `tools/characters.html`'s offline-gate inconsistency, `deleteCharacter()`/`replayDelete()` silently
  swallowing server errors, and assorted duplication/efficiency findings (`?cloudChar=` handler duplication,
  theme-boot-script duplication across `characters.html`/`DM-Console.html`, `js/campaign.js`'s
  `archiveCampaign`/`unarchiveCampaign` mirror-image duplication) from the same `/code-review` run.
