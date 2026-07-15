# 2026-07-15 — three roadmap tasks in one sitting (audit CI, parity warning-text, feedback widget)

## What happened

One session picked and shipped three roadmap items back-to-back via `/pick-task` → `/run-task`, each on
its own branch/PR, all merged into `preview`:

1. **`chore/wire-audit-py-into-ci`** (PR #217) — wired `testing/scripts/audit.py`'s default checks into
   CI as a new `.github/workflows/static-audit.yml`; kept `--rls` mode manual-only (no test Supabase
   project exists). Straightforward.
2. **`test/parity-warning-code-assertions`** (PR #218) — made the engine-parity gate assert each
   fixture's **exact warning-text array**, not just a count. Chose a **JSON sidecar
   (`testing/expected/expected-warnings.json`) over a new CSV column** because a real warning (LS-001's
   Ki-focus message) contains a literal comma the harnesses' unquoted `line.split(',')` parser can't
   handle. Surfaced a pre-existing coverage gap: only 5 of the engine's 54 `W.push` sites are exercised
   by the 20 fixtures — left open, output as a roadmap follow-up for the human single-writer to fold in.
3. **`feat/feedback-widget`** (PR #219) — the big one. Went through `/plan-for-review` first (4 cold
   reviews), then implemented. New insert-only `feedback` Supabase table (the **first `anon`-write in the
   schema**), a self-contained `js/feedback.js` widget on all four player-facing pages, RLS + migration.

## Why this is worth a note

**A real cross-PR collision.** PR #218 was opened cleanly, but by the time it merged, PR #217 had already
landed on `preview` — and both had edited the **same `testing/README.md` bullet** (the `engine-parity.html`
description). #218 went `MERGEABLE` → `CONFLICTING` the moment #217 merged. Resolution: a fresh temp
worktree on #218's branch, `git rebase origin/preview`, hand-resolve the one-line conflict (kept #218's
fuller text, which was a superset of #217's), force-push, wait for CI to re-green, then merge. The other
files (`CHANGELOG`, `DECISIONS`, roadmap) auto-merged — only the shared README line conflicted. Lesson
already captured for `ai-lessons-learned`: two same-day PRs touching the same doc bullet will conflict
even when the code is disjoint; the second to merge always pays the rebase.

**The feedback widget's anon-write decision + live-DB verification.** `feedback` is the first table to
grant `anon` a write. Made safe structurally (insert-only; no read/update/delete grant; policy uses only
`auth.uid()`, *not* the lockdown-revoked `is_campaign_*` helpers, so it doesn't break the invariant in
`rls-policies.sql`'s function-lockdown block). With the user's explicit go-ahead, the migration was
**applied to the live PACT Supabase project** and verified by role impersonation: anon insert(null)
allowed, spoofed-`user_id` rejected for both roles, all constraint boundaries enforced, SELECT/UPDATE/
DELETE denied, idempotent re-run clean, `get_advisors` no new findings. Test rows cleaned up after. So the
DB half of this feature is *already live* — deploying the static files is all that's left. Also confirmed
the `anon` `TRUNCATE`/`REFERENCES`/`TRIGGER` privileges are a Supabase project-wide default (identical on
`characters`/`campaigns`/`ap_awards`) and unreachable via PostgREST — not a regression.

**A UI bug caught only by driving the real page.** Browser-testing the widget found Escape didn't close
the panel when focus had left it — the keydown listener was scoped to the panel element. Fixed to a
document-level listener guarded by open-state. Neither the parity gate nor `audit.py` would have caught
this; it needed the actual browser.

## Decisions logged separately

`DECISIONS.md` D-GH-2026-07-15-{wire-audit-py-into-ci, parity-warning-text-assertions, feedback-widget}.
Plan doc: `docs/plans/2026-07-15-feedback-widget.md` (with its cold-review outcome filled in).

## Status end

All three PRs merged into `preview`; `preview` sits ahead of `main` pending a promote. Recurring
environment friction this session (worked around, not fixed): `EnterWorktree` throws `EEXIST` on
`.claude/worktrees` when another worktree already created the dir (fall back to manual `git worktree add`
+ `EnterWorktree({path})`), and OneDrive file locks make `git worktree remove` fail even after git
deregisters the worktree (follow with `rm -rf`). Both are candidates for `ai-lessons-learned`.
