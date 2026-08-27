> Triaged in session: https://claude.ai/code/session_01JukBACD4cFriAwSNcmWvQQ, 2026-08-23
> Reviewer: M365 Copilot (GPT-5 reasoning)
> Plan reviewed: docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-review.md

# Cold plan review: archived-campaign RPC enforcement

**Reviewing as M365 Copilot, based on the GPT-5 reasoning model, default settings.**

## Executive verdict

**Recommendation: revise before implementation.** The core mechanism is sound and appropriately narrow, but the plan does **not yet fully prove its stated invariant**. The main issue is the mismatch between the broad goal—“make every DM-write path … reject the write”—and the deliberate exclusion of known DM-write surfaces. The proposed five RPC guards plus the `campaigns_update` policy should enforce the narrower six-path contract, provided the stated repository facts are correct.

The most important changes are:

1. Narrow the stated goal to the six covered paths, **or** separately resolve whether `character_dm_notes`, campaign-roster/invitation mutations, and any other DM-authorised writes are part of “archived = frozen”.
2. Treat completeness of the write-path inventory as an assumption until an exhaustive, reproducible inventory is attached to the implementation.
3. Specify helper-function privileges explicitly. `SECURITY DEFINER` functions are executable by `PUBLIC` by default in PostgreSQL unless privileges are revoked.
4. Strengthen verification so it checks unchanged database state, owner and co-DM behaviour, both direct campaign columns, helper exposure, and the actual policy/grant shape—not merely that client calls return errors.
5. Decide and document the concurrency semantics: whether the invariant begins after the archive transaction commits, or must also defeat writes racing concurrently with archiving.

## 1. Does the plan achieve its stated goal?

**Partially.** It appears to achieve the **enumerated implementation goal**: the five named RPCs will call an archive guard and the direct-column campaign update path will become active-campaign-only through RLS.

It does not yet achieve the broad wording of the stated goal with confidence:

> “Make every DM-write path that can mutate campaign settings or a bound character's state reject the write server-side when the target campaign is archived.”

The plan identifies known mutations that remain writable and excludes them:

- `character_dm_notes` mutates data associated with a bound character.
- Invitation and roster operations can mutate campaign administration and membership state.
- The plan itself says the inventory was produced through a targeted grep rather than an exhaustive review.

Those exclusions may be reasonable, but they mean one of two things must change:

- The goal should explicitly say this change locks **AP, gold, downtime, corrective character-log editing, unbinding, and the directly writable campaign settings `ignore_player_ap` and `rules`**; or
- The archive invariant needs a complete system-wide definition and all contradictory write paths need to be handled now or tracked as acknowledged exceptions.

The distinction matters because “archived is truly read-only” is stronger than “these six known paths are locked”. If notes, invitation revocation, DM removal, or another campaign-bound update can still occur, the campaign is not globally read-only.

Within the six-path scope, the sequencing is good: perform the existing authority check first, then the active-state assertion. That avoids disclosing archive state through the intended RPC path to a caller who has no campaign authority.

## 2. Which “Verified” facts are shaky or better described as assumptions?

The document generally separates facts from assumptions well, but several “Verified” conclusions are stronger than the described evidence supports.

### 2.1 Completeness of the live write surface

The existence and bodies of the named functions may be verified, but the conclusion that the six paths are the relevant live surface is **not verified** by the described targeted grep. Searches for function definitions plus `is_campaign_dm()`/`is_campaign_owner()` can miss:

- Functions authorised through another helper or direct `auth.uid()` comparison.
- Trigger functions that mutate related rows.
- Policies written without those helper names.
- Views with update rules.
- Functions created under syntax not matched by the grep.
- Grants or policies introduced and later superseded across migrations.
- Direct table writes to related campaign or character tables.
- Functions in schemas other than `public`, if the application can reach them.

The plan already acknowledges this, so the result should be labelled **verified candidates from a targeted inventory, completeness assumed pending a second-pass audit**.

### 2.2 “Only two columns are directly writable by any authenticated DM”

This depends on the **effective final grants**, not merely the presence of one column-level `GRANT`. Later grants, table-level privileges, default privileges, role inheritance, or migration drift could broaden access. The plan should call the named grant verified, but effective exclusivity should remain conditional until privileges are queried from the deployed branch.

### 2.3 “Archive/unarchive are the only functions that write `archived_at`”

This can be verified from the SQL tree only to the extent that the tree is an authoritative representation of production. Direct updates, triggers, dashboard changes, generated SQL, or drift in the hosted database are separate questions. Phrase it as “the only repository-defined functions found to write it”.

### 2.4 “No other change to the function bodies”

That is a proposed implementation property, not a current repository fact. It also assumes every function has already resolved a non-null, authoritative campaign ID before its DM check. The implementation review should explicitly verify that each guard receives the campaign associated with the row actually being mutated—not merely a caller-supplied campaign ID.

### 2.5 Schema snapshot convention

The plan correctly flags this as inferred rather than verified. Keep it as an assumption until an explicit repository instruction or maintainer decision confirms it.

## 3. Is there a better alternative?

**No clearly better general mechanism is presented by the text.** For the narrow six-path change, explicit RPC guards plus a write-only RLS predicate are easier to audit than modifying `is_campaign_dm()` or introducing broad triggers.

However, the proposal should be described as **two reusable archive checks**, not “one reusable guard function”:

- An exception-raising procedural guard for RPC bodies.
- A boolean predicate for RLS.

That duplication is justified by the different consumers, but it creates a small semantic-drift risk. Both helpers should derive their answer from the same precise rule: campaign exists and `archived_at is null`.

A modest improvement would be to define the boolean helper as the primitive and make the assertion helper call it, while preserving authority-check ordering in each RPC. This centralises the archived-state semantics, although care is needed to distinguish “missing campaign” from “archived campaign” if that distinction matters. For example, the assertion should not accidentally treat a missing campaign as active simply because its current `exists(... archived_at is not null)` query returns false.

The current assertion has this behaviour:

- Existing active campaign: pass.
- Existing archived campaign: raise.
- Missing campaign: pass.

That may be safe only because every caller is expected to have already resolved and authorised a real campaign. It is still a brittle contract for a reusable security helper. A stronger helper should either:

- Assert that the campaign exists and is active; or
- Be explicitly named/documented as asserting only “not known to be archived”, with callers responsible for existence.

The first is preferable for future adoption.

A trigger-based design is not obviously better. The plan's rejection of a generic table trigger is reasonable because player-owned writes and administrative writes have different semantics. A trigger might eventually be warranted if a complete archive model is defined across all campaign-owned tables, but that would be a larger architectural change requiring actor-aware exceptions, unarchive semantics, and careful testing.

## 4. What is missing?

### 4.1 A precise archive invariant and exception list

The plan needs a normative statement such as:

> After `archive_campaign()` commits, no DM or owner may mutate campaign-owned gameplay/configuration state through ordinary application roles. The only permitted mutations are `unarchive_campaign()` and explicitly listed maintenance operations.

Then list exceptions. Without this, decisions about notes, invitations, roster changes, player-owned character saves, and unbinding remain subjective.

The trigger alternative says a player's own character saves “must keep working”. That is a significant exception to “archived = read-only” and deserves prominent treatment. If a character remains bound to an archived campaign while its owner can continue changing it, then the campaign snapshot is not fully frozen. This may be the intended product model, but it must be explicit.

### 4.2 Helper-function privilege hardening

Both new helpers are `SECURITY DEFINER`. The migration should specify:

- Function owner.
- `REVOKE ALL ... FROM PUBLIC` as appropriate.
- The minimum required `GRANT EXECUTE`, if direct execution by application roles is required at all.
- Whether authenticated users can call either helper through Supabase RPC.

A helper that raises differently for archived campaigns can become an archive-state oracle if publicly executable. The authority-first ordering inside the five parent RPCs does not prevent direct invocation of the helper itself.

For the boolean helper, direct execution may reveal whether the caller is a DM and whether the campaign is active, depending on `is_campaign_dm()` semantics. That may not be sensitive, but it should be intentional.

### 4.3 Search-path consistency

The helpers should schema-qualify referenced objects and functions where practical. The shown assertion uses `campaigns`, while the RLS helper uses `campaigns` and `is_campaign_dm` unqualified. A fixed `search_path` helps, but explicit `public.campaigns` and `public.is_campaign_dm(...)` make security-definer intent easier to audit.

The plan should also explain why one helper uses `set search_path = public, pg_temp` and the other only `public`. Consistency is preferable unless there is a reason for the difference.

### 4.4 Race semantics

The guard is a normal query under PostgreSQL transaction isolation. A write and archive transaction that overlap may each observe the campaign as active depending on timing and snapshots. The result can be a write that commits after the archive transaction, even though its check occurred before archive became visible.

This may be acceptable if the invariant is defined as applying to transactions that begin/check after archiving commits. If the requirement is strict commit ordering—nothing may commit after the archive commit—then row locking or serialisation needs consideration. The plan should name this risk and choose semantics rather than leaving it implicit.

### 4.5 RLS policy blast radius

Replacing `campaigns_update` affects every update allowed through that policy, not only `ignore_player_ap` and `rules`. The plan relies on column grants to constrain the actual update surface. Verification must inspect effective privileges and all policies on `campaigns` to ensure:

- No other role has a broader update grant.
- No permissive update policy can OR with this policy and bypass the active check.
- No restrictive/permissive policy interaction changes the intended result.
- Owner-only archival functions continue to operate under their intended security context.

### 4.6 Error-contract expectations

RLS denial and RPC exceptions will not produce the same error. If tests or clients rely on codes/messages, the plan should state:

- Expected RPC SQLSTATE or at least stable message substring.
- Expected direct-update result shape and whether zero rows versus an error counts as failure.
- Whether the UI already handles both forms safely.

### 4.7 Audit methodology

The second pass should be reproducible and broader than the original grep. It should inventory:

- Effective update/insert/delete grants by role.
- All RLS policies for campaign-owned tables.
- All security-definer functions reachable by application roles.
- All functions/triggers that write campaign IDs, campaign settings, character state, awards, logs, notes, invitations, or membership.
- Supabase API-exposed schemas.

The resulting inventory or command output should be attached to the PR or summarised in its verification notes.

### 4.8 Idempotency claim

“Safely re-runnable” needs care. `CREATE OR REPLACE FUNCTION` is re-runnable, but `DROP POLICY campaigns_update` without `IF EXISTS` is not safe if the expected policy is absent. Conversely, `DROP POLICY IF EXISTS` can hide drift. For a security migration, failing loudly on unexpected policy shape may be preferable. The plan should choose whether it values strict precondition checking or generic re-runnability.

### 4.9 `dm_unbind_character` product decision

This is correctly flagged as assumed, but it is important enough to be a pre-implementation decision. Unbinding could be considered either prohibited mutation or a recovery operation needed to free a character from an archived campaign. The plan should not silently settle it through code.

## 5. Is verification objectively checkable?

**Mostly in outline, but not yet as a repeatable acceptance procedure.** Another reviewer can understand what success means, but too many details are unspecified to produce a deterministic result.

The verification section should add:

1. **Named fixtures:** campaign ID, owner user, co-DM user, unauthorised user, bound character IDs, and initial values.
2. **Preconditions:** archive state, campaign bindings, balances, downtime, log contents, settings, and grants.
3. **Exact calls:** payloads for every RPC and both direct-column updates.
4. **Expected results:** error class/message for RPCs; error or zero-row behaviour for RLS updates.
5. **State assertions:** prove AP, gold, downtime, logs, binding, `rules`, and `ignore_player_ap` are unchanged after every rejected call.
6. **Role matrix:** test owner, co-DM, unauthorised authenticated user, and where relevant character owner.
7. **Active-state controls:** run each call before archiving or after unarchiving and verify the intended mutation actually occurs.
8. **Policy/grant inspection:** query effective privileges and all applicable update policies; do not rely on the advisor to establish semantic correctness.
9. **Helper exposure test:** attempt direct RPC execution of the new helpers under `anon` and `authenticated` roles and confirm the intended privilege result.
10. **Archive transition test:** confirm archive succeeds while active, unarchive succeeds while archived, and ordinary direct updates cannot change `archived_at` unless explicitly intended.
11. **Adviser baseline:** compare findings before and after migration so “no new findings” is measurable even if existing findings remain.
12. **Migration repeat behaviour:** either verify a second application succeeds or document that the migration intentionally fails on unexpected existing state.

`get_advisors` and `get_logs` are useful checks, but neither proves the business invariant. The browser-console tests are valid as API-level tests only if accompanied by database state checks.

The engine parity test is appropriately described as a cheap regression check rather than validation of the SQL fix.

## 6. Should the work be split?

**Keep the current migration narrow, but split the planning outcome into an immediate enforcement change plus explicit follow-up work.** Do not silently claim global read-only enforcement while known surfaces remain writable.

A sensible boundary is:

- **Immediate change:** the five gameplay/configuration RPCs plus `campaigns_update`, after resolving `dm_unbind_character`, helper privileges, and inventory completeness.
- **Separate follow-up:** define archive semantics for `character_dm_notes`, then split its combined read/write policy if writes should be locked while reads remain available.
- **Separate follow-up:** review archived-state behaviour for invitations and campaign roster administration. This belongs apart from the recently hardened invitation change, but it should receive a tracked decision rather than remain indefinitely out of scope.

This split is justified because notes require a policy-shape change and invitations have a separate security history and workflow. Combining all of them would increase review complexity and rollback risk. The mistake would not be splitting them; it would be presenting the first migration as complete enforcement of an invariant that the deferred surfaces still violate.

## Required plan amendments before implementation

1. Rewrite the goal and “Done when” so they either describe the six-path scope precisely or enumerate every intentional exception to global read-only behaviour.
2. Promote the `dm_unbind_character` assumption to an explicit product decision.
3. Add explicit `SECURITY DEFINER` ownership, revoke, grant, search-path, and direct-call requirements for both helpers.
4. Decide how a missing campaign ID is handled by `assert_campaign_active`.
5. Run and preserve a broader write-surface and effective-privilege inventory.
6. Check for multiple permissive `UPDATE` policies on `campaigns`.
7. State the concurrency boundary for writes racing with archive.
8. Expand verification into a fixture-based role matrix with before/after database assertions.
9. Create tracked follow-ups for notes and invitation/roster archive behaviour.
10. Clarify whether migration re-runnability or strict drift detection is the desired policy-drop behaviour.

## Final answers

1. **Does it achieve the goal?** It likely achieves the six enumerated protections, but not the broad “every DM-write path” / “archived is read-only” claim as written.
2. **Are verified facts shaky?** The named-object observations may be verified from the tree, but completeness, effective grants, production parity, and the schema-snapshot convention remain assumptions or deployment checks.
3. **Better alternative?** No clearly superior mechanism for this scope. Explicit RPC assertions plus an active-only write policy are appropriate; strengthen helper semantics and privileges.
4. **What is missing?** A normative invariant, exhaustive inventory, helper privilege design, concurrency semantics, effective-policy/grant checks, state-based assertions, and resolution of unbinding/player-write exceptions.
5. **Is verification objective?** Understandable but insufficiently reproducible. It needs fixtures, exact calls, role coverage, expected errors, and unchanged-state assertions.
6. **Split the work?** Yes: retain the narrow core migration, with separate notes and invitation/roster follow-ups. Narrow the claim so the split is honest and testable.

## Review outcome

**Revise before implementation.** The implementation shape is promising and probably the right local fix, but the scope language, security-definer privilege treatment, inventory evidence, and verification contract need tightening before this should cross a production RLS boundary.
