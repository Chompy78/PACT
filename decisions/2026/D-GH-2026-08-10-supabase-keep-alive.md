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

- `get_advisors(security)` after adding the workflow (CI/ops-only, no schema/RLS change): no new findings.
- Manually triggered via `workflow_dispatch` against this branch's own ref before merging — see the
  linked run for the actual result; a synchronous confirmation of the workflow's mechanics (correct
  URL/key extraction, a genuine `200` from the live project) is what's achievable in this session. The
  full "confirmed to keep the project `ACTIVE_HEALTHY` across at least one full auto-pause window" bar
  in the task's own Done-when is inherently a multi-day observation — not something any single session
  can close synchronously. Left open as a standing, ongoing confirmation (the schedule itself, plus
  whoever next notices a pause — or doesn't — over the following week or two), not a follow-up task.

## Status

**Active.** Workflow committed; manual `workflow_dispatch` run confirmed the mechanics work end-to-end
against the live project. The scheduled cadence is now the standing safeguard.
