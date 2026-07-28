# D-GH-2026-07-16-sweep-tasks-risk-model-v2 — risk ≠ uncertainty, and Effort was a redundant proxy

Status: Active

- **Context:** immediately after `D-GH-2026-07-16-sweep-tasks-skill` shipped, discussion surfaced
  that "Risk" as originally defined silently conflated two different things — blast radius if
  something goes wrong, and how ambiguous/uncertain the task itself is — under one label, with no
  way to tell which one excluded a given task. Separately, the user wanted the policy loosened from
  "only `Risk: low`" to "`Risk: low` or `medium`, `high` always vetoed."
- **Options for the conflation:** (1) split into two separate tags, `Risk` and `Uncertainty`,
  both required low for eligibility. (2) keep one `Risk` tag, but define it explicitly as derived
  from named sub-factors (ambiguity being one of them) with a stated combination rule, so the "why"
  clause can name which factor drove the rating without needing a second top-level tag.
- **Decision:** (2) — three factors (**ambiguity**: likelihood the implementation itself diverges
  from correct; **damage scale**: blast radius/reversibility if it does; **damage likelihood**: how
  likely the damage is to surface given a wrong implementation), each rated low/medium/high,
  combined by **worst-of** (the highest-rated factor sets the overall Risk).
- **Why:** a real risk-assessment model is likelihood × impact; ambiguity is the primary driver of
  likelihood (a clearer task is less likely to be implemented wrong), so folding it in as a named
  factor rather than a separate top-level tag keeps `/sweep-tasks`' filter to one field while still
  preserving *why* — the diagnostic value a merged single field would otherwise lose. Two separate
  tags were rejected as unnecessary complexity once the single tag's definition became precise enough
  to carry the same information via its factor breakdown.
- **The Effort/Risk decoupling:** once Risk properly captured ambiguity, `Effort: high`'s old
  criteria ("genuine architectural judgment," "a design call with real trade-offs") turned out to be
  duplicating exactly what the Ambiguity factor already measures — a task that's high-effort in the
  risky sense will score `Risk: high` via Ambiguity anyway. Effort was demoted from a gate to pure
  ordering/sizing information; Risk alone is now the sole safety gate, with `high` an absolute veto
  and `medium` newly eligible (previously excluded).
- **Consequence:** `/add-task`'s Risk section rewritten around the three factors; `/sweep-tasks`'
  Step 2 filter changed from "Effort ≤ medium AND Risk = low" to "Risk ≤ medium" (Effort unfiltered,
  used only for the low-first ordering tiebreak and for review-tier sizing); the 2 tasks already
  tagged on the board were re-scored under the fuller model (see `CHANGELOG.md`) — one moved to
  `high` (previously under-weighted as `medium`), one moved to `medium` (previously over-confidently
  tagged `low`, since "manually verifiable" isn't the same as "automatically gated").
- **Also added this same pass** (separately motivated, not part of the risk-model rework itself): a
  consecutive-failure circuit breaker (halts the sweep after 2 failures in a row rather than grinding
  through what's likely a systemic problem, not a per-task fluke), a diff-size sanity check (flags,
  doesn't auto-park, a task whose real diff outgrew its Effort tag — a cheap second opinion on the
  classification once the real diff exists), Risk-scaled review tiers with mandatory live
  verification above `Risk: low` (the file-path-only heuristic for review scrutiny missed anything
  risky that didn't happen to touch `js/engine.js`/`sql/`), and `docs/sweep-log.md` (a durable record
  of every *attempted* run, since `CHANGELOG.md` only ever shows what shipped — a pattern of repeated
  parks on one kind of task would otherwise leave no trace to notice and retune the criteria against).
- **Found and fixed by `/code-review` before merge:** two real bugs in Step 4's new ordering. (1)
  The review-fix re-entry section had picked up a worktree-base check misapplied from this session's
  own earlier gotcha — placed *after* "apply the fix ... commit," it would have run `git reset --hard
  origin/preview` at a point where doing so discards the fix commit just made, and the check doesn't
  even apply there: it protects against `EnterWorktree`'s *implicit* base resolution, not an explicit
  `git rebase <ref>` command, which can't silently target the wrong branch. Removed — the existing
  `git reset --hard origin/<type/short-slug>` step immediately after `EnterWorktree` already fully
  overwrites whatever base it silently picked, so nothing was actually left to protect against at
  that later point. (2) The live/real-verification requirement was sequenced *before* the
  code-review-fix step, so a task needing a fix would have its `Risk`-tier verification checked
  against the pre-fix code, satisfying the requirement on paper without covering what actually
  merges. Reordered to run last, against the final code.
- **Status:** Active.
