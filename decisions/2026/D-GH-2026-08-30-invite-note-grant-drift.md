# D-GH-2026-08-30-invite-note-grant-drift — `campaign_invites`'s column-scoped grant was missing its own documented revoke

Status: Active

## Context

`testing/scripts/cloud-e2e.mjs`'s "invite note is DM-only" check — which asserts a player's
`supabase.from('campaign_invites').select('note')` is refused — started failing deterministically in CI
(PR #472, unrelated DM Console UI PR; two consecutive runs, same result both times, ruling out a flake).

`sql/rls-policies.sql`'s `campaign_invites` section has carried this comment since
D-GH-2026-08-03-invite-note-dm-only: *"a column-level revoke cannot subtract from a table-level grant —
the blanket grant is dropped and the wanted columns granted explicitly."* But no `revoke` statement was
actually present anywhere in the file (or in `sql/migrations/2026-08-09-harden-invitation-system.sql`,
which carries the same column-scoped `grant select (...)` with the same "every column except note and
token_hash" comment, also with no preceding revoke) — only the column-scoped `grant select (id, ...)`
ran. The comment described the intended fix; the SQL never executed it.

**Verified this is not a live production vulnerability.** Queried the production database directly:

```sql
select grantee, privilege_type, column_name from information_schema.column_privileges
where table_schema='public' and table_name='campaign_invites' and grantee='authenticated';
```

`note` and `token_hash` carry `REFERENCES` only — no `SELECT` — for `authenticated`. The Supabase security
advisor shows no finding for this table either. Production is safe today.

**Why CI fails anyway.** Checked `pg_default_acl` on production: the `postgres` role's default ACL for
new tables grants `authenticated`/`anon` only `Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) — no `r`
(SELECT). Whatever role actually built production's schema over its migration history inherited that
narrow default, so the column-scoped grant was the *only* SELECT `authenticated` ever got — correctly
excluding `note`/`token_hash`. But `pg_default_acl` is per-role, and `cloud-e2e.mjs`'s throwaway local
Supabase CLI stack builds `campaign_invites` fresh from `sql/schema.sql` + `sql/rls-policies.sql` under
whatever role that stack's initialization uses — which, empirically, ends up with a broader default and
picks up a table-level SELECT the column-scoped grant then only *adds to*, never replaces. Production's
safety was incidental (which role happened to run its migrations), not something this file's SQL actually
guaranteed — exactly the gap the file's own comment claimed was closed.

## Decision

Add the missing `revoke select on public.campaign_invites from authenticated, anon;` immediately before
the column-scoped grant, in both:
- `sql/rls-policies.sql` (the reference file `cloud-e2e.mjs`, any disaster-recovery rebuild, and any new
  environment build from) — durable fix, makes the restriction hold regardless of ambient default
  privileges.
- `sql/migrations/2026-08-30-invite-note-grant-drift.sql` — a no-op on current production (the privilege
  it revokes isn't held there), applied only so production's migration history matches the reference file
  for a table that's already live; not itself required for a production fix, since production wasn't
  vulnerable.

`anon` is included alongside `authenticated`, even though only `authenticated` ever appears in this
table's grants — the same default-ACL mechanism could just as easily hand `anon` a table-level SELECT on
a differently-provisioned stack, and RLS is not a substitute for the grant being correct in the first
place (`campaign_invites_select`'s policy only checks `is_campaign_dm()`/`redeemed_by`, both of which
require `auth.uid()`, so `anon` was never meant to read this table at all).

Rejected: leaving the comment as the only documentation of intent and treating this purely as a CI/test
gap. The comment already asserted the revoke existed; the actual security guarantee for this table has
been "true by accident of which role built production," which is precisely the class of grant/RLS drift
this project has been bitten by three times now (D-GH15, D-GH12, and this one) — worth closing for real,
not just re-noting.

## Verification

- `information_schema.column_privileges` against production (piuprrrnaotrtxucrtsb), queried directly:
  `note`/`token_hash` carry no `SELECT` for `authenticated` — confirms no live leak, before this change.
- `pg_default_acl` against production: confirms the `postgres`-role default ACL for new tables excludes
  `SELECT` for `authenticated`/`anon`, explaining why production's column-scoped-only grant was
  incidentally sufficient there.
- `get_advisors` (security) against production: no finding for `campaign_invites`.
- `cloud-e2e`'s failing job (PR #472, run 33287430246) re-run once: failed identically both times
  ("1 of 33 checks FAILED... player selecting note is refused — LEAKED"), ruling out a timing flake and
  confirming the leak reproduces deterministically on a fresh stack.
- Could not run `testing/scripts/cloud-e2e.mjs` locally against this fix before opening the PR — no
  Docker daemon available in this session. The fix is intentionally the exact pattern
  D-GH-2026-08-03-invite-note-dm-only already documented and verified once (table-level revoke before a
  column-scoped grant); CI (`cloud-e2e`, on this PR) is the verification for the fix landing.
- This migration was **not** applied to the live production database from this session — it is a no-op
  there and does not need to ship urgently, so it goes through the project's normal deploy process rather
  than being pushed live directly from an AI session on request scoped to "open a fix PR."

## Follow-up (not done here)

Whether the same default-ACL-vs-explicit-grant gap exists on any other table with a column-scoped grant
in `sql/rls-policies.sql` was not audited — this fix is scoped to the one table `cloud-e2e` actually
caught. Worth a NEXT-item sweep if this pattern turns out to repeat.
