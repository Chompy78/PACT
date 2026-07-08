# 2026-07-08 — Fix the recurring D-GH numbering collision

## Discussion
Asked for general workflow/skill improvement ideas. Reviewed `docs/PACT_ROADMAP.md`, `docs/SKILLS.md`,
`DECISIONS.md`, and recent `docs/sessions/` entries, then cross-checked against the cross-project
`chompy78/ai-lessons-learned` repo (cloned per its `SessionStart` hook pointer) for any indexed lesson that
matched an observed PACT pattern rather than proposing generic advice.

Three candidates surfaced; the user picked the highest value-per-effort one to implement now:
1. **D-GH decision-number collisions** (implemented this session — see below).
2. Worktree gotchas (`EnterWorktree` stale base branch, `ExitWorktree` commit-count scare, absolute-path
   writes after a compaction resume) — PACT's own session notes already describe hitting these; the
   `ai-lessons-learned` topics (`claude-code-worktrees.md`) have them indexed with fixes. Deferred —
   candidate for a follow-up docs task pointing `run-task.md`/`docs/SKILLS.md` at those topics.
3. REV-11 (CI parity gate) and A2 (PR template) — already on the roadmap, not yet executed; these are the
   "actually prevents" fixes vs. the current checklist-discipline approach. Not touched this session.

## The fix
`DECISIONS.md`'s `D-GH<N>` numbering has collided three times — D-GH19/D-GH20, D-GH25/D-GH27,
D-GH26/D-GH28 — every time because a session computed "next = highest + 1" from a local snapshot read
earlier in the session, and a concurrent session independently claimed the same number before either
landed. Because both land via squash-merge, git auto-merges the duplicate header with no conflict, so the
collision is only ever caught by a human/agent noticing after the fact (all three were).

This matches `ai-lessons-learned` H-022 verbatim: "highest + 1" IDs computed from a local snapshot collide
under concurrency; the fix is a live-state check, or accepting renumber-on-merge as policy.

Implemented as **D-GH30** (see `DECISIONS.md`): keep the existing sequential `D-GH<N>` format (renumbering
~30 cross-referenced entries and every pointer in `AGENTS.md`/the roadmap wasn't worth it for a problem
that's rare — 3 collisions in 29 entries — and cheap to fix post-hoc), but now require checking the
**live** remote immediately before claiming a number:

```
git fetch origin preview && git show origin/preview:DECISIONS.md | grep -oE 'D-GH[0-9]+' | sort -t H -k2 -n -u | tail -1
```

and explicitly document renumber-on-merge-collision as the accepted fallback (exactly the pattern already
used to resolve all three prior incidents) rather than an ad hoc scramble each time. Mirrored as a short
rule in `AGENTS.md`'s "Multiple sessions" section so it's visible without opening `DECISIONS.md` first.

## Why not a new ID scheme (date/UUID)
Considered and rejected — see D-GH30's Options/Why in `DECISIONS.md`. Short version: the sequential format
is too entrenched to be worth replacing for a problem this infrequent, and a fresh scheme still needs a
live check to avoid its own drift, so it doesn't actually remove the root cause (a stale, non-live read).

## Verification
Docs-only change; no `compute()`/`DATA` touched, so no engine-parity run needed. Confirmed no live
collision exists today: `git fetch origin preview` + grepped `origin/preview`'s `DECISIONS.md` for the
highest `D-GH<N>` before picking `D-GH30` (highest in use was D-GH29, matching the local copy).
