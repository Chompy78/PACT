# 2026-07-04 — Audit/checking roadmap additions

## What this session was

The user asked for suggestions on setting up additional auditing/checking beyond what's currently
happening — covering both code/programming correctness and logic/usability — in plain English, spanning
low- to high-token-cost options. This produced eleven suggestions (advisor checks, version-sync checks,
review-cadence habits, docs-consistency audits, dead-code sweeps, pre-release QA walkthroughs, a
full multi-agent pre-release audit). The user then asked to add each one as a roadmap item, prioritized
low-token/high-impact first.

## Judgment calls a future agent could reasonably second-guess

- **Two suggestions already existed as roadmap items** (headless CI = REV-11, already in LATER; fixture
  expansion = an existing NEXT task) — chose not to duplicate them, and instead recommended
  reprioritizing REV-11 into NEXT (later approved and done).
- **Several suggestions were habits, not buildable artifacts** (routine `/code-review`, periodic Supabase
  log skims, `/code-review ultra` before risky merges). Rather than forcing an awkward "TODO" task for a
  recurring habit, converted these into concrete doc/checklist deliverables with a real Done-when
  (e.g. "add this step to AGENTS.md's per-change checklist") instead of literal per-suggestion roadmap
  entries. This is a defensible but not the only valid choice — a future agent might prefer tracking
  habits as their own lightweight roadmap items instead.
- **Self-review before committing caught three real defects** in the first draft: a Done-when promised
  something ("referenced from the per-change checklist") the steps never instructed doing (fixed by
  adding the step explicitly); a "written findings note" with no stated location (fixed by pointing at
  `docs/sessions/<date>-....md`, matching this project's own convention); and two LATER-bucket items
  drafted in the NEXT bucket's full `## Title — TODO` format when LATER's actual convention is short
  `- **AN — ...**` bullets (reformatted to match).
- **Missed, then caught on being asked "anything left":** two of the eleven suggestions
  (`/code-review` cadence habits) were silently dropped from the final task list without being
  surfaced. Recovered by folding the habit into promoting the existing **A2 — PR template** LATER item
  to NEXT, with the review-cadence rule (routine `/code-review`, `ultra` for `js/engine.js`/`sql/` PRs)
  written into its task body.
- **A live bug was found, not just built around:** the existing "Expand engine-parity test coverage"
  roadmap task reserved decision code **D-GH14**, but that code was already taken (campaign-rules
  decision, same day). Corrected the reservation to **D-GH18** with a note to re-verify the actual
  highest `D-GH#` when the task is picked up, since more decisions may land before then.

## Collision with other sessions' work

This repo clearly has multiple concurrent Claude Code sessions committing to `preview`. Twice during this
session, a `git push` (or a routine sync check) found the remote branch had moved:

1. First push of the A2-promotion commit was rejected — 86 commits had landed on `preview` in the
   meantime (unrelated feature/bugfix work: iOS save/export, Live Sheet undo, a new `/plan-for-review`
   skill, etc.). Rebased the one pending local commit on top; applied cleanly, no conflicts.
2. During this close-out pass, `origin/preview` had moved *again* — a "skills refactor" PR (#106,
   reorganizing `.claude/commands/` — split `/next-task` into `/pick-task` + `/run-task`, added
   `/cleanup-branches`) plus another roadmap addition (engine module-bridge migration task) had merged.
   Fast-forwarded cleanly.

No conflicts either time because both sides only ever appended to `docs/PACT_ROADMAP.md`/`CHANGELOG.md`
rather than editing the same lines — worth knowing this holds only by luck of where each session's edits
landed in the file, not by design.

## Outcome

Landed in 4 commits to `preview` (466e193, 6bc42be, b68d4a5→rebased as e4a8ed7, plus this note):
7 new roadmap items (5 in NEXT, 2 as LATER bullets A9/A10), REV-11 promoted to NEXT, the D-GH14
reservation fixed, and A2 promoted to NEXT with the review-cadence checklist folded in. Nothing was
implemented — this was planning/backlog work only, consistent with the roadmap's own "holds only
open/planned work" rule, so no CHANGELOG entry was made for the additions themselves (only completed
work graduates to CHANGELOG.md).
