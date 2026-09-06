# 2026-09-06 — basic mode: from a confused player's duplicate characters to a caught privilege escalation

**Decisions:** `D-GH-2026-09-05-player-basic-mode` (authority model, recorded the prior session) and, in
the separate `ai-templates` project, `D-2026-09-05-cold-review-api-skill` (the tooling that made part of
this session's review process possible) and `D-2026-09-05-track-record-relocation-check`. This note
covers the implementation half: the plan itself, its 9 review rounds, and what shipped.

## How it started

The prior session diagnosed a real support case — a player with two cloud characters both named
"Archer," one correctly built, one whose build points a DM had zeroed, with the *wrong* one bound to his
campaign — fixed by hand, then turned into a proper feature request: let a DM (or the player) restrict an
account to one active character, enforced so it can't be bypassed by calling the database directly. That
session also fixed an unrelated GitHub Pages outage (`main`'s Pages source had been cleared, likely a
side effect of a concurrent branch-cleanup) and renamed a mis-labeled character ("Character" → "Moss
Stormspud").

## The review process, and why it kept going past the point it looked "done"

The basic-mode plan went through five cold-review rounds in the prior session (two spawned Claude
sub-agents, then three real free-tier LLM APIs — Gemini, Groq, OpenRouter — once a genuine gap was found:
no existing skill actually *called* an API instead of asking a human to copy-paste into a chat UI. That
gap got closed properly instead of worked around: `cold-review-api-universal-jc`, a new permanent skill
in `ai-templates`, with real operational hardening earned the hard way this session — a harness safety
classifier blocking an inline API key (fixed by a write-to-file-then-read discipline, now a hard rule in
the skill), Gemini's model catalog drifting mid-session (`gemini-2.5-flash` retired for new users, model
auto-discovery added), and OpenRouter's free tier being a genuinely shared, contended pool (`z-ai/glm-5.2`
hard-429'd twice; automatic multi-model fallback added to the shared script). A companion fix went into
`close-session-logging-core.md`: the reviewer track-record scorecard (`data/cold-review-track-record.md`)
had been an unenforced instruction and was quietly not being populated — now cross-checked at session
close.

This session picked the plan back up for three more cold-review rounds (6-8, re-run through the properly
invoked skill rather than the ad-hoc script calls that tested it) before implementation started. Two of
those three found real, previously-unraised issues: a genuine correctness bug in the trigger design (an
`UPDATE OF archived_at` clause fires on any UPDATE naming that column, value unchanged or not — a routine
character edit could have wrongly tripped the count check) and a missing "Done when" item (no test for a
direct-database bypass, the actual core claim the feature rests on). Both got folded into the plan before
a line of SQL was written. By round 8 the marginal hit rate had dropped enough to say so in the plan
itself: "further rounds should wait for a genuinely new revision to review."

**That line turned out to be wrong**, and the correction is the most important part of this session.

## The bug nine rounds of cold review missed, and the round that caught it

Implementation went smoothly: the migration, the trigger, the two authority RPCs
(`set_basic_mode`/`unset_basic_mode`), the client-side error handling across three tools, all verified
locally against a real Postgres 16 instance (both `testing/sql/*.sql` harnesses green, full functional
coverage including the round-7 correctness guard exercised against a real two-character fixture), then
applied to production and PR'd (#531).

Running `/code-review ultra` on that PR — this project's own stated requirement for anything touching
`sql/`, not optional — found that `set_basic_mode()`/`unset_basic_mode()` checked `shares_campaign()`
for their authority, not a DM-specific check. `shares_campaign()` has four branches; only one means "I DM
a campaign this player plays in." The other three — including "we both play in the same campaign as
fellow players" — do not. **Any two ordinary players sharing a campaign could flag each other, or even
flag their own DM.** This was live in production for under a day before the catch (confirmed exploited
by nobody: `select count(*) from profiles where basic_mode is true` returned 0 both before and after the
fix).

Why nine rounds of text-only cold review, and a careful manual implementation, all missed this: everyone
— reviewers and implementer alike — reasoned about `shares_campaign()` by its name, which reads far more
specific than its actual four-branch body. The catch came from doing the one thing none of the cold
reviews *could* do: reading the real function source side by side with the decision record's exact
wording ("a DM sharing a campaign," not "shares a campaign"). Fixed same-day with a new
`is_dm_of_player()` helper mirroring `shares_campaign()`'s own first branch, applied to production
immediately, and a new test fixture added (an ordinary co-player who must be rejected) that fails against
the pre-fix code — closing the exact coverage gap the bug exploited. Two secondary findings from the same
review round (two invite-redemption paths that could leak a raw DB error instead of the friendly message,
and a misleading code comment) were fixed in the same pass.

## Closing it out

A live smoke test against production — three disposable accounts, the *real* invite-redemption flow, not
a shortcut RPC — verified all fourteen checks including the specific scenario the fix exists for (a real
campaign-sharing non-DM correctly rejected). All test data deleted afterward, verified zero leftovers.
Task graduated off `docs/TASK_BOARD_NEXT.md` in a small follow-up PR (#532).

## The lesson, stated plainly

A text-only cold review is real signal, and the round that mattered most in this whole process was a
"boring" one — an adversarial pass with the actual repository open, comparing a function's name against
its body. Neither substitutes for the other. Nine rounds of the first kind produced a stable, well-argued
plan; it took one round of the second kind to find the bug that plan's own stability had started to
paper over.
