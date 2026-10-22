# 2026-10-20 to 2026-10-22 — an unattended sweep, its follow-ups, and the stage-2 freeze check

Merged to `preview` (all squash-merged on the owner's explicit go-ahead, each one): #694, #695, #697, #699, #701, #702, #703, #705, #706, #709, #710.
Decisions touched: `D-GH-2026-08-05-pricing-model` (new "Ruling"), `D-GH-2026-09-02-baseline-is-the-authority` and `D-GH-2026-09-02-protect-dm-removals` (new, reconstructed), `D-GH-2026-10-05-server-freeze-stage1` (post-apply check).

## What happened, in order

1. **Picks and small ships (10-20).** A batch of two low-risk NOW tasks became #694 (skills provenance, the 2(a) re-measure); the stale `fix/blank-character-rows` task was retired (#695); `feat/livesheet-buy-fullpage` shipped as #697.
2. **The unattended sweep.** The owner asked for the top 10 to 15 board items to be worked without them and for everything that could not be done to be listed. Output: #699 (header on the widen-protected-projection migration), #701 (DM Console lock bars), #703 (racial-trait text defined once in `engine-data.js`), and #702 (the sweep log). The "could not do" list was presented as K to O (high-risk tasks, tasks needing an owner decision, tasks that do not fit the repo rules).
3. **Follow-ups the owner chose.** Re-label three parked tasks as "not sweep-eligible" with the reason (#705). Run the stage-2 freeze checks that a session can run (#706). Show granted proficiencies (#709). Rule D1 over D2 and write the PR #503 records (#710).

## Things that went differently from the plan

- **A move that conflicted on every rebase.** `js/engine-data.js` is one giant line, so any two edits to it conflict. #703 (the racial-trait move) stalled on this twice. The fix, run by the owner because it was blocked for me, was `git checkout --ours js/engine-data.js` inside the worktree (during a rebase `--ours` is the latest `preview`), then re-applying the change on top with a script that reads the map from `origin/preview`. The first attempt ran in the main checkout and updated 0 paths. The original move script also failed because an auto-merge had already deleted the tool copy it read from.
- **A watcher reported "complete" at 7 of 30 checks.** `gh pr checks --watch` can exit early, so every merge here was preceded by re-reading the pass and pending counts and `mergeStateStatus`. `UNKNOWN` right after a push or merge is normal; re-query.
- **#703 and #699 both went `CONFLICTING` after `preview` moved.** Fixed with a normal merge of `origin/preview` into the branch and a normal push, never a force-push.
- **The risk on `ui/show-granted-proficiencies` was understated.** The sweep skipped it: CharGen reads its tick boxes back as the build, so a ticked granted flag would be saved as a purchase and could refund AP. The owner picked the safe design (a note, not a tick). Writing the test also caught a real gap: the Live Sheet's Heavy button said "needs Medium first" while Warden already granted Medium. The engine has no such rule; the button read only what was bought. Fixed in the same PR.
- **The stage-2 freeze log check** (read-only) found 62 "locked character history" refusals between 10-11 and 10-21, tapering to zero by 10-16. The message carries no character id and stage 1 raises the same text, so the record says "consistent with a stale copy retrying, not proof", with no rollback suggested. The round-trip audit still needs the owner's export of the live characters.
- **The two PR #503 records are reconstructions.** The board task said they should come from the commits' author. The owner chose to have them written from the commit messages and diffs; both records say so in a provenance line and add nothing the commits do not state.

## Still open

- Round-trip audit (`roundtrip-audit.mjs --stage2 --campaign-all`): needs the owner's export of the live characters, or a recorded decision to skip it.
- The rest of the "could not do" list: high-risk tasks (`fix/server-negative-cost-after-lock`, free-subclass-bare-pick, the CharGen post-lock tasks, the security audit), tasks needing an owner decision (`dm-console-award-seal`, spell-invocation pricing, the barred-abilities review, the epic-boon price), and tasks that do not fit the repo rules (the Edge Function task, the image-sweep deletion, the `pact-guide` reconcile).
- Possible task, not filed: make the server log a character id with a locked-history refusal. It needs a SQL change and the owner's approval.
- Not traced: which post-5-August branch closed the D1/D2 gap beyond D8.
