# Plan: server-side enforcement that an archived campaign is write-locked

**v2 — revised after 5-reviewer cold review.** See `## Review outcome` at the end for the full triage.
Supersedes the v1 draft merged as PR #454; this is a same-file revision, not a new plan.

**Decided (2026-08-23):** both open product questions below are resolved — **block both**
`dm_unbind_character` and `characters_delete` while a campaign is archived, per this plan's own
recommendation. No implementation has shipped yet; this only removes the last open decision blocking it.

## Goal
Today, "an archived campaign is read-only" is enforced **only in client JavaScript** (scattered
`if(window._dmPeekActive && ...) return;` guards in one tool's UI). No database function or row-level
security (RLS) policy actually rejects a write against an archived campaign. Make the seven enumerated
DM-write paths below (six covering campaign settings/character state, plus a destructive `characters`
delete path found during this revision) reject the write server-side when the target campaign is
archived — so "archived = read-only" becomes a real invariant *for those paths*, not a UI convention a
stray direct call or a future click-handler refactor could silently bypass.

**Scope correction from v1 (reviewer-driven):** "make every DM-write path reject the write" as originally
worded overclaimed completeness. This plan locks the seven paths enumerated below with high confidence.
Two further known DM-write surfaces — `character_dm_notes` and the invitation subsystem — remain
deliberately open; see **Out of scope** for why. "Archived" is not fully "frozen" system-wide until those
land too; this plan does not claim otherwise.

## Context
This is a static, vanilla-JS tabletop-RPG tool suite with no custom backend — Supabase (hosted Postgres +
auth) is the only backend, reached straight from the browser and protected by row-level security (RLS)
policies and `SECURITY DEFINER` RPC functions. The project's own standing rule is: **"RLS is the only real
security boundary" — client-side gating is UX only, never a substitute for a server-side check.**

A campaign has a nullable `archived_at timestamptz` column (soft-delete/undo, owner-reversible via a
dedicated `unarchive_campaign()` function). Today, archiving a campaign changes nothing about what any
existing database function or RLS policy will accept — it only changes what the DM Console's own UI
chooses to show/allow while a DM is "peeking" an archived campaign.

**Who can actually reach this gap.** Every write path this plan covers is already gated on "caller is a
DM (or the owner) of this specific campaign" — nobody outside the campaign's own DM/co-DM roster can call
any of them regardless of archive state. So this is not a cross-user privilege-escalation bug (unlike the
project's earlier, higher-severity invitation-system finding) — it's a missing invariant: a DM's own
tooling promises "archived = frozen," and nothing but a client-side `if` currently makes that true.

## Assumptions vs. verified facts

**Verified (read directly from the current `sql/` tree, including a broader second-pass inventory run
during this revision — not assumed):**
- `campaigns.archived_at` exists (`sql/schema.sql`); `archive_campaign(p_campaign)` /
  `unarchive_campaign(p_campaign)` are the only two functions that write it, both gated
  `is_campaign_owner()` (owner-only, not "any DM").
- The task board named **five** write paths as its presumed complete set (v1 miscounted this as "four" in
  its own narrative — a copy error, now fixed): `award_ap`, `dm_edit_character_log`,
  `set_ignore_player_ap`, `declare_downtime`, `set_campaign_rules`. **Two of those five names don't exist
  as RPCs at all** — `ignore_player_ap` and `rules` are plain columns on `campaigns`, writable directly by
  any authenticated DM through a column-level `grant update (ignore_player_ap, rules) on public.campaigns`
  (confirmed the *only* `grant update` statement targeting `campaigns` anywhere in `sql/` — an exhaustive
  grep, not a spot check) plus the `campaigns_update` RLS policy (`using (is_campaign_dm(id)) with check
  (is_campaign_dm(id))`) — there is no `set_ignore_player_ap`/`set_campaign_rules` function to patch.
- A fuller inventory of `is_campaign_dm()`/`is_campaign_owner()`-gated write paths touching campaign or
  character state, built from an exhaustive grep of every `create policy`, `for update|insert|delete|all`,
  and `grant update|insert|delete` statement across `sql/rls-policies.sql` and every file in
  `sql/migrations/` (not just a function-name grep, which was v1's narrower method) — none of these
  currently check `archived_at`:
  - `award_ap(p_character, p_amount, p_note)` — any DM; grants AP.
  - `award_gold(p_character, p_gold, p_note)` — any DM; grants gold. (Its predecessor `award_wealth()`,
    which also granted downtime days, was already dropped and replaced by `award_gold` +
    `declare_downtime` in a prior migration — not a live surface to patch.)
  - `declare_downtime(p_campaign, p_days, p_character, p_note)` — any DM; grants downtime.
  - `dm_edit_character_log(p_character, p_events)` — any DM; corrective LOG edits (boon/drawback/award
    entries).
  - `dm_unbind_character(p_character)` — any DM; the only path that clears a character's `campaign_id`.
  - `campaigns_update` RLS policy — any DM; the direct-column path for `ignore_player_ap`/`rules`
    described above.
  - **`characters_delete` RLS policy — new in this revision, not in v1 or named explicitly by any
    reviewer, though four of five reviewers asked "is there a direct write path on `characters`?" which
    this broader inventory pass was run to answer.** The policy reads
    `for delete using (owner_id = auth.uid() or is_campaign_dm(campaign_id));` — any campaign DM can
    **hard-delete** a bound character row directly, with no archive check, no RPC involved at all. This is
    more severe than the other six (irreversible), and per the same reasoning Reviewer 2 (Copilot) gave
    for why a newly-discovered path belongs in this plan rather than a deferred one ("same invariant, same
    mechanism, deferring would ship a half-invariant"), it's added to this plan's scope — see Proposed
    approach step 3b.
- **The "no direct DM-write path on `characters` via UPDATE" concern four of five reviewers raised is now
  verified, not assumed.** `characters_update` is the only UPDATE policy on `characters`
  (`for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())`) — owner-only, no
  `is_campaign_dm()` clause. Every `grant update (...)` on `characters` (`name, kind, stats`;
  `archived_at`; `autosave_enabled`) is gated by this same single policy, so none of them give a DM a
  direct write path — only the character's own owner, or the five `SECURITY DEFINER` RPCs (which bypass
  RLS as definer functions), can reach these columns. `characters_insert` is likewise owner-only.
- **`ap_awards`, `gold_awards`, `campaign_downtime_declarations`, and `campaign_dms` are `select`-only
  grants** (`-- writes via RPCs only` / `-- inserts via award_ap only` etc., stated in their own grant
  comments and confirmed by the exhaustive grant grep) — no direct-write surface on any of them.
- **This repo has an established, previously-dedicated-migration convention of explicit
  `revoke execute ... from public` + `grant execute ... to authenticated` for every `SECURITY DEFINER`
  function**, including simple boolean helpers like `is_campaign_dm()`/`is_campaign_owner()` themselves —
  confirmed via `sql/migrations/2026-07-10-lock-down-remaining-function-grants.sql`, a migration whose
  entire purpose was closing this exact class of gap for functions that predated the convention. v1's
  migration-approach text ("grants restated where the file's own convention already does that for touched
  objects") didn't actually spell this out for the two new helper functions — see Proposed approach step 4.
- **This repo's current canonical `search_path` convention for `SECURITY DEFINER` functions is
  `set search_path = public, pg_temp`** (both `language sql` and `language plpgsql`), confirmed against
  `sql/rls-policies.sql`'s current function definitions — an early migration
  (`2026-06-29-codm-ap-ledger.sql`) used just `public` without `pg_temp`, which is exactly what a later,
  dedicated fix migration (`2026-07-16-fix-gen-random-bytes-search-path.sql`) corrected. v1's own two new
  functions were inconsistent with each other on this (see Proposed approach step 4).
- **No existing precedent for custom SQLSTATE/errcode in this repo** — every `raise exception` across
  `sql/` uses a plain message string with no `using errcode = ...` clause anywhere. A reviewer suggestion
  to add one for this migration is addressed under Review outcome (rejected, with reasoning).

**Decided, not merely assumed (2026-08-23):**
- **`dm_unbind_character` is blocked on an archived campaign.** Three of five reviewers independently
  flagged this as a real product decision, not something to leave implicit; this plan recommended blocking
  it, and that recommendation is now the decision. An archived campaign is meant to be frozen; if a DM
  genuinely needs to recover a character from one, `unarchive_campaign()` → `dm_unbind_character()` →
  `archive_campaign()` already accomplishes that in three calls with zero new code, so blocking the direct
  path while archived costs no real capability.
- **`characters_delete` is blocked on an archived campaign** (the newly-found path above) — same shape of
  question as `dm_unbind_character`, same reasoning: unarchive first if a deletion is genuinely needed.

**Still assumed, not yet verified — flagged as an explicit open item:**
- **That no *other* write path exists beyond the seven enumerated above.** This revision's broader
  grep (every `create policy`/`for update|insert|delete|all`/`grant update|insert|delete` statement, not
  just a function-name search) is stronger evidence than v1's narrower pass, and it is what surfaced
  `characters_delete` — but it is still a grep, not a formal proof. A second pass immediately before
  writing the migration should re-run it, and should additionally check: triggers on the affected tables:
  none found matching a DM-write pattern (`pact_enforce_locked_history`/`pact_enforce_ap_budget_consistency`
  are integrity triggers, not DM-write paths, and don't reference `is_campaign_dm`); functions calling
  another mutating function without containing the mutation directly, which a body-text grep for
  `is_campaign_dm(` would miss.

## Proposed approach
1. **One boolean primitive, not two independent re-derivations of "archived."** v1 shipped two functions
   (`assert_campaign_active`, `is_campaign_dm_and_active`) that each separately embedded
   `archived_at is null`/`is not null` — the exact duplication v1's own step-1 rationale ("one guard, not
   six inline copies") argued against, just applied inconsistently to itself. Three of five reviewers
   flagged this independently; fix:
   ```sql
   create or replace function public.is_campaign_active(p_campaign uuid)
   returns boolean language sql security definer stable set search_path = public, pg_temp as $$
     select exists (select 1 from campaigns where id = p_campaign and archived_at is null);
   $$;
   ```
   **Fail-closed by construction** (requires an existing, active row — a missing/wrong id returns `false`,
   not "silently passes"). A cold-review finding argued the original `exists(...archived_at is not null)`
   form was fail-open and a must-fix security bug; a fresh independent read of that specific claim against
   this plan's actual call sites (where the campaign id is always either pulled straight off a
   just-selected row, or the same value an immediately-preceding authority check already validated)
   concluded it was **not an exploitable hole in this plan as scoped** — no caller can present
   `assert_campaign_active` with an unvalidated id, because the authority check always runs first against
   the same value. It's adopted anyway because the rewrite is free (identical query cost) and closes a real
   *future*-maintenance hazard: a function named `is_campaign_active` should mean "exists and is active,"
   not "not observably archived" — the fail-closed form makes the name and the contract match, and protects
   a future RPC that adopts this helper without also getting the ordering right.

2. **The two call-site helpers now both derive from that one primitive:**
   ```sql
   create or replace function public.assert_campaign_active(p_campaign uuid)
   returns void language plpgsql security definer stable set search_path = public, pg_temp as $$
   begin
     if not is_campaign_active(p_campaign) then
       raise exception 'This campaign is archived and read-only';
     end if;
   end;
   $$;

   create or replace function public.is_campaign_dm_and_active(p_campaign uuid)
   returns boolean language sql security definer stable set search_path = public, pg_temp as $$
     select is_campaign_dm(p_campaign) and is_campaign_active(p_campaign);
   $$;
   ```
   Both new functions now share the identical `set search_path = public, pg_temp` (v1 had them
   inconsistent — `is_campaign_dm_and_active` was missing `pg_temp`, against this repo's current
   convention).

3. **Call `assert_campaign_active` from each of the five RPCs**, immediately after each function's
   existing `is_campaign_dm(...)` authority check (so an unauthorized caller still gets "only a campaign DM
   can…" rather than leaking archive state to someone with no access at all): `award_ap`, `award_gold`,
   `declare_downtime`, `dm_edit_character_log`, `dm_unbind_character`. Each of these already resolves a
   `v_campaign`/`p_campaign` variable before its authority check, so the added line is
   `perform assert_campaign_active(v_campaign);` (or `p_campaign` for `declare_downtime`) — no other
   change to any of the five function bodies.

3b. **New in this revision: tighten `characters_delete` the same way.** Current policy:
    `for delete using (owner_id = auth.uid() or is_campaign_dm(campaign_id));`. New policy:
    `for delete using (owner_id = auth.uid() or is_campaign_dm_and_active(campaign_id));` — the owner's own
    delete path is untouched (matches the "a player's own client saving/removing their own character must
    keep working" principle already established for `characters_update`); only the DM-authority branch
    gains the archive check, reusing the same helper from step 2 rather than adding a third one.

4. **Tighten the `campaigns_update` RLS policy** that gates the direct `ignore_player_ap`/`rules` column
   writes, using the step-2 helper: `drop policy if exists campaigns_update on public.campaigns;` (matching
   this file's own existing `drop policy if exists` convention throughout `sql/rls-policies.sql` — not a
   new pattern) then recreate with
   `using (is_campaign_dm_and_active(id)) with check (is_campaign_dm_and_active(id))`. This deliberately
   does **not** touch `is_campaign_dm()` itself — that function is also the predicate behind several
   **read** policies (`campaigns_select`, `campaign_dms_select`, `ap_awards_select`, …), and a DM/co-DM
   must still be able to *see* an archived campaign; only write policies need the extra clause.

5. **Explicit grants on both new functions — not implicit, not deferred to "the file's convention."**
   Postgres grants `EXECUTE` to `PUBLIC` by default on function creation; this repo has a standing,
   previously-dedicated-migration-enforced convention of never relying on that default. The migration must
   include, for both `is_campaign_active` and `assert_campaign_active` and `is_campaign_dm_and_active`:
   ```sql
   revoke execute on function public.is_campaign_active(uuid)      from public;
   revoke execute on function public.assert_campaign_active(uuid)  from public;
   revoke execute on function public.is_campaign_dm_and_active(uuid) from public;
   grant  execute on function public.is_campaign_active(uuid)      to authenticated;
   grant  execute on function public.assert_campaign_active(uuid)  to authenticated;
   grant  execute on function public.is_campaign_dm_and_active(uuid) to authenticated;
   ```
   (`is_campaign_dm_and_active` must be directly callable by `authenticated`, since it's evaluated in the
   querying role's context as an RLS predicate — leaving this only-`PUBLIC`-by-default would itself be a
   grant-drift bug of exactly the kind this project has been bitten by twice before, per its own history.)

6. **Do not touch `archive_campaign`/`unarchive_campaign`** — they must keep working on an archived
   campaign (that's the only way to un-archive one), and they're already owner-only, a stricter gate than
   anything this plan adds.

7. **Concurrency semantics — name it, don't leave it implicit.** Three of five reviewers asked for this.
   Decision: the guard is a normal statement-time check under Postgres MVCC, not a commit-time
   serialization — a write that begins its check microseconds before a concurrent `archive_campaign()`
   commits can still land after archiving. This is accepted, not fixed: both parties in that race are
   already DMs of the same campaign (no privilege gap), the window is a single-statement race, not an
   open-ended one, and adding `select ... for share` to serialize against archival would add real
   complexity for a benefit this project doesn't need today. State this explicitly in the migration's
   comments so a future reader doesn't mistake "checked before mutation" for "no write can ever commit
   after archiving."

8. Ship as one new migration file, `sql/migrations/2026-08-22-archived-campaign-write-lockdown.sql`,
   following this repo's existing migration convention (one dated file per change, `create or replace
   function` for every touched function so it's safely re-runnable, `drop policy if exists` before every
   recreated policy).

## Files involved
- New: `sql/migrations/2026-08-22-archived-campaign-write-lockdown.sql` (the migration itself).
- Reference only, not edited: `sql/schema.sql` (the accumulated-schema snapshot — this repo's convention,
  confirmed by reading its own recent migrations, is that `schema.sql` is regenerated/kept in sync
  separately, not hand-edited per migration; verify this convention still holds before assuming it,
  since the plan author did not find an explicit statement of it, only that every recent migration file
  stands alone).
- `docs/TASK_BOARD_NEXT.md` — remove the "Archived campaign is read-only…" entry once shipped, per this
  project's own "graduate to CHANGELOG.md when done" rule.
- `CHANGELOG.md` / `DECISIONS.md` — one line and one decision record respectively, per this project's
  per-change checklist (the *why* here — RLS as the only real boundary, the two-name correction to the
  original task-board inventory, and the `characters_delete` discovery — is exactly the kind of non-obvious
  reasoning that rule asks for).

## Out of scope
- `character_dm_notes` archived-write locking (needs a read/write policy split first — its `for all` policy
  currently covers select+insert+update+delete with one predicate, and adding an archive check to it as-is
  would also block a DM from *reading* notes on an archived campaign — a real regression, not just an
  incomplete fix. Separate change.) — all five reviewers independently agreed this deferral is correct.
- The invitation subsystem's archived-write locking (recently and separately hardened via
  `D-GH-2026-08-09-harden-invitation-system`; bundling risks scope creep on the same security boundary in
  one PR). All five reviewers independently agreed this deferral is correct, several naming it as the
  stronger of the two reasons.
- Any client-side change to `tools/DM-Console.html`. Its existing `_dmPeekActive`-style guards already
  produce the correct UX (blocking the button before a request is even sent) — this plan only adds the
  server-side backstop behind them.
- Extending the new helpers to any function not enumerated in Proposed approach — a future write RPC
  adopting the same guard is a one-line follow-up, not part of this migration.
- A custom SQLSTATE/errcode for the new exception (a cold-review suggestion). Rejected: this repo has zero
  precedent for custom errcodes anywhere in `sql/` — every existing RPC uses a plain message string, and
  introducing a new error-handling convention in this one migration would itself be an inconsistency, not a
  hardening. Pin the literal message text in Verification instead (matches how every other RPC in this repo
  is already tested).

## Alternatives considered
- **Modify `is_campaign_dm()` itself to exclude archived campaigns.** Rejected: that function backs
  several *read* policies too, and a DM must still be able to browse an archived campaign — only its
  writes should be blocked. Changing the shared read/write predicate would silently break "archived =
  browsable read-only," not just fix the write gap. (All five reviewers independently agreed this
  rejection was correct.)
- **A single `before` trigger on `campaigns`/`characters` instead of per-function checks.** Considered
  more DRY in theory, but a trigger can't distinguish "the DM Console editing a character in an archived
  campaign" (should be blocked) from "the player's own client saving their own character normally"
  (`characters_update`'s existing `owner_id = auth.uid()` path, unrelated to archive state and must keep
  working) without re-deriving campaign-DM-authority logic inside the trigger anyway. One reviewer floated
  a variant (a trigger providing a hard backstop across every table regardless of RPC/route) but explicitly
  declined to recommend it for the same reason — the administrative-vs-player-write distinction isn't
  cleanly available at the trigger layer without reconstructing the RPC-layer logic anyway.

## Risks
- **Damage scale if wrong: high.** This is a production RLS/RPC change on the security boundary the
  project's own `AGENTS.md` calls out as high-risk, and this project has been bitten by RLS/grant drift
  before (its own history names two prior incidents this exact class of change has caused — one of which,
  `2026-07-10-lock-down-remaining-function-grants.sql`, was specifically about the "new function, forgot
  to lock down its default grants" mistake this revision's step 5 now explicitly guards against).
- **Damage likelihood: low–medium.** The mechanism itself is narrow (an added existence check via a
  fail-closed boolean primitive, not a changed authority model), and the Supabase advisor plus a direct
  signed-in RPC test (not just the UI) should catch a shape mistake before merge.
- **Main risk is scope, not mechanism.** The single highest-risk decision in this plan is *what counts as
  in scope* (the seven enumerated write paths) versus what's deliberately deferred (`character_dm_notes`,
  the invitation subsystem). Getting that boundary wrong either direction — silently missing an eighth
  write path, or scope-creeping into the invitation subsystem's very recent hardening — is more likely to
  cause a problem here than the SQL itself being wrong. (This revision's broader inventory pass already
  found one path v1 missed — `characters_delete` — which is direct evidence this risk is real, not
  theoretical.)
- **Concurrency race, named and accepted, not fixed** — see Proposed approach step 7. Not treated as a
  blocking risk: both parties in the race window are already DMs of the same campaign, so there's no
  privilege gap, only a benign ordering ambiguity.

## Verification
A fixture-based role/state matrix, not just "call it and see" — three reviewers asked for this explicitly,
and it's the single biggest verification gap in v1.

**Setup:** one campaign with a bound character; one owner user (also a DM); one co-DM user; one
unauthorized (non-DM) authenticated user; one *other* campaign B with its own DM, to test cross-campaign
isolation.

1. Apply the migration to a Supabase branch/project, then run `get_advisors` (security lints) and skim
   `get_logs` — this project's own checklist step 4 requires this after any migration/RLS change, and it
   has caught real grant/RLS drift for free twice before. Record the advisor's pre-migration baseline too,
   so "no new findings" is a measured diff, not a memory-based claim.
2. **Before archiving**, confirm all seven write paths succeed normally for the DM (regression check that
   nothing broke for the common case).
3. Archive the campaign, then **directly** (via `supabase.rpc(...)`/`supabase.from(...)`, bypassing DM
   Console's client-side guards entirely — the task's own done-when criterion) as the DM confirm all seven
   are rejected: `award_ap`, `award_gold`, `declare_downtime`, `dm_edit_character_log`,
   `dm_unbind_character`, `dm_delete` via `characters` delete, and a direct
   `supabase.from('campaigns').update({ignore_player_ap: true})` **and** a second update targeting `rules`
   specifically (both columns the same policy covers — v1 only tested one). Pin the expected exception text
   to `assert_campaign_active`'s literal message for the five RPCs; for the two RLS paths, confirm either an
   error or a zero-row update result (RLS denial doesn't always raise — it can silently affect zero rows —
   so check the actual row/response, not just "no exception").
4. **Negative control on ordering** (a design intention v1 asserted but never tested): the unauthorized
   user, against the same archived campaign, gets the *authority* error ("only a campaign DM can…"), not
   the *archived* error — confirming the check order doesn't leak archive state to a non-DM.
5. **Positive control on the deliberately-untouched path**: the DM (or co-DM) can still `select` the
   archived campaign and its data after the migration — this is the entire reason `is_campaign_dm()` itself
   was left unmodified, and it should be positively verified, not just assumed from the code review.
6. **Cross-campaign isolation**: campaign B's DM cannot mutate anything in the archived campaign by
   supplying its ids — confirms the guard is keyed on the correct campaign, not just "caller is *a* DM
   somewhere."
7. Confirm `unarchive_campaign()` still succeeds against the archived campaign, then re-run steps 2–3
   against the now-unarchived campaign and confirm all seven paths succeed again (proves the check is
   archive-state-conditional, not a blanket regression).
8. This plan touches no `js/` file, so `testing/tests/engine-parity.html` is not expected to be affected.
   Run it once anyway as a **null control** — a 0-failed result confirms "no JS regressed," not that this
   fix itself is correct; label it as such in the PR rather than counting it toward "verified."

## Done when
All seven enumerated write paths (five RPCs, the `campaigns_update` RLS policy, and the `characters_delete`
RLS policy) reject a write against an archived campaign, verified by direct signed-in calls bypassing the
client UI, including the negative-authority-ordering and positive-still-readable controls above; the
Supabase advisor shows no new findings versus its pre-migration baseline; `unarchive_campaign()` still
works and re-enables all seven paths afterward; the `dm_unbind_character`-while-archived and
`characters_delete`-while-archived product questions are implemented per the 2026-08-23 decision above
(block both);
`docs/TASK_BOARD_NEXT.md`'s entry is graduated to `CHANGELOG.md`/`DECISIONS.md` in the same change, with
the "Done when" language matching this plan's now-narrower, seven-path goal rather than the original
board text's unscoped "every write path" wording.

---

## Review outcome

**Cold-reviewed by 5 independent reviewers** (files in the `zcold` branch's `z-cold/`, dated 2026-08-23):
Claude Sonnet 5, Microsoft Copilot (Claude Opus 4.8 base), GPT-5.6 Luna, M365 Copilot (GPT-5 reasoning),
and a fifth reviewer whose file was named for a `deepseek`-branded relay but which self-identified in its
own text as "GPT-4" — noted here as a data-provenance inconsistency worth flagging back to whichever local
tool produced that file, not something this triage could resolve from the review text alone.

**Convergence.** All five independently reached the same verdict on the two biggest structural questions:
(a) the scope boundary (six/now-seven core paths together, `character_dm_notes` and the invitation
subsystem deferred) is correct and should not be split further; (b) rejecting a modified `is_campaign_dm()`
and rejecting a blanket trigger were both the right calls, for the right reasons. Both are unchanged in v2.

**Findings accepted and applied in this revision:**
- Collapse the duplicated archived-predicate logic into one `is_campaign_active()` primitive (3 of 5
  reviewers) — Proposed approach steps 1–2.
- Explicit `revoke`/`grant execute` on the new helper functions, matching this repo's own established,
  previously-dedicated-migration-enforced convention (verified, not just asserted, via
  `2026-07-10-lock-down-remaining-function-grants.sql`) — step 5.
- Consistent `search_path = public, pg_temp` across both new functions (verified against current repo
  convention) — step 2.
- Fail-closed rewrite of the archive check (adopted for free, cost-neutral defense-in-depth — see the
  severity note below) — step 1.
- Elevate `dm_unbind_character`-while-archived from a silent assumption to an explicit open decision with a
  stated recommendation (3 of 5 reviewers) — Assumed section + Done when.
- Expand Verification into a fixture-based role/state matrix: negative authority-ordering control,
  positive still-readable control, cross-campaign isolation, both `campaigns_update` columns tested (not
  just one), advisor baseline diff, RLS zero-row-vs-exception handling (multiple reviewers, especially
  GPT-5.6 Luna's explicit matrix and M365 Copilot's fixture list).
- Narrow the Goal/Done-when wording to the actually-covered paths rather than the unscoped "every DM-write
  path" phrasing (all 5 reviewers, independently).
- Fix the "four vs. five" miscount in the task-board-inventory narrative (Copilot).
- Label the `engine-parity.html` step explicitly as a null control (Copilot).

**Found independently during this revision's verification pass (not named by any reviewer, though four of
five were asking the adjacent question "is there a direct `characters`-table write path?"):** the
`characters_delete` RLS policy lets any campaign DM hard-delete a bound character with no archive check —
added to scope as step 3b, per the same "same invariant, same mechanism, belongs in this plan" logic
Copilot itself argued for a hypothetical eighth path.

**Findings verified-but-reclassified rather than blindly accepted:**
- The "fail-open" framing of the original `assert_campaign_active` (one reviewer's "must-fix security
  bug"). A fresh, independent, disinterested read of this specific claim against the plan's actual five
  call sites (Claude Sonnet 5, no prior context, prompted with only the finding and the relevant SQL
  excerpt) concluded: **not exploitable in this plan as scoped** — every call site presents
  `assert_campaign_active` with a campaign id that an immediately-preceding authority check already
  validated, so the "wrong/nonexistent id" scenario the reviewer described cannot occur through any path
  this plan actually wires up. The fail-closed rewrite is adopted anyway (cost-neutral, closes a real
  future-maintainer hazard), but the risk section does **not** claim this was a live security hole in v1 —
  it wasn't, and overstating it would misrepresent the actual severity to whoever implements this next.
  The other three reviewers who touched this same behavior characterized it more accurately ("probably
  safe given the existing check," "a brittle contract worth deciding explicitly").
- The full completeness of the write-surface inventory. Multiple reviewers asked for a broader, more
  systematic pass (all RLS policies/grants, not just a function-name grep) before this could be trusted;
  that broader pass was run as part of this revision (see Verified section) and is what surfaced
  `characters_delete` — direct evidence the ask was worth doing, and direct evidence the *result* is now
  stronger, not that the inventory is now provably complete. The "second pass before writing the migration"
  caveat in Assumed remains, appropriately.

**Findings rejected, with reasoning:**
- A custom SQLSTATE/errcode for the new exception. This repo has zero precedent for custom errcodes
  anywhere in `sql/` — adopting one here would be a new, unprecedented convention for this one migration,
  not a hardening consistent with the rest of the codebase. Pin the literal message text instead, matching
  how every other RPC in this repo is already tested.
- Splitting this plan into multiple smaller plans. All five reviewers explicitly rejected this; unchanged.

**Resolved since this revision was first drafted:**
- The `dm_unbind_character`-while-archived and `characters_delete`-while-archived product decisions — both
  **decided 2026-08-23: block both**, per this plan's own recommendation. See the top of this document.

**Still not resolved — carried forward as an open item:**
- Whether `sql/schema.sql` genuinely never needs a matching hand-edit per migration (flagged as unverified
  in v1's Files involved section; still unverified — no reviewer addressed this, and it wasn't re-checked
  in this revision since it's a process question, not a security one).

**Processing note:** the 5 reviewer files and the plan copy they reviewed live in the `zcold` branch's
`z-cold/` folder (external local-sync mechanism, not part of this repo's own git history on `preview`) —
this repo has no established `z-cold/processed/` convention of its own to move them into, unlike some other
projects using this same review skill. No action taken on that branch from here; flagging for the user in
case they want those 6 files relocated on their end.
