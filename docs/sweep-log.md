# PACT — Sweep log

> One entry per `/sweep-tasks` run, **newest first**. Records what was *attempted*, not just what
> shipped — `CHANGELOG.md` only ever shows successful merges, so this is the only place a pattern of
> repeated parks/drops (a signal the `Effort`/`Risk` classification criteria need retuning) leaves a
> trace. Written by `/sweep-tasks` Step 7 itself, committed directly to `preview` (docs-only, no
> approval-wait, same convention as `/add-task`'s own direct-commit flow).

Entries land here starting with the first real `/sweep-tasks` run.

## 2026-07-19 — sweep run

Batch size requested: 8. Filter: `Risk: low`/`medium` (Risk-high excluded, no exception).

Board had 6 TODO tasks total; 3 were `Risk: high` (excluded, never eligible) and 3 were
`Risk: low` (eligible). Of the 3 eligible, 2 (`fix/chargen-live-rules-version`,
`docs/agents-version-refresh`) already had open PRs (#254, #255) from another
run/session — dropped at pre-flight per the branch-already-exists rule, not touched. No
backfill possible (no further `Risk: low`/`medium` candidates existed on the board).

| Task | Branch | PR | Effort/Risk | Diff-size flag | Outcome |
|---|---|---|---|---|---|
| Inline feedback-widget anon checkbox with its note | fix/feedback-anon-checkbox-inline | #267 | low/low | none | **MERGED** |
| Fix CSS specificity hiding the anon checkbox | fix/feedback-anon-hidden-specificity | #269 | low/low | none | **MERGED** |

**New task discovered mid-sweep:** while verifying the first task in a real browser, found the
signed-out anon checkbox wasn't actually hidden (pre-existing CSS specificity collision,
independent of that PR). Filed directly to `preview` per Step 5, cleared the `Risk: low` bar, and
was folded into this same run's queue — executed and merged as the second task above.

Circuit breaker: not triggered (0 consecutive failures — both tasks merged clean, no code-review
findings, no CI configured on either PR).

Untagged tasks: none on the board.

`preview` is now 4 commits ahead of where this run started (2 task commits + 2 roadmap-doc
commits); ahead of `main` by all outstanding `preview` work — promoting `preview` → `main` is a
separate, human-initiated call.
