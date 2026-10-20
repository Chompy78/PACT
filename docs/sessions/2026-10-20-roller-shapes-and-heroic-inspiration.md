# 2026-10-20 — roller shapes, Heroic Inspiration boons, and a stale NOW task

Run from the NOW/NEXT board with `/pick-code-task-jc` → `/run-code-task-jc`, partly unattended (the owner was away for the last two tasks).

## What shipped (all squash-merged into `preview`)
- **#679** `fix/random-fighter-int-priming` — the Fighter-priming check in `random-quality-ci.mjs` was over-strict, not the roller broken. It now rolls with a seeded stream and prints a replay line on failure.
- **#681** `feat/heroic-inspiration-boons` (rules v0.378) — Twofold / Threefold Inspiration, Blazing Moment 18+. Boons had no prerequisite support, so the engine gained an optional `prereq` array resolved with the Hit-Dice gate. Record: `D-GH-2026-10-20-heroic-inspiration-boons`.
- **#683** — the `pact-guide` master now carries the same boons and the rewritten "never more than one" rule (edited over the home-server connector, not by copying the served file). The master's other fortune-boon differences (Blazing Moment 5+/9 against the engine's 9+/14) were left for the fortune-boons reconciliation.
- **#685** `feat/roller-build-shapes-2` — the primary stat primes to 16/14/12 (70/20/10) instead of a flat 16, and non-front-line classes buy armour training. Measured over 96 rolls at 85 AP: +3 attacks 0 → 3, characters with armour training 53 → 70.
- **#690** `fix/roller-silent-fallbacks` — the third silent fallback the task asked us to look for. The signature-feature table named `Ranger: Weapon Mastery`, which is barred from purchase, so every rolled Ranger had no class feature. Now `Ranger: Fighting Style`, and the guard aborts the roll instead of returning. The creation-limit lookup no longer swallows an error and rolls uncapped.

## Things worth remembering
- **"Creation-lock integrity" was mostly already done.** The handoff note was written before steps 3–5 shipped. Read-only investigation showed only Part 1b (CharGen's whole-log rebuild paths) was open, so the board entry was replaced by the narrow `feat/chargen-merge-not-rewrite` rather than forced through.
- **The Fighter-priming "flake" was an assertion problem.** A Tiefling Fighter can legitimately finish with INT 20 over STR 16 because the spend spreads random +2s. Assert the class's own stat was primed, not that no other stat is higher.
- **Priming looser means CI had to move with it.** The Fighter floor went from STR 16 to 12, the lowest priming target. The Wizard check has to roll at the Lv1 budget: at a Lv10 budget the general spend buys INT up regardless.
- **The Ranger assumption.** Fighting Style as the Ranger signature was picked by the agent while the owner was away and is flagged in PR #690. It is a one-word change.
- **Guard-and-return is the shape that hid it twice.** An entry that "doesn't resolve" should throw, not return. `apLevel()` was the first case; the signature table the second.

## Environment notes
- Parallel runs share ports 8733/9335; another session sometimes holds them. `PACT_E2E_PORT` / `PACT_E2E_CDP_PORT` override.
- `roll-headless.mjs` occasionally reports "CharGen never became ready" under load; a retry works. Its `--out` file is the safe way to take large result sets (piped stdout truncates).
- The main checkout was held by other sessions throughout (a diverged local `preview`, then `feat/bar-unreviewed-grants`), so all work went through throwaway worktrees and `git push origin HEAD:preview` for docs-only commits.
- Six merged remote branches and three local ones were deleted at the end after checking each PR head matched the branch tip.
