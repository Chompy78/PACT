# 2026-09-03 — the guard that could not see its own class of drift

Kept for three reasons, none of which is the shipped diff (which is small and dull: four files of test
and doc hardening).

1. A guard shipped *specifically* to prevent a class of failure was blind to an instance of that exact
   failure **in the same promotion that shipped it** — and nothing noticed for two days.
2. Three claims I made in this session were wrong, two of them stated to the owner as fact and one
   written into a repo file. This is the second consecutive session on this repo whose note opens with
   that admission; the other one is dated the same day
   (`2026-09-03-header-truth-and-the-guard-that-read-my-comment.md`, a different session). The
   recurrence is the finding, not the individual slips.
3. Four concurrent sessions were touching `preview` at once. What that actually costs is recorded
   below, because it is not what I expected it to be.

## The chain

The owner asked for per-band-row gold and downtime customisation (multiplier or flat override, one each
per currency). That shipped as PR #496 and is recorded in
`D-GH-2026-09-01-feature-cost-customization` — it is not what this note is about.

Running `/code-review ultra` on the promotion afterwards returned 13 findings. The first one is the
whole story:

> `sql/rls-policies.sql:747` — folding the migration into the baseline silently drops
> `set search_path = public, pg_temp` from `pact_ap_ledger_protected`.

PR #503 had shipped `testing/sql/rls-baseline-test.sql` in the same promotion, whose entire stated
purpose is that the baseline and the migrations can never diverge again. `sql/migrations/README.md`,
added alongside it, sells it as the reason "CI fails instead of the difference sitting there for someone
to discover in production."

It hashed `prosrc`. `search_path` lives in `proconfig`. The guard was structurally incapable of seeing
the regression that shipped beside it.

## Proving it rather than asserting it

`AGENTS.md` has a rule about verifying before writing an absence claim, and I had already broken it
twice this session, so I did not want a fourth "I reasoned that…". There is no Postgres server in this
container, but `initdb` is on disk under `/usr/lib/postgresql/16/bin`. Standing up a throwaway cluster
took one command; after that the guard could be tested like any other program.

The method that mattered: **inject the divergence deliberately and watch what the guard says.**

| Injected break | Before | After |
|---|---|---|
| Restore `set search_path` in the baseline **only** | `PASS … define the SAME logic` | `DIVERGED: pact_ap_ledger_protected`, exit ≠ 0 |
| Typo `seal_character_history` out of the checked list | PASS, having compared **four** functions | `FAIL all 5 baseline function bodies were snapshotted` |
| Point one `rejects()` probe at a non-existent column | PASS, having never fired the trigger | `FAIL … (HARNESS ERROR, not a rejection …)` |

The second and third are independent holes found while fixing the first. The join is an inner join with
no count assertion, so a function missing from one side yields no row and the loop reports SAME-logic
having compared nothing. `pg_temp.rejects()` caught `when others`, so *any* error — a renamed column, a
syntax error — counted as a passing rejection; rename `characters.stats` and all four probes go green
with zero seal coverage.

A test that cannot fail is worse than no test, because it is *reported* as coverage. All three holes had
that shape, and one of them had already let a real regression through.

## What I deliberately did not fix

The `search_path` regression itself is live, on `main`, in another session's commits. Fixing the guard is
independent of fixing the function, does not conflict with it, and stays green either way — because the
guard checks *agreement between two sources*, not correctness. So the guard was fixed here and the
function was handed over as `fix/protected-projection-search-path`, with the written brief including the
check that would have caught it directly: assert every checked function *has* a pinned `search_path`.
That check is deliberately absent from this branch, because adding it before the fix would put CI red on
`preview` for a defect this branch does not own.

Same reasoning for the two missing `DECISIONS.md` records on `cb323ca` and `f2418a9`: their author knows
the *why*. Writing it from outside would be reconstruction, which is the thing that rule exists to
prevent.

## Three wrong claims, and what each one actually was

- **"The e2e script exits 0 when it crashes."** Told to the owner as fact and written into a decision
  record. It exits **1**, correctly. The 0 came from measuring it as `node … | tail -25`, which reports
  `tail`'s status. What *was* genuinely missing is narrower — a crash printed a stack trace and never
  reached the summary line, so the output said neither "passed" nor "FAILED" — and an explicit
  `ABORTED before finishing` line now covers that.
- **"The tool-pricing task is unfiled."** Repeated four or five times. It had been at
  `docs/TASK_BOARD_NEXT.md:850` since PR #481, and was better written than the entry I was proposing.
- **"`/add-code-task` is unavailable in this session."** Written into a commit message without checking.
  The skill is present. The conclusion held for a different reason — it commits directly to `preview`,
  and a cloud session can push only its own working branch — and the commit message was amended to say
  so, naming the mistake rather than quietly swapping the reason.

The pattern in all three: an absence asserted from one signal, where a second cheap check existed and was
skipped. That is exactly what `AGENTS.md`'s rule describes, and knowing the rule did not prevent it.
A fourth near-miss was caught before it landed — the correction note on PR #506 originally asserted *how*
a placeholder had been stripped from the body, which I had inferred and not observed; it now separates
what was seen from what was guessed.

## Four sessions, one `preview`

`preview` moved **four times** while this work was open: the `v1.504` promotion, a tools header fix, a
session log, and a task-board note — then `#507` landed a rules change minutes after the promotion
merged. I merged the base in twice: **once pre-emptively** (GitHub still reported `clean`, but `BUILD`
had moved to `v1.504` and I wanted the gates run against the real target) and **once because the merge
was actually refused** — `405 Pull Request has merge conflicts`. And once the promotion PR I was about
to open **already existed**, opened by another session two minutes earlier, with the `v1.506` build-sync
commit already pushed.

What this cost was near zero, and the reason is worth recording, because the intuition points the other
way. There was exactly **one** real content collision, in `CHANGELOG.md`, and it auto-merged — the file
is append-at-top and each session appends a whole entry, so the three-way merge has nothing to arbitrate.
Nothing collided in code. The one genuine risk was doing duplicate work on the promotion, and the thing
that prevented it was `create_pull_request` refusing with
*"A pull request already exists for Chompy78:preview"* — a platform guard, not discipline.

The correct move on finding the other session's PR was to **verify its state and merge it** rather than
re-open my own: `version-label-ci` passed 10/0 against its head, its contents matched what I would have
promoted, and its author had independently reached the same no-tag conclusion from the same rule. Two
sessions converging on one answer from one written rule is the strongest evidence this repo's
documentation is doing its job.

## Coda, 2026-09-05

Reopened two days later to correct PR #506's body, which carried `BUILD` bumped to **`v1.`** — a version
string naming no version, because the PR-number half was written as a bracketed placeholder and lost.
PR #503 shipped the identical stub two days before, and there the missing number sat inside the one
instruction delegating tag creation to a human, so that instruction named a tag that did not exist.
Twice in three days, so: **write the resolved literal in a PR body, never a bracketed placeholder.**

Also confirmed from a fourth angle, while running `/close-code-session-jc`: the skill delegates four
procedures to a sibling `close-session-logging-core.md`, and that file does not exist —
`close-code-session-jc/` contains only `SKILL.md`. This is the open NOW task, now observed by the skill
itself failing to find its own dependency rather than by inspecting the tree.
