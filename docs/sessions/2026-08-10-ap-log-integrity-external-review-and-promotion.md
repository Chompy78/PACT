# 2026-08-10 — AP-ledger integrity from a 7-AI review batch, three real bugs caught before merge, promotion to v1.402

Started as a request to write up the AP-overspend trust-boundary problem for other AIs to weigh in on
(`pact-ap-overspend-problem.txt`, delivered to the owner). Came back as seven independent reviews dropped
into `z-cold/` on the `zcold` branch, synthesized into a plan, implemented, caught real bugs in its own
review, and promoted to `main` — one continuous arc.

## Synthesizing seven reviews into three options

DeepSeek, Kimi, and four others converged hard on rejecting a full SQL reimplementation of `compute()`'s
pricing and on a narrow frozen-cost-sum trigger as the best simple server-side backstop. One review
(`PACT_AP_overspend_hardening_AI_threat_model.txt`) proposed something genuinely different: instead of
verifying costs are *correct* (impossible server-side without re-deriving pricing), make committed history
structurally impossible to *rewrite*. Synthesized into N1 (the sum trigger), N2/O3 (append-only locked
history), N3 (a Supabase Edge Function running the real engine — deferred to the task board once checking
`js/engine.js` directly showed `compute()`/`economy()` only sum frozen costs rather than re-deriving them,
so an Edge Function wouldn't out-guarantee a SQL trigger for locked characters anyway).

## The pivot: the owner's question fixed a design that was about to ship broken

First pass at O3 ("nothing in the LOG can change once locked") would have broken two real, already-shipped
features, confirmed by reading the code rather than assumed: Live Sheet's `undo()` (`LOG.pop()`, always
available) and CharGen's `replacePatchSlot()`/Live Sheet's `_shCommitAppearanceField` (both legitimately
rewrite or reorder `cat:'patch'` events in place). Recommending O3 be deferred to a "later, needs an
engine-level redesign" task — until the owner asked *"don't characters get a lock on the undo when they
get awarded ap?"* Checking `undo()` directly confirmed it: `LOG[LOG.length-1].type==='award' && !disc` ->
refuse to pop. The exact boundary needed was already designed and shipped, just client-side only. That one
question turned a deferred, architecturally-expensive later-task into something safe to ship the same day.

## The review that earned its keep

`/code-review ultra` on the resulting PR (#401) found two real, concretely-traced bypasses: a `disc`-flip
that silently disabled the locked-history trigger on the *next* write, and a `cat:'patch'` negative-cost
trick that could mask a genuine overspend. Fixing the first led to checking CharGen's own award-emitting
code directly, which surfaced a third bug the review didn't catch: CharGen's creation-budget seed
(`noLock:true`, never `disc`) gets deleted-and-reappended at the end of the log on every resync — without
an exclusion it would have churned the lock boundary forward and frozen ordinary in-progress drafting for
any campaign-bound CharGen character. All three fixed, re-applied to the live Supabase project, and
re-verified with adversarial tests against disposable data before the PR merged — none left as follow-ups.
Full trace in `decisions/2026/D-GH-2026-08-10-campaign-ap-log-integrity.md`'s "Review findings" section.

## A stale branch, twice

This session's designated remote branch (`claude/get-ready-bovmru`) was 39 commits behind `preview` at the
start — caught only because greps for functions from the *previous* session's summary (`_shCommitAppearance
Field`, `_lsOverApBudget`) came back empty. Re-synced before any further work. The same trap recurred
mid-promotion: the local branch used for the version-bump commit was sitting at the PR #401 branch tip
rather than `preview`'s actual post-merge tip, which would have produced a non-fast-forward push — caught
before pushing, not after.

## Promotion: a flake, correctly not chased with a code fix

Promoting `preview` → `main` (PR #402, `v1.398` → `v1.402`) ran the full, unfiltered CI suite for the first
time in several PRs (recent feature PRs only touched `sql/`/docs, which path-filters most checks out).
`dm-console-ui` failed on the version-bump commit. Before touching any code: diffed `DM-Console.html`
between the failing commit and its passing parent — only the `TOOL_VERSION` string differed — and checked
workflow history, which showed this same suite had flaked-then-passed on a nearby commit once before.
Re-ran the failed job rather than guessing at a fix; it passed. Merged with a regular merge commit (never
squash, per `docs/VERSION-SYNC.md` — a squashed promotion severed shared history once before, PR #293).

## Net result

`main` is at `v1.402`, tagged. Two new Postgres triggers (`pact_enforce_ap_budget_consistency`,
`pact_enforce_locked_history`) are live on the production database, already carrying three review-caught
fixes. `feat/ap-edge-function-validation` is on the task board as the deferred third leg. Five branches
(`claude/get-ready-bovmru` and four earlier feature branches) are fully merged into both `preview` and
`main` — safe to clean up, not yet touched (that's `/cleanup-branches-universal-jc`'s job).
