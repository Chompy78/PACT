# Plan: server-side enforcement that an archived campaign is write-locked

## Goal
Today, "an archived campaign is read-only" is enforced **only in client JavaScript** (scattered
`if(window._dmPeekActive && ...) return;` guards in one tool's UI). No database function or row-level
security (RLS) policy actually rejects a write against an archived campaign. Make every DM-write path
that can mutate campaign settings or a bound character's state reject the write server-side when the
target campaign is archived — so "archived = read-only" becomes a real invariant, not a UI convention
that a stray direct call or a future click-handler refactor could silently bypass.

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

**Verified (read directly from the current `sql/` tree in this session, not assumed):**
- `campaigns.archived_at` exists (`sql/schema.sql`); `archive_campaign(p_campaign)` /
  `unarchive_campaign(p_campaign)` are the only two functions that write it, both gated
  `is_campaign_owner()` (owner-only, not "any DM").
- The task board named four write paths as the presumed complete set: `award_ap`, `dm_edit_character_log`,
  `set_ignore_player_ap`, `declare_downtime`, `set_campaign_rules`. **Two of those five names don't exist
  as RPCs at all** — `ignore_player_ap` and `rules` are plain columns on `campaigns`, writable directly by
  any authenticated DM through a column-level `grant update (ignore_player_ap, rules) on public.campaigns`
  plus the `campaigns_update` RLS policy (`using (is_campaign_dm(id)) with check (is_campaign_dm(id))`) —
  there is no `set_ignore_player_ap`/`set_campaign_rules` function to patch. This is a genuine correction
  to the task-board text's own inventory, not an assumption — it changes the fix mechanism for those two
  settings from "add a check inside an RPC body" to "tighten an RLS policy predicate."
- A fuller inventory of `is_campaign_dm()`/`is_campaign_owner()`-gated write paths touching campaign or
  character state, none of which currently check `archived_at`:
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
- Two further write surfaces exist under the same `is_campaign_dm()`-style gating and are **not**
  currently archived-aware either, but are treated as **out of scope** below with reasoning, not silently
  dropped:
  - `character_dm_notes` — a `for all` RLS policy (one predicate covers select+insert+update+delete), so
    adding an archived check would also block a DM from *reading* notes on an archived campaign unless the
    policy is first split into separate read/write policies — a policy-shape change beyond this fix's
    scope.
  - The invitation subsystem (`create_dm_invite`, `create_player_invite`, `set_invite_revoked`,
    `list_campaign_invites`, `regenerate_invite_code`, `promote_to_dm`, `remove_dm`) — all `is_campaign_dm`
    or `is_campaign_owner` gated, none archived-aware. This subsystem had its own dedicated hardening pass
    very recently (`D-GH-2026-08-09-harden-invitation-system`); bundling a second security-relevant change
    into the same functions in this PR risks exactly the kind of scope creep this project's own process
    flags as the reason to run a cold review in the first place.

**Assumed, not yet verified — flag to the reviewer:**
- That blocking `dm_unbind_character` on an archived campaign has no legitimate use case. It seems right
  (an archived campaign is meant to be frozen, and "remove a character from it" is a mutation like any
  other) but hasn't been confirmed against any documented workflow.
- That no other write path exists beyond the six enumerated above. The task board's own text warned "don't
  assume the four named are the complete list" — this plan found six, via a targeted grep across
  `sql/schema.sql` and every file in `sql/migrations/` for `create or replace function public.` combined
  with `is_campaign_dm(`/`is_campaign_owner(`, not an exhaustive manual read of every migration — a second
  pass immediately before writing the migration should re-run that grep in case a file was added since.

## Proposed approach
1. **One reusable guard function**, not six inline copies of the same check:
   ```sql
   create or replace function public.assert_campaign_active(p_campaign uuid)
   returns void language plpgsql security definer stable set search_path = public, pg_temp as $$
   begin
     if exists (select 1 from campaigns where id = p_campaign and archived_at is not null) then
       raise exception 'This campaign is archived and read-only';
     end if;
   end;
   $$;
   ```
   A single centralized function means the archived-check logic and its error message live in exactly one
   place — auditable in one read, and any future write RPC can adopt it with a one-line call instead of
   re-deriving the check.

2. **Call it from each of the five RPCs**, immediately after each function's existing
   `is_campaign_dm(...)` authority check (so an unauthorized caller still gets "only a campaign DM can…"
   rather than leaking archive state to someone with no access at all):
   `award_ap`, `award_gold`, `declare_downtime`, `dm_edit_character_log`, `dm_unbind_character`. Each of
   these already resolves a `v_campaign`/`p_campaign` variable before its authority check, so the added
   line is `perform assert_campaign_active(v_campaign);` (or `p_campaign` for `declare_downtime`) — no
   other change to any of the five function bodies.

3. **Tighten the `campaigns_update` RLS policy** that gates the direct `ignore_player_ap`/`rules` column
   writes. Add a second helper (an RLS `using`/`with check` predicate must be a boolean expression, not a
   function that raises, so it can't reuse `assert_campaign_active` as-is):
   ```sql
   create or replace function public.is_campaign_dm_and_active(p_campaign uuid)
   returns boolean language sql security definer stable set search_path = public as $$
     select is_campaign_dm(p_campaign)
       and exists (select 1 from campaigns where id = p_campaign and archived_at is null);
   $$;
   ```
   Then `drop policy campaigns_update` and recreate it with
   `using (is_campaign_dm_and_active(id)) with check (is_campaign_dm_and_active(id))`. This deliberately
   does **not** touch `is_campaign_dm()` itself — that function is also the predicate behind several
   **read** policies (`campaigns_select`, `campaign_dms_select`, `ap_awards_select`, …), and a DM/co-DM
   must still be able to *see* an archived campaign; only this one write policy needs the extra clause.

4. **Do not touch `archive_campaign`/`unarchive_campaign`** — they must keep working on an archived
   campaign (that's the only way to un-archive one), and they're already owner-only, a stricter gate than
   anything this plan adds.

5. Ship as one new migration file, `sql/migrations/2026-08-22-archived-campaign-write-lockdown.sql`,
   following this repo's existing migration convention (one dated file per change, `create or replace
   function` for every touched function so it's safely re-runnable, explicit `grant`/`revoke` restated
   where the file's own convention already does that for touched objects).

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
  per-change checklist (the *why* here — RLS as the only real boundary, and the two-name correction to the
  original task-board inventory — is exactly the kind of non-obvious reasoning that rule asks for).

## Out of scope
- `character_dm_notes` archived-write locking (needs a read/write policy split first — separate change).
- The invitation subsystem's archived-write locking (recently and separately hardened; bundling risks
  scope creep on the same security boundary in one PR).
- Any client-side change to `tools/DM-Console.html`. Its existing `_dmPeekActive`-style guards already
  produce the correct UX (blocking the button before a request is even sent) — this plan only adds the
  server-side backstop behind them. Leaving the client guards in place also means an ordinary DM using the
  UI normally sees no behavior change; only a direct/bypassing call newly fails.
- Extending `assert_campaign_active`/`is_campaign_dm_and_active` to any function not enumerated in
  Proposed approach step 2 — a future write RPC adopting the same guard is a one-line follow-up, not part
  of this migration.

## Alternatives considered
- **Modify `is_campaign_dm()` itself to exclude archived campaigns.** Rejected: that function backs
  several *read* policies too, and a DM must still be able to browse an archived campaign — only its
  writes should be blocked. Changing the shared read/write predicate would silently break "archived =
  browsable read-only," not just fix the write gap.
- **A single `before` trigger on `campaigns`/`characters` instead of per-function checks.** Considered
  more DRY in theory, but a trigger can't distinguish "the DM Console editing a character in an archived
  campaign" (should be blocked) from "the player's own client saving their own character normally"
  (`characters_update`'s existing `owner_id = auth.uid()` path, unrelated to archive state and must keep
  working) without re-deriving campaign-DM-authority logic inside the trigger anyway — no simpler than the
  function-call approach, and triggers are harder to reason about per-call than an explicit line in each
  RPC body.

## Risks
- **Damage scale if wrong: high.** This is a production RLS/RPC change on the security boundary the
  project's own `AGENTS.md` calls out as high-risk, and this project has been bitten by RLS/grant drift
  before (its own history names two prior incidents this exact class of change has caused).
- **Damage likelihood: low–medium.** The mechanism itself is narrow (an added existence check, not a
  changed authority model), and the Supabase advisor plus a direct signed-in RPC test (not just the UI)
  should catch a shape mistake before merge.
- **Main risk is scope, not mechanism.** The single highest-risk decision in this plan is *what counts as
  in scope* (the six enumerated write paths) versus what's deliberately deferred (`character_dm_notes`,
  the invitation subsystem). Getting that boundary wrong either direction — silently missing a seventh
  write path, or scope-creeping into the invitation subsystem's very recent hardening — is more likely to
  cause a problem here than the SQL itself being wrong.

## Verification
1. Apply the migration to a Supabase branch/project, then run `get_advisors` (security lints) and skim
   `get_logs` — this project's own checklist step 4 requires this after any migration/RLS change, and it
   has caught real grant/RLS drift for free twice before.
2. **Direct signed-in RPC test, not just through the UI** (the task's own done-when criterion): while
   signed in as a campaign's DM, with that campaign archived, call each of `award_ap`, `award_gold`,
   `declare_downtime`, `dm_edit_character_log`, `dm_unbind_character` directly (e.g. via the browser
   console's `supabase.rpc(...)`, bypassing DM Console's own client-side guards entirely) and confirm each
   is rejected server-side with the expected exception — then attempt a direct
   `supabase.from('campaigns').update({ignore_player_ap: true})` against the archived campaign and confirm
   the RLS policy rejects it too.
3. Confirm `unarchive_campaign()` still succeeds against the same archived campaign, then re-run step 2's
   calls against the now-unarchived campaign and confirm they all succeed again (proves the check is
   archive-state-conditional, not a blanket regression).
4. This plan touches no `js/` file, so `testing/tests/engine-parity.html` is not expected to be affected —
   run it once anyway as a cheap regression check, and note in the PR that a 0-failed result here confirms
   "no JS touched" rather than validating this fix itself.

## Done when
Every one of the six enumerated write paths (five RPCs plus the `campaigns_update` RLS policy) rejects a
write against an archived campaign, verified by a direct signed-in call bypassing the client UI; the
Supabase advisor reports no new findings; `unarchive_campaign()` still works and re-enables all six paths
afterward; `docs/TASK_BOARD_NEXT.md`'s entry is graduated to `CHANGELOG.md`/`DECISIONS.md` in the same
change.

---

## Reviewer instructions
Start your response by self-identifying the model and settings you're running as (e.g. "Reviewing as
GPT-5.1, default settings" or equivalent) — this is tracked over time.

You have **no access to this repository** — judge this plan purely as a written document: its logic,
clarity, scope, and risk framing, not correctness you can't verify from the text alone (you cannot check
that the SQL shown actually matches what's in the repo — take the "Verified vs. Assumed" split at face
value and focus your critique on whether the *reasoning* holds up, not on re-deriving the SQL yourself).

Answer explicitly:
1. Does this plan achieve its stated goal?
2. Are any of the "Verified" facts actually shaky, or better described as assumptions?
3. Is there a better alternative to the proposed approach (the single reusable guard function + one
   RLS-policy tightening) than what's described here?
4. What's missing — a write path not enumerated, a risk not named, a verification step that wouldn't
   actually catch a real mistake?
5. Is the Verification section objectively checkable by someone who is not the plan's author?
6. Should this plan split into more than one (e.g. "core five RPCs + RLS policy" now, and a separate plan
   later for `character_dm_notes` and/or the invitation subsystem) — or is the scope boundary drawn here
   the right one?

Output your review as a single file named `archived-campaign-rpc-enforcement-review-<your-model-slug>.md`.

---

## Review outcome
*(filled in after reviewer feedback is triaged — see the cold-plan-review skill's Step 7)*
