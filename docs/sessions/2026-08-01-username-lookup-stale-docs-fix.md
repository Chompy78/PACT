# 2026-08-01 — Username lookup, display-name change, and stale-docs cleanup

## What happened

Started as an ad hoc admin question, not a task-board item: "what's my username for
jrc.chow@gmail.com, and what does it have in Supabase?" Queried the PACT Supabase project
(`piuprrrnaotrtxucrtsb`) directly — `auth.users`, `profiles`, `characters`, `campaigns`,
`campaign_dms`, `campaign_invites` — confirmed `display_name = 'john test 001'` and reported
the user's full footprint (5 characters, 4 owned campaigns, 11 invites). User then asked to
change the display name to `'Chompy'`; did so with a direct `update` on `public.profiles`
(DB-only, no app-code change, no CHANGELOG/DECISIONS entry — not a code change).

That led into a `characters.kind` question, which surfaced a real doc-accuracy problem: the
user recalled CharGen and Live Sheet had been aligned onto one save format, but I initially
answered from `AGENTS.md`'s own (stale) claim that "CharGen = a flat build JSON, Live Sheet =
an event log." The user pushed back twice. Verifying against `DECISIONS.md`'s index and the
actual DB row for one of the user's `chargen`-kind characters confirmed the user was right:
D-GH40 (2026-07-10) unified both tools onto one canonical envelope,
`{schema:'pact-character/1', rules, name, LOG, SEQ, id}` — `kind` now only marks which tool a
character opens in, not a different data shape. This is a good example of the project's own
"files win over chat" rule (`AGENTS.md`) working as intended: the DB row and the decisions
record settled it, not my first-pass recollection of `AGENTS.md`'s prose.

Digging further (reading `tools/PACT-CharGen-Webtool.html` directly) turned up a *second*
staleness class: `AGENTS.md`'s High-risk-files bullet, its Architecture MUT-bridging
paragraph, and its "CharGen → Live Sheet export (D-GH3)" bullet all still described
`buildToLiveLog()`/`_lsImportFold` as CharGen's last local `MUT` closures — but a code comment
at the old call site (`tools/PACT-CharGen-Webtool.html:2728`) says plainly: *"D-GH40:
buildToLiveLog()/exportToLiveSheet() removed."* The function is gone, not just superseded.
Fixed all three `AGENTS.md` spots plus the matching `sql/schema.sql` header/column comments
across three commits, opened PR #288 into `preview`, and merged it (squash) on request.

## Why this note exists (per the skill's own criteria)

- **Root cause differed from the initial assumption**: my first answer about the save format
  was itself wrong (repeating `AGENTS.md`'s stale prose) until the user's pushback forced a
  real verification pass.
- **Scope grew organically, not as a nice-to-have**: a one-line admin lookup turned into a
  3-commit, 2-file documentation fix and a merged PR, because each verification step surfaced
  another stale claim.
- **A genuinely useful tooling finding surfaced** (see below) that a future session in this
  environment would want to know before re-attempting the same thing.

## Tooling finding: remote branch deletion is blocked here

After merging PR #288, `git push origin --delete claude/username-verification-jrc-chow-tum6i0`
failed twice with a consistent `HTTP 403` from the local git proxy
(`http://local_proxy@127.0.0.1:41729/git/...`) this session's git commands route through — not
a transient network error, so retrying didn't help. The GitHub MCP server has no ref/branch
deletion tool (only file create/update/delete, which doesn't touch refs) — `merge_pull_request`
worked because it's a distinct API call the proxy/MCP setup does expose, but branch deletion
isn't. Local branch deletion (`git branch -d`) worked fine; only the remote delete is blocked.
**Net effect: in a Claude Code Remote session on this repo, a merged branch can be fully wrapped
up (PR merged, local branch gone) but the remote branch will need manual deletion** (GitHub UI,
or `gh api -X DELETE .../git/refs/heads/<branch>` from a machine with real push credentials).
Told the user this directly rather than claiming completion. Flagged as an `ai-lessons-learned`
candidate in the close-out report — see Part 2 §9 there.

## Status

Merged and closed. Remaining action, not blocking: delete
`origin/claude/username-verification-jrc-chow-tum6i0` manually (safe — fully merged into
`preview`).
