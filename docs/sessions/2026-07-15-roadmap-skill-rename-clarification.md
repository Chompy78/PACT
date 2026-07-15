# 2026-07-15 — roadmap-task scope clarification (rename PACT_ROADMAP.md + DECISIONS.md)

## What happened

The user's opening request was a garbled/dictated one-liner: "add roadmap task skill rename AI files
And rename Rd map HTML." This session's diagnosis of that request pivoted twice before landing on the
actual scope:

1. **First read:** interpreted "AI files" as `docs/AI_review_prompt.md` (an underscore-named doc,
   inconsistent with `docs/`'s kebab-case convention) and "Rd map HTML" as `docs/roadmap.html` (whose
   name is easily confused with `docs/PACT_ROADMAP.md`). Drafted a task to rename both, asked the user
   to confirm target names via `AskUserQuestion` — they answered "[No preference]" on both, so this
   version was drafted and shown for approval.
2. **User correction:** "it's a skill, not file" — meaning "AI files" actually meant the `/log-ai-lessons`
   slash-command skill (the only skill with "AI" in its name), not `docs/AI_review_prompt.md`. Re-asked
   what to rename it to; the `AskUserQuestion` reply came back as "add roadmap task" — a well-formed tool
   response but a semantically nonsensical answer to "what should this be renamed to?". Treated as not a
   real answer and asked the user to confirm in plain text instead of proceeding on it (see the
   ai-lessons-learned entry drafted alongside this note).
3. **Second, larger correction** (via `/add-roadmap-task` re-invoked with new args): the actual task was
   never about any AI-named file or skill at all — the user has "a new convention for the roadmap and
   decision log file names" and wants **`docs/PACT_ROADMAP.md` and `DECISIONS.md` themselves** renamed.
   The exact target filenames weren't decided yet ("i will tell you later... when we do the work"), so
   the task was formatted with that as an explicit blocking first step plus a full blast-radius sweep
   (both files are referenced by literal path in `AGENTS.md` and every skill under `.claude/commands/`).

The final task was approved and appended to `docs/PACT_ROADMAP.md`'s ⚪ LATER bucket, committed directly
to `preview` (no branch/PR) per `/add-roadmap-task`'s own convention — commit `21c3901`.

## Why this is worth a note

A future agent picking up the `docs/rename-roadmap-decisions-files` branch will see a task that's
`BLOCKED` on the user supplying filenames, with no visible history of the two abandoned interpretations
that came before it. Nothing about the final task text hints that "AI files" in casual conversation about
this task originally meant something completely different (a skill rename, then no file rename at all).
If a similarly-phrased ambiguous request comes in again, this note is the paper trail for why it was
resolved the way it was, and that the correct move each time was to re-ask rather than guess forward from
the previous (wrong) interpretation.

## Status

Task added, not started. Still blocked on the user providing the exact target filenames for both files.
