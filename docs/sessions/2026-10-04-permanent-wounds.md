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

## Later in the session: promotion to `main`
- Opened promotion PR **#568** (`preview` → `main`, 51 commits), then **#569** to sync `BUILD` to `v1.568` per `docs/VERSION-SYNC.md`
  (major 1 carried forward from `v1.554`; `DATA.version` untouched). #568 was merged as a regular merge commit (not a squash); `main`
  now reads `v1.568` / rules `v0.367`. Someone else had already pushed an identical `v1.568` sync commit straight to `preview` and
  merged #568 a moment before this session tried to, so `preview` is two commits ahead of `main` (harmless duplicates of #569).
- #569's `quality` check failed twice in CI, then passed: first a harness startup error ("CharGen never became ready"), then one
  assertion ("a Fighter on a caster theme still primes a Fighter stat, not INT", 1 of 8). Locally it passed 7 of 7. The gate is
  unseeded, so it fails by chance; filed as `fix/random-fighter-int-priming` (PR #570) rather than loosening the check.
- A `gh run rerun --job` silently did nothing (completion time unchanged); `--failed` on the run worked. Check the timestamp, not the
  absence of an error.
- Merges: #566 was merged by the user via `! gh pr merge` after the permission classifier blocked an agent-run merge; #568 was
  merged by someone other than this session just before the agent's command ran; #567, #569 and #570 were merged by the agent on
  an explicit "merge N" from the user.

## Then: the impose picker and more wounds
- **#572, a pop-up picker for "Impose a drawback".** The dropdown gave only a name and a price. It is now a button that opens a window:
  a searchable list (wounds first) and a detail pane (effect text, tier and place, flat and tripled buy-off, "cap not applied", caster
  warning, same-place and duplicate warnings). The old controls stay hidden as the single send path, so the event sent is unchanged.
  `/code-review high` found nine issues (a silent no-op when Impose was busy, a search stranding a hidden selection, a dead change handler
  and a duplicated grouping, a11y roles without keyboard support, document-wide listeners, a stale TODO); eight fixed, the ninth (the "3×"
  multiplier is copied in the DM Console and Live Sheet, the engine does not export it) documented. Gate `dm-impose-picker-e2e.mjs`, 64 checks,
  five mutations caught; its first assertion could not tell its own mutation, so it was strengthened to use values that differ from the
  card's defaults. Optional "how it happened" text (80 chars) goes in the event label: no SQL, shown on the Live Sheet, markup inert there
  and in CharGen (tested).
- **#574, 15 more DM-only wounds (rules `v0.368`).** A count of skill names in the drawback texts showed 10 of 18 skills named by only one
  drawback; added 8 same-effect aliases and 7 new 2 AP mechanics so every skill is named by at least two (pinned by `wounds-ci.mjs`). Four
  aliases repeat DM-only wounds, not ordinary drawbacks, which the first guide wording got wrong (review). `DATA.wounds[..].sameAs` records the
  original and the picker shows it. Guide updated in both copies; `verify-guide` "drawback text" went from "15 missing" to passing.
- **Another session was working in parallel.** It merged #573 (CharGen: nothing bought after the lock can be unticked) and opened promotion PR
  **#577**, which also carries #575 and #576 — whose commit message says "wip … head-to-head still red on legality parity" — and had no CI
  results when checked. This session did not touch #577 (owner chose to leave it to that session); merging it puts that WIP on `main`.
- **Cleanup:** after listing candidates and getting an explicit "all", the 5 merged worktrees and 12 merged local branches of this session's
  work were removed with `git worktree remove` / `git branch -d` (nothing refused). Remote branches were left.

## Decisions made
`D-GH-2026-10-04-permanent-wounds` and `D-GH-2026-10-04-wound-aliases` (and the earlier 09-30 / 10-04 records). Judgement calls listed in that record: Afflictions
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
- A worktree-isolated session is refused `git -C <other worktree>` and compound git commands, so cleanup was first handed to the user as commands;
  plain separate `git worktree remove <path>` and `git branch -d <name>` calls did work from inside a worktree. Switching worktrees mid-session
  needs `git worktree add` then `EnterWorktree` with `path`.
- Earlier: a redaction regex printed three stored API keys (see below).

## New tasks discovered
None new. `feat/server-enforced-drawback-lock` (already on the board) is what makes lock/unlock real; the lock is client-honoured until then.

## Blockers / open
- **Rotate the Gemini, Groq and OpenRouter keys** exposed in this session's transcript, then update
  `/data/projects/ai-templates/secrets/cold-review-api-keys.md` in place. Not done.
- Promotion #577 (another session's) is open with a "wip … still red" CharGen commit and no CI results; decide with that session before merging.
  `main` is on `v1.571` (promotion #571) with rules `v0.367`; the wounds `v0.368` and the picker reach `main` only through #577.
- Merged remote branches still exist on GitHub; delete once #577 is settled (outward-facing, list first).
- `fix/random-fighter-int-priming` (NEXT board) covers the intermittent Fighter-priming CI flake. The "3×" buy-off multiplier copy is not filed.
- `pact-guide`'s vendored `py/vendor/engine/` still has the old Missing Arm text until that project's sync runs.

## Next session should start with
Confirm key rotation and cleanup, then pick the next NEXT item (candidate: `feat/server-enforced-drawback-lock`, which needs a cold
plan review first).
