# D-GH27 — `/pick-task` may bundle several quick tasks into one branch/PR — the one exception to "one task per branch"

Status: Active

- **Context:** each `/pick-task` → `/run-task` cycle pays a fixed overhead regardless of task size — a
  live roadmap fetch, an `engine-parity` run, a rebase onto `preview`, and a PR — on top of the actual
  edit. For a genuinely small/low-risk task (docs-only, config, single-tool CSS/UI, the same class
  `/pick-task`'s "quick" filter already identifies), that fixed cost dominates the total token spend.
  The repo's existing convention is "one task per branch" (the open branch is the concurrency-safety
  signal for other sessions), so any batching has to not break that signal for tasks it doesn't cover.
- **Options considered:** (A) leave batching out of scope — every task, however small, still pays the
  full per-task overhead; (B) let `/pick-task` bundle several *quick-filtered* tasks into one shared
  branch/worktree/PR, provided each one is independently pre-flighted (branch-collision + effort/model
  checks) and none touch overlapping files; (C) batch any tasks regardless of size/risk classification.
- **Decision:** (B). Bundling is opt-in (offered via a clickable `AskUserQuestion`, never automatic),
  capped at 3 tasks total (primary pick + up to 2 more), and restricted to tasks that already passed
  Step 2's "looks small/quick" test *and* Step 3's per-task pre-flight individually — a candidate that
  fires the Opus/xhigh escalation trigger, or collides on files with another batch member, drops out of
  the batch rather than being forced through. Each bundled task still gets its own commit and its own
  `CHANGELOG.md`/roadmap-graduation line; only the branch/worktree/rebase/`engine-parity`-run/PR
  machinery is shared.
- **Why:** (C) was rejected because "one task per branch" exists specifically so a branch's existence
  reliably tells a concurrent session "someone's already on this," and so a PR stays one reviewable/
  revertible unit — bundling anything above quick/low-risk size would erode both properties for no
  proportionate token savings (a large task's edit cost dwarfs the fixed per-task overhead anyway, so
  there's nothing to amortize). (A) was rejected because the fixed overhead is real and the roadmap
  already has several genuinely independent quick items (docs-only checklist additions, config toggles)
  that gain nothing from individual branches/PRs. (B) keeps the collision-safety property for everything
  it doesn't cover, and keeps per-task traceability (commits, CHANGELOG lines) even for what it does.
- **Status:** DONE.
- **Addendum (2026-07-05):** originally logged as `D-GH25`, picked on a branch rebased before another
  session's PR (#113, retiring the leaked-password-protection roadmap item) independently claimed the
  same number. Both landed on `preview` via squash-merges that silently concatenated rather than
  conflicting — the same "clean auto-merge hides the collision" failure mode as the prior `D-GH19`/
  `D-GH20` incidents. Renumbered to `D-GH27` in a follow-up fix once found; `D-GH26` stays reserved for
  the engine module-bridge migration task per `docs/PACT_ROADMAP.md`.
