# D-GH23 — `/pick-task` Step 1 delegates its four `git show` fetches to an Explore subagent

Status: Active

- **Context:** `/pick-task` (née `/next-task` Step 1) needs the live `preview`-branch copies of
  `AGENTS.md`, `docs/PACT_ROADMAP.md`, `testing/tests/engine-parity.html`, and
  `testing/expected/expected-results.csv` before it can pick or pre-flight a task — but reading all four
  inline puts their full content in the picking session's own context for a result that's really just
  four facts (branch convention, pass count, NOW/NEXT TODOs, highest `D-GH#`).
- **Options considered:** (A) keep the four `git show` calls inline, as `/next-task` always did; (B)
  delegate the fetch-and-summarize step to an `Explore`-type subagent via the `Agent` tool, returning only
  the compact summary.
- **Decision:** (B). `/log-ai-lessons` already uses this exact pattern for its directory/glob case (delegate
  the bulk reading, keep only the drafted output) — this extends the same convention to `/pick-task`.
- **Why:** the picking session doesn't need the raw file contents to stay in its own context for the rest
  of the conversation; only the four derived facts do. Not retrofitted onto `/close-session`, which reads
  local repo state rather than fetching remote files, so the same justification doesn't apply there.
- **Status:** DONE.
- **Addendum (2026-07-04):** the subagent delegation isolates the read cost from the *picking session's*
  context, but doesn't reduce the *total* tokens spent — the subagent still pays for all four files, fresh,
  on every invocation. Auditing that cost found `testing/tests/engine-parity.html` (10KB) contributed
  nothing toward the "current expected pass count" fact: that number is just the row count in
  `testing/expected/expected-results.csv`, which is fetched separately. Dropped the `engine-parity.html`
  fetch; Step 1 now pulls three files, not four. `testing/tests/engine-parity.html` is unaffected — it's
  still the actual test harness `/run-task` runs; only its role in the `/pick-task` fetch is gone.
