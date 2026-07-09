# 2026-07-09 — PR template + Supabase advisor/log checklist step (batched)

## What happened
`/pick-task` picked "Mobile sticky buttons regression" as the primary quick/easy candidate, with "A2 —
PR template with review-cadence checklist" and "Add Supabase advisor/log check to the per-change
checklist" as two independently-quick, non-overlapping batch candidates. The user chose to run only the
two docs-only batch candidates (not the mobile CSS fix), so `/run-task` executed on
`docs/batch-pr-template-review-cadence-plus1` with just those two roadmap items, each in its own commit:
one adding `.github/pull_request_template.md`, the other adding a Supabase advisor/log-check step to
`AGENTS.md`'s per-change checklist (renumbering the two steps after it and their one internal
cross-reference). PR #135 opened against `preview`.

## Review caught a real defect
After the PR was up, a `check your work` pass pulled the actual PR diff (not just the local post-edit
reads) and found that removing the Supabase-checklist roadmap block had left a double blank line where
its leading `---` separator used to be — the separator sat just outside the `old_string` match boundary
used to delete the block, so the edit tool had no way to know it needed removing too. This broke the
blank-line/`---` separator convention used by every other adjacent task transition in that stretch of
`docs/PACT_ROADMAP.md`. Fixed with a follow-up commit (`41b1931`) restoring the separator, pushed to the
same PR branch. The other roadmap removal (A2's block) didn't have this problem — its trailing `---` sat
inside the removed span's *following* context, not outside it, so no fix was needed there.

## Why this note exists
Two roadmap items were done together in one sitting/branch/PR (per `/pick-task`'s explicitly-approved
batching rule) — that alone is one of this skill's session-note triggers. The separator-bug catch/fix is
also worth recording as a general lesson (see the `ai-lessons-learned` candidate drafted from this
session): diffing the final file state after removing a demarcated text block is more reliable than
trusting the immediate post-edit read, because a boundary-adjacent separator can silently survive or
vanish depending on which side of the match it happened to fall on.

## Why no DECISIONS.md entry
Neither task involved a non-obvious *why* — a PR template and a checklist-step addition are both
mechanical, stated-outcome docs changes with no trust-boundary, data-model, or architectural trade-off
a future agent would need explained.

## Verification
Docs-only change (`.github/pull_request_template.md`, `AGENTS.md`, `CHANGELOG.md`,
`docs/PACT_ROADMAP.md`); no `js/engine.js` or `tools/*.html` touched, so no engine-parity run was needed.
