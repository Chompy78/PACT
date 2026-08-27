# D-GH-2026-08-22-archived-campaign-rpc-enforcement — server-side enforcement that an archived campaign is write-locked

## Context
"An archived campaign is read-only" was enforced only in `tools/DM-Console.html`'s client JavaScript —
scattered `if(window._dmPeekActive && ...) return;` guards in click handlers. No database function or
RLS policy actually rejected a write against an archived campaign, so a direct RPC/REST call (or a future
click-handler refactor that misses one of the several guard sites the client pattern requires
remembering) bypassed the "archived = frozen" invariant entirely. This project's own standing rule is
"RLS is the only real security boundary" — client-side gating is UX only, never a substitute for a
server-side check.

Who can reach this gap: every write path here was already gated on "caller is a DM (or owner) of this
specific campaign" — nobody outside the campaign's own DM/co-DM roster could call any of them regardless
of archive state. So this is not a cross-user privilege escalation (unlike the invitation-system finding
hardened by `D-GH-2026-08-09-harden-invitation-system`) — it's a missing invariant: a DM's own tooling
promises "archived = frozen," and nothing but a client-side `if` made that true.

Because this is a production RLS/RPC change on the same security boundary the invitation-system and
DM-creation-lock work already treats as high-risk, `/make-code-cold-plan-review` was run first per
`AGENTS.md`. The plan went through 5 independent cold reviewers (Claude Sonnet 5, Microsoft Copilot,
GPT-5.6 Luna, M365 Copilot, and a fifth reviewer with a provenance inconsistency worth flagging separately
— its file was named for a `deepseek`-branded relay but self-identified in its own text as "GPT-4"); full
record and reviewer triage in `docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-review.md`.

## Decision
**Scope: seven enumerated write paths**, not the task board's original unscoped "every write path"
wording. Five `SECURITY DEFINER` RPCs (`award_ap`, `award_gold`, `declare_downtime`,
`dm_edit_character_log`, `dm_unbind_character`), plus two RLS policies: `campaigns_update` (the direct
`ignore_player_ap`/`rules` column-grant path) and `characters_delete` — the last one found during this
work's own broader write-surface audit (an exhaustive grep of every `create policy`/`for
update|insert|delete|all`/`grant update|insert|delete` statement across `sql/rls-policies.sql` and every
migration, not just a function-name grep, which is what the original task-board entry's inventory had
relied on). `characters_delete`'s policy let any campaign DM hard-delete a bound character with **no**
archive check at all, more severe than the other six (irreversible) and not named by any reviewer or the
original finding — added to scope for the same "same invariant, same mechanism, belongs in this plan"
reasoning a reviewer gave for a hypothetical eighth path.

**Two names in the task board's original inventory don't exist as RPCs at all.**
`set_ignore_player_ap`/`set_campaign_rules` were presumed function names; they're actually a plain
column-level `grant update (ignore_player_ap, rules) on public.campaigns` plus the `campaigns_update` RLS
policy — there was never a function to patch, only the policy.

**One boolean primitive, not per-call-site re-derivation.** `is_campaign_active(p_campaign)` — fail-closed
by construction (a missing/wrong campaign id returns `false`, not "silently passes"). Two call-site
helpers derive from it: `assert_campaign_active()` for the five RPCs (raises if archived; called
immediately *after* each function's existing `is_campaign_dm()` check, so an unauthorized caller still
gets "only a campaign DM can…" rather than leaking archive state to someone with no access at all) and
`is_campaign_dm_and_active()` for the two RLS policies (composes into a single `USING`/`WITH CHECK`
predicate). Deliberately does **not** modify `is_campaign_dm()` itself — that function also backs several
**read** policies (`campaigns_select`, `campaign_dms_select`, `ap_awards_select`, …) and a DM/co-DM must
still be able to *see* an archived campaign; only write paths gain the extra check.

**Product decision, resolved 2026-08-23 (previously an open question three of five reviewers flagged
independently): block both `dm_unbind_character` and `characters_delete` while archived.** An archived
campaign is meant to be frozen; if a DM genuinely needs to recover or delete a character from one,
`unarchive_campaign()` → the action → `archive_campaign()` already accomplishes that in three calls with
zero new code, so blocking the direct path while archived costs no real capability.

**Concurrency semantics named, not fixed.** The guard is a normal statement-time check under Postgres
MVCC, not a commit-time serialization — a write that begins its check microseconds before a concurrent
`archive_campaign()` commits can still land after archiving. Accepted: both parties in that race are
already DMs of the same campaign (no privilege gap), and the window is a single-statement race, not an
open-ended one.

**Out of scope, deliberately:** `character_dm_notes` (its `for all` policy covers
select+insert+update+delete with one predicate — adding an archive check as-is would also block *reading*
notes on an archived campaign, a real regression; needs a read/write policy split first) and the
invitation subsystem (recently and separately hardened; bundling risks scope creep on the same boundary
in one PR). All five cold reviewers independently agreed both deferrals were correct.

**Rejected alternatives:** modifying `is_campaign_dm()` itself (would silently break "archived = browsable
read-only," not just fix the write gap); a single `before` trigger across tables instead of per-function
checks (can't distinguish "DM Console editing a character in an archived campaign" from "the player's own
client saving their own character normally" without re-deriving campaign-DM-authority logic inside the
trigger anyway — a reviewer floated a cross-table trigger variant but explicitly declined to recommend
it for the same reason); a custom SQLSTATE/errcode for the new exception (this repo has zero precedent
for custom errcodes anywhere in `sql/` — pinned the literal message text in verification instead, matching
how every other RPC here is tested).

Shipped as `sql/migrations/2026-08-22-archived-campaign-write-lockdown.sql`, applied directly to the
production project (no branching capability available on this Supabase project — confirmed via
`list_branches` returning empty — and this repo's established migration workflow is direct-apply, not a
branch-based one), with `sql/rls-policies.sql` updated in the same commit per this file's own established
convention (confirmed against the 2026-08-19 downtime-revision migration, which touched both files
together).

## Why
**Why a fail-closed rewrite of the archive check, when the original form wasn't actually exploitable.**
One reviewer characterized the original `exists(...archived_at is not null)` shape as fail-open and a
must-fix bug. A fresh, independent read of that specific claim against this plan's actual five call sites
(every one presents `assert_campaign_active` with a campaign id an immediately-preceding authority check
already validated) concluded it was **not** exploitable in this plan as scoped — no caller can present it
with an unvalidated id. Adopted the fail-closed rewrite anyway: the query cost is identical, and it closes
a real *future*-maintenance hazard — a function named `is_campaign_active` should mean "exists and is
active," not "not observably archived," so the fail-closed form makes the name and the contract match for
whatever future RPC adopts this helper without also getting the call-ordering right.

**Why verification used direct SQL role-simulation instead of the seeded-review-stack script.** This
environment has no Docker daemon and no Supabase CLI, so `testing/scripts/seed-review-stack.mjs`'s local
mode (its only mode that doesn't require live-mode's explicit `PACT_REVIEW_LIVE=i-understand` +
service-role-key gate) was unavailable. Verified instead with `set local role authenticated; select
set_config('request.jwt.claims', ...)` against the live project — confirmed this genuinely exercises RLS
and grants (not superuser/service_role bypass) by checking `current_user`/`current_setting('role')` before
relying on it. Used two pre-existing accounts that already read as dedicated test/service accounts
(`claude@claude.com`, `delete@test.com`), first confirming neither owned data the test would disturb, and
scoped every fixture row to clearly-tagged `[LOCKDOWN-TEST]` campaigns/characters, all deleted at the end
of the session — chosen over `seed-review-stack.mjs --live` (which would create five new accounts and a
larger seeded world) as the narrower, lower-footprint option sufficient for this specific verification
matrix.

**Why `characters_delete`'s owner-branch was deliberately left able to delete while archived.** Matches
the same principle already established for `characters_update` in this file: "a player's own client
saving/removing their own character must keep working" regardless of a campaign's archive state — only
the DM-authority branch of the policy gained the archive check.

## Status
Migration applied to the production project (`piuprrrnaotrtxucrtsb`) and to `sql/rls-policies.sql` in the
same change. Supabase advisor (`get_advisors`, both `security` and `performance`) shows no new class of
finding versus the pre-existing baseline — the three new functions surface the same
"authenticated-callable SECURITY DEFINER" INFO/WARN every pre-existing RPC in this file already carries
by design (e.g. `archive_campaign` itself), not a new category of issue. `postgres_logs` skimmed for
errors around the migration window: none.

Full fixture-based role/state matrix run directly against production via authenticated-role SQL
simulation (not just `execute_sql`'s default elevated context, which would bypass RLS and prove nothing):
all seven paths verified to succeed pre-archive and post-unarchive, and to reject while archived;
negative-authority-ordering control confirmed (an unauthorized caller gets "only a campaign DM can…", not
the archive message); positive-still-readable control confirmed (the DM can still `select` the archived
campaign); cross-campaign isolation confirmed (a different campaign's DM cannot mutate this one, even by
supplying its own valid DM-of-something-else identity); `unarchive_campaign()` confirmed to restore all
seven paths. All test fixtures (`[LOCKDOWN-TEST]`-tagged campaigns/characters) deleted after verification;
confirmed zero rows remain.

`testing/scripts/engine-parity-ci.mjs`: 65/0 — run as a null control per the plan (this migration touches
no `js/` file, so a clean result confirms no JS regression, not that this fix itself is correct).

`docs/TASK_BOARD_NEXT.md`'s entry graduated to `CHANGELOG.md` in the same change, with "Done when" language
matching this plan's narrower, seven-path scope rather than the original board text's unscoped wording.

**Still not resolved — carried forward as an open item, not claimed complete:** whether the seven-path
inventory is exhaustive. The broader grep this revision ran (every RLS statement and grant, not just a
function-name search) is stronger evidence than the original task-board entry's narrower inventory, and it
is what surfaced `characters_delete` — direct evidence the ask was worth doing, not proof the inventory is
now provably complete. `character_dm_notes` and the invitation subsystem remain deliberately open (see
Decision above) — "archived = fully frozen" is not yet a system-wide invariant, only true for these seven
paths.
