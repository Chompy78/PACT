# 2026-08-12 — Guide↔engine version pointer (cold-reviewed), and the invite-peek-timeout hotfix

## Thread 1: reconciling guide↔engine rules-version drift

Picked via `/pick-code-task-jc` as the topmost `docs/TASK_BOARD_NEXT.md` TODO matching the session's own
name ("merge version with pact-guide repo"). Given AGENTS.md's own trigger criteria for a cold plan
review (cross-project, unsettled mechanism, real rework risk), drafted a self-contained plan at
`docs/plans/2026-08-12-guide-engine-version-pointer.md` before touching either project.

Research turned up more than the task-board text anticipated: `pact-guide` (the separate, non-GitHub
project where the guide is actually authored) had already shipped, the day before, a full engine-vendoring
pipeline for its Python pricing tool (`D-2026-08-11-engine-js-auto-sync-pipeline`) — including a
`py/vendor/engine/SYNCED_FROM.txt` provenance file that already stamps branch/commit/`DATA.version` on
every refresh. That made the right design obvious: reuse that existing provenance rather than build a
second vendoring path (exactly the "two overlapping sync mechanisms" trap the original task text warned
about avoiding). Both of the task's own landmine findings turned out to be already resolved by the time
this session started (`py/PACT-staleness.py` retired 2026-08-12, not merely dead; the auto-sync pipeline
built and shipped, not a live collision risk).

The plan went through a genuine cold-review round this session — 4 independent reviewers (Copilot/
Opus-4.8, Kimi Chat, M365 Copilot/GPT-5 reasoning, Claude 3.5 Sonnet), found via the `zcold` branch's
`z-cold/` drop-zone after some back-and-forth figuring out *which* project's connector to check (the
reviews turned out to live in this repo's own `zcold` branch, not `pact-guide`'s home-server folder — an
easy place to look in the wrong project first). All four converged on the same substantive gap: a
`documents-rules` marker that auto-advances on every vendor refresh would assert "reconciled" when it
only means "vendored." Folded that in as the plan's central fix — stamping became a deliberate
reconciliation action with a separate non-mutating `--check` mode — plus a genuine phase split (this-repo
docs vs. `pact-guide` implementation vs. an integration checkpoint) that three of the four reviewers
independently asked for.

Implementation split cleanly along the plan's own phase lines:
- **Phase 1** (this repo): `docs/VERSION-SYNC.md`'s new cross-project section, `DECISIONS.md` +
  `decisions/2026/D-GH-2026-08-12-guide-engine-version-pointer.md`, `docs/TASK_BOARD_NEXT.md` updated to
  reflect real status rather than graduated outright (the task isn't fully done — no marker has actually
  been stamped yet). Committed and pushed to `claude/merge-pact-guide-version-132ppm`, **not yet merged
  into `preview`**.
- **Phase 2** (`pact-guide`): done directly via the home-server MCP connector rather than drafted as a
  handoff patch, once the user confirmed that was fine (the connector turned out to have real write tools
  — `write_project_file`/`edit_project_file`/`rename_project_file` — not just reads, with an automatic
  `.mcp_backups/` safety net). Canonical guide renamed off its embedded version, `py/tools/
  stamp_guide_rules.mjs` built (`stamp`/`--check` modes), that project's own decision/changelog/task-board
  records updated. Two edits (`TASK_BOARD.md`, `CURRENT-WORK.md`) hit a transient Cloudflare 502 and an
  MCP disconnect mid-session; verified nothing had partially landed before retrying, rather than assuming
  either outcome. **No `documents-rules` marker was stamped** — deliberately: doing so without an actual
  content-reconciliation pass would have been exactly the false assertion the whole mechanism exists to
  prevent. That marker's own commit status in `pact-guide` couldn't be independently verified from this
  session (no git tool on that connector) — taken on the user's word once they confirmed it.

**Status at session end: still open.** `claude/merge-pact-guide-version-132ppm` has Phase 1 committed and
pushed but not merged into `preview`; `pact-guide` has Phase 2's mechanism built but not yet exercised.

## Thread 2: the invite-peek-timeout hotfix (found via a routine email check)

Asked to check email for a specific recurring CI-failure subject line. Turned up 6 identical-shaped
failures (`chargen-flows` / "Promote preview → main"), which on investigation were 8 straight closed,
unmerged promotion PRs since 2026-08-10 (#402 through #417) — every single promotion attempt had been
failing the same e2e check and getting abandoned rather than fixed.

Reproduced locally with Playwright (had to work around a Chromium version mismatch between the pinned
client and the pre-provisioned browser — the real test script already had its own fallback for this,
reused it in a scratch debug script) and instrumented the actual page code directly rather than guessing
from source reading alone. Root cause: `tryRedeem()`'s `peekPlayerInvite()` call (a real Supabase RPC,
added by a since-shipped feature) had no timeout — an unresolved request left the whole accept/decline
`confirm()` unreachable, silently, in both this sandbox and real GitHub Actions CI alike.

Presented shallow-vs-deep fix options per AGENTS.md's own convention (mock the test vs. actually bound
the network call); the deeper fix was chosen and shipped: a 3000ms `Promise.race` falling back to the
already-existing nameless-prompt path, protecting real users on a slow connection the same way it fixes
the test. The test's own wait had to be bumped from 600ms to 3400ms as a necessary companion change — a
fix that takes 3s to fall back can't be observed by a check that only waits 600ms, independent of whether
the app-side fix is correct.

Full cycle completed end-to-end this session: `fix/invite-peek-timeout` → PR #418 → `preview` (all 6
checks green, including `cloud-e2e`, which couldn't be run locally — no Docker daemon in this sandbox) →
promotion PR #419 → `main` (`BUILD` synced to `v1.419`; one check, `dm-console-ui`, failed on first run —
investigated rather than waved through, confirmed via local reproduction on unmodified `main` that it
predated and was unrelated to this change, re-ran just that job rather than the whole suite, passed clean
on retry) → tag `v1.419` and GitHub Release, done by the user directly (tag/release creation is a
documented, permanent 403 from any cloud/web Claude Code session — confirmed again this session against
both raw `git push` and the GitHub MCP server, which doesn't even expose a create-tag/create-release tool).

**Status at session end: fully shipped and closed.** Nothing further outstanding on this thread.

## Why this is worth a session note rather than just two CHANGELOG lines

Two genuinely unrelated pieces of work landed in one session, at very different states of completion —
one still mid-flight across two projects, one fully shipped end-to-end including a live production
release — and the second thread was discovered *while* working the first, from a task (check email) that
had nothing to do with either. The CHANGELOG lines record *what* changed in each; this note is where the
actual shape of the session — plan → cold review → phased implementation on one thread, and
diagnose → fix → full promotion cycle on the other, run concurrently — is legible as two coherent stories
rather than a flat list of commits.

## Housekeeping this session also did

- Relocated the 4 processed guide-engine-version-pointer cold reviews from `z-cold/` to `z-cold/old/` on
  the `zcold` branch (one, `deepseek_text_20260812_0ea238.txt`, renamed to reflect its actual content — a
  Claude 3.5 Sonnet review, not DeepSeek; the drop-zone's auto-generated filename was misleading).
- Confirmed this skill's referenced sibling file (`close-session-logging-core.md`) is missing from this
  installation (only `SKILL.md` present) — proceeded on direct, session-verified knowledge of this repo's
  actual DECISIONS.md/task-board formats instead of blocking on it. Worth fixing in the skill's own
  packaging at some point, not a PACT-repo concern.
