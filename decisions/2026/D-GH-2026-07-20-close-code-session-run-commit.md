# D-GH-2026-07-20-close-code-session-run-commit — close-code-session stages/commits/pushes once approved, instead of only printing the command

Status: Active

- **Context:** `D-GH-2026-07-16-close-session-auto-log` deliberately kept `git add`/`git commit`/`git push`
  out of the skill's `allowed-tools`, on two grounds: (a) `git add` in a shared, multi-session checkout
  could sweep in another session's in-flight changes, and (b) `git commit` removes the human's read-the-
  diff gate before a commit lands. In practice this meant every close-out ended with the human manually
  pasting a printed command, even for docs-only changes they'd already reviewed in full during the same
  conversation — including a case where the human explicitly asked mid-run to "just commit it" and was
  told that was out of scope, twice in the same session (once for the PACT commit, structurally not for
  the separate `ai-lessons-learned` push). The human then asked directly to remove the barrier.
- **Options:** (1) keep the barrier — the human already knows the manual-paste hand-off is the cost of the
  diff-review gate. (2) Remove the barrier fully — allow stage/commit/push, drop the exact-file-list
  discipline too, on the theory the human trusts the whole flow now. (3) Remove the commit/push barrier
  specifically, but keep the exact-file-list discipline (never `git add -A`/`.`) as a standing rule
  regardless of who runs the add.
- **Decision:** option 3. Part 3 now surfaces "stage, commit, and push" as one of the report's lettered
  follow-ups, same as merges/cleanup already were; once the human names that letter, the skill runs
  `git add <named files>` (never `-A`/`.`), `git commit`, and `git push` itself, re-checking `git status`
  on those specific files right before staging in case the checkout moved between the proposal and the
  approval. Merging, rebasing, resetting, and deleting remain disallowed — unchanged from before.
- **Why:** the diff-review gate (reason (b)) was the human's own safety margin to give up, and they gave
  it up explicitly, in these words, not by way of a single one-off "just commit it." The shared-checkout
  risk (reason (a)) is a different kind of risk — it doesn't depend on who clicks commit, only on whether
  the staged file list is exact — so dropping the barrier doesn't require dropping that mitigation too;
  option 2 would have removed a safeguard the human never asked to remove, just because it happened to
  live in the same paragraph.
- **Consequence:** `.claude/commands/close-code-session.md`'s frontmatter, Part 3, and Output format
  sections updated; `docs/SKILLS.md`'s description updated to match; `D-GH-2026-07-16-close-session-auto-
  log`'s Status marked Superseded, pointing here.
- **See also:** D-GH-2026-07-16-close-session-auto-log (the decision this reverses in part).
- **Status:** Active.
