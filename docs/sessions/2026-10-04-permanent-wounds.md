# 2026-10-04 — permanent wounds (imposed drawbacks, unlock, Wounds system)

## What we did
Started from "add a range of drawbacks that come from permanent wounds, balanced" and, through lettered owner decisions,
shipped four PRs into `preview`:
- **#562** `fix/imposed-drawbacks-grant-no-ap` — a DM-imposed drawback grants 0 AP in `compute()` (v0.366).
- **#563** `fix/missing-arm-penalty-undefined` — `Missing Arm` now states a real penalty (one hand free + disadvantage on physical checks).
- Earlier in the session: cap-bypass and DM-unlock (`dmUnlockDrawback`, migration already applied live).
- **#566** `feat/permanent-wounds` — DM-only Wounds: Maimed Hand, Bad Knee, Brittle Bones, Withered Arm (wound-only), `DATA.wounds`
  tier/place map, hard ⛔ for a non-imposed wound-only entry, soft same-place warning, grouped DM Console impose dropdown,
  Wounds section in the served guide and the `pact-guide` master, gates `wounds-ci` (39) and `wounds-ui-e2e` (25). v0.367.

## Decisions made
`D-GH-2026-10-04-permanent-wounds` (and the earlier 09-30 / 10-04 records). Judgement calls listed in that record: Afflictions
and Frail slotless, slot warning soft and imposed-only, wound-only non-imposed is a hard block, EV-025/026 changed, EV-022 now
expects one extra warning.

## Problems and how they were solved
- `/code-review high` found five real bugs in the first commit (slot warning fired on player-chosen pairs and would have hard-blocked
  a Live Sheet purchase; duplicates missed; held wound tile missing in Live Sheet; DM defaults overwritten; price label). All fixed
  with tests before merge.
- My first fix attempt matched the wrong `both injure the same place` (the header comment) and mangled `engine.js`; caught because the
  gate still passed the old expectation, reverted with `git checkout`, redone with a precise anchor. Lesson: anchor edits on the code
  line, and distrust a gate that does not change when the code should have changed it.
- The permission classifier blocked an agent-run `gh pr merge` ("Merge Without Review"); the user merged it themselves with `!`.
- A worktree-isolated session cannot run git against other worktrees, so cleanup was handed to the user as commands.
- Earlier: a redaction regex printed three stored API keys (see below).

## New tasks discovered
None new. `feat/server-enforced-drawback-lock` (already on the board) is what makes lock/unlock real; the lock is client-honoured until then.

## Blockers / open
- **Rotate the Gemini, Groq and OpenRouter keys** exposed in this session's transcript, then update
  `/data/projects/ai-templates/secrets/cold-review-api-keys.md` in place. Not done.
- Worktree/branch cleanup commands were given to the user (E1); not confirmed run.
- `preview` → `main` promotion is the owner's release call; not started.
- `pact-guide`'s vendored `py/vendor/engine/` still has the old Missing Arm text until that project's sync runs.

## Next session should start with
Confirm key rotation and cleanup, then pick the next NEXT item (candidate: `feat/server-enforced-drawback-lock`, which needs a cold
plan review first).
