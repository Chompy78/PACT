# D-GH-2026-08-10-supabase-keep-alive — prevent the free-tier project from auto-pausing

Status: **Active**, 2026-08-10.

## Context

The PACT Supabase project auto-paused from inactivity on 2026-07-25, which silently broke login/
register app-wide with "Failed to fetch" until manually restored via `mcp__Supabase__restore_project`.
Nothing in the repo prevented a recurrence — task tracked on `docs/TASK_BOARD_NEXT.md`, picked up by
`/sweep-code-tasks`.

## Options

- **A (chosen). A scheduled GitHub Actions workflow** (`.github/workflows/supabase-keepalive.yml`) that
  pings the project every 3 days using only the already-committed publishable/anon key. Free, no new
  infrastructure, no recurring cost, reverts trivially (delete the workflow file).
- **B. Upgrade the Supabase project to a paid tier**, which removes auto-pause entirely. Flagged rather
  than decided unilaterally, since it's a recurring cost only the project owner can approve — not taken
  in this pass; the task's own instructions default to A unless the user explicitly opts into B.

## Decision

Option A. `.github/workflows/supabase-keepalive.yml`: `on: schedule` (cron `0 6 */3 * *`, every 3 days)
plus `workflow_dispatch` for manual/on-demand runs. Pings `GET {SUPABASE_URL}/auth/v1/health` — Supabase's
standard GoTrue health-check endpoint — with only the `apikey` header (the committed publishable key, no
secret needed). The URL/key are read directly out of `js/supabase-client.js` at run time (grep + sed) so
the workflow has no second, independently-maintained copy of either value to drift from the app's real
credentials.

## Why this endpoint, not a table read

`/auth/v1/health` needs no session/RLS context and reliably returns `200`. A direct table read (e.g.
`GET /rest/v1/campaigns`) was considered and rejected for THIS purpose: every RLS-protected table
correctly `401`s an anonymous, unauthenticated request — with the anon key alone, a table-read ping
would return `401` on every successful run (RLS working exactly as intended), making a genuine outage
(project paused/unreachable) indistinguishable from expected, healthy RLS behaviour in the workflow's own
pass/fail check. The health endpoint sidesteps this entirely: a `200` reliably means "the project is up,"
full stop — the workflow's `if [ "$STATUS" != "200" ]` gate is only meaningful with a target endpoint
that returns 200 exactly when, and only when, the project is actually healthy.

## Why every 3 days, not weekly

The auto-pause window is documented as ~7 days of inactivity. A 3-day cadence via `*/3` on day-of-month
has a worst-case gap of ~3-4 days across a month boundary (e.g. day 28/29/30/31 of one month → day 1 of
the next), comfortably inside the 7-day window with real margin for a transient CI failure or delay
before the next scheduled run closes the gap.

## Verified

- The core ping logic (URL/key extraction shape + the actual HTTP call) run directly, outside the
  workflow, against the live project: `curl -H "apikey: <the committed key>" ".../auth/v1/health"`
  returns `200` with `{"version":"...","name":"GoTrue",...}` — confirmed genuinely reachable and correct,
  not assumed.
- `get_advisors(security)` after adding the workflow (CI/ops-only, no schema/RLS change): no new findings.
- **NOT verified, and could not be from this branch:** an actual `workflow_dispatch` run of the committed
  YAML. Attempted (`actions_run_trigger`, ref = this feature branch) and got a `404` — GitHub only
  registers a workflow for manual dispatch once its file exists on the repository's **default** branch
  (`preview` here), regardless of which `ref` the dispatch call targets. This is a real, documented
  GitHub Actions limitation, not a defect in the workflow file — every cron-scheduled trigger has the
  same constraint (a `schedule:` trigger on a non-default branch never fires at all). The YAML itself was
  checked against this repo's own convention (every existing workflow uses the identical bare `on:` key
  a generic YAML 1.1 parser mis-reads as a boolean — a well-known, harmless GitHub Actions non-issue, not
  something specific to this file) and its job structure mirrors `lighthouse-ci.yml`/`engine-parity.yml`
  exactly. Real end-to-end confirmation (the scheduled cron actually firing, or a manual dispatch
  succeeding) can only happen once this lands on `preview` — flagged here rather than glossed over.

## Status

**Active.** Workflow committed to this branch; the underlying health-check call is confirmed live and
correct. The GitHub Actions wrapper itself (schedule registration, manual dispatch) remains unverified
until merged to `preview` — see "Verified" above for exactly why, and don't treat this record as having
closed that gap.
