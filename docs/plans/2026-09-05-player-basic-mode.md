# Plan: Account-level "basic mode" — restrict a player to one active character

Project: PACT (static vanilla-JS D&D character-management PWA; Supabase backend behind RLS).
Task-board entry: `docs/TASK_BOARD_NEXT.md`, "Account-level 'basic mode'…", branch `feat/player-basic-mode`.

## Goal
Let someone with the right authority flag a specific player's account so they cannot have more than
one *active* (non-archived) character across the app's two character-editing tools, enforced so it
cannot be bypassed by calling the database directly (not just a hidden button).

## Context
A real support case: a player had two cloud characters that both got named "Archer" — one correctly
built, one whose build points had been zeroed out by a DM at some point — and the *wrong* one was the
one linked to his campaign. He couldn't tell which to use. Fixed by hand this one time (archived the
extra characters, moved the campaign-awarded points to the correct one, re-linked it). This plan is for
turning that one-off fix into a real feature so a human doesn't have to intervene by hand next time.

## Assumed vs. Verified

**Verified (read directly from the current codebase/database this session):**
- The character-storage table has columns: `id, owner_id, campaign_id, name, kind, stats, ap, gold,
  created_at, updated_at, archived_at, autosave_enabled`. `archived_at` already exists and is how a
  character is hidden from a player's active list today (soft-delete, not a real delete).
- The player-accounts table currently has only `id, display_name, created_at, updated_at` — no role or
  flag column of any kind exists yet.
- The current INSERT policy on the character table (paraphrased, not quoted verbatim to avoid
  reproducing exact production SQL outside the codebase) requires: the inserting user owns the row,
  the new row is not yet linked to any campaign, and its DM-awarded-points column is exactly zero.
  Direct inserts are also restricted to a specific column allow-list (id, owner, name, kind, stats,
  autosave preference) — a database-level grant, not just the policy.
- There is exactly ONE code path in the whole app where a genuinely new character row gets inserted
  into the cloud database (as opposed to updating an existing one): a single function that first tries
  an UPDATE by id, and only inserts if that UPDATE affects zero rows. Both character-editing tools call
  through this same shared function — there is no second, tool-specific insert path to worry about.
- There is already a working precedent in this codebase for a database trigger that blocks a write and
  raises a custom, client-recognizable error message (used today to protect locked/sealed character
  history) — the client-side code matches on a distinctive substring of the raised message text,
  because the database driver used here surfaces a raised exception's message but not a typed error
  code. This is the cleanest way to give the client something better than a generic "permission denied"
  when basic mode blocks an insert.
- There is no "admin" or "superuser" role anywhere in the schema or its access-control policies today.
  The only elevated authority that exists is "is this user the DM of this specific campaign" — which is
  scoped to one campaign, not global.
- As measured this session: the live character table holds on the order of a few dozen rows across
  under a dozen distinct owners and a handful of campaigns. Small, but real, live user data — treat as a
  snapshot to re-check at implementation time, not a permanent fact.

**Assumed / open — needs a decision, not just an implementation:**
- WHO can set the flag. There is no admin role. A campaign DM's authority doesn't naturally extend to a
  player who isn't in their campaign (the case that motivated this — an unbound, un-campaigned extra
  character — is exactly that situation). Two real options: (a) any DM who shares at least one campaign
  with the player can flag them, or (b) this stays a manual database operation until/unless the app
  grows a real admin concept. Defaulting to (a) in this draft, but flagging it as the single biggest
  open question.
- Whether the one-character limit should be configurable (a number) or a plain on/off switch. Drafting
  as a plain boolean for simplicity; a number is a trivial extension later if wanted.
- Whether a character that's currently *local-only* (never cloud-saved) counts toward the limit. The
  database can only ever gate what reaches it — a player could still keep unlimited never-saved local
  characters on their own device. Treating that as acceptable / out of scope, not a bypass worth closing.

## Proposed approach
1. Add a nullable boolean column to the player-accounts table (e.g. `basic_mode`), default off/null —
   existing players are entirely unaffected until someone deliberately flags one.
2. Add a `BEFORE INSERT` trigger on the character table (same pattern as the existing locked-history
   trigger) that: looks up the inserting owner's `basic_mode` flag; if set, counts that owner's existing
   non-archived character rows; if the count is already ≥ 1, raises a distinctive, prefixed error
   message rather than silently failing. This is enforced independently of the existing INSERT policy
   (belt-and-suspenders, matching how the ap/campaign_id guards are layered today) and cannot be
   bypassed by calling the insert endpoint directly, since it fires for any INSERT regardless of caller.
3. Add a way for an authorized DM to flip the flag — a database function (matching the existing pattern
   for DM actions that must bypass a player's own row-level policy, e.g. how a DM currently
   awards points or removes a character from their campaign) that checks the caller shares a campaign
   with the target player before allowing the write. (Depends on resolving the "who can set this" open
   question above.)
4. Client-side: catch the new trigger's distinctive error message at the one shared insert call site
   (see Verified above) and surface a plain-language message ("this account is limited to one
   character") instead of a raw database error, in both character-editing tools since they share that
   code path.
5. Add a small UI affordance wherever a DM already manages their campaign's roster, to set/unset the
   flag on a player and see it's currently on.
6. A database migration file, then run this project's own advisor/security-lint tooling before treating
   the change as done — this project has been bitten before by access-control drift that only that
   tooling caught.

## Files / areas involved (names, not line numbers — they'll drift)
- The RLS policy file (character table's INSERT policy and column-grant section).
- A new migration file alongside the project's existing dated migration files.
- The shared sync module's single insert call site and its public save-entry-point wrapper (both
  character-editing tools already route through this one module for cloud saves).
- Whichever DM-facing tool file already has campaign roster management, for the new toggle UI.
- The player-accounts table's own migration/schema definition, for the new column.

## Out of scope
- Any change to how *local-only* (never cloud-saved) characters work — basic mode is a cloud-sync-time
  gate only.
- A general admin-role system. This plan works within "DM of a shared campaign" as the authority unless
  told otherwise.
- Retroactively enforcing the limit on players who already have multiple characters when the flag is
  turned on — turning the flag on for an existing multi-character player should not delete or archive
  anything automatically; it should only block *new* character creation from that point forward.
- Changing anything about the *existing*, separate, larger task already on this project's board about a
  DM-configurable per-campaign character limit (a different, campaign-scoped concept already flagged as
  its own large/high-risk item) — this plan is account-wide and orthogonal to that one, not a
  replacement for it.

## Alternatives considered
- **Enforce only in the RLS policy's own `WITH CHECK` clause, no trigger.** Rejected as the primary
  mechanism: a bare policy rejection surfaces to the client as a generic, non-specific permission error
  with no clean way to distinguish "you hit the character limit" from any other policy failure, so the
  UI could not give a useful message. The trigger approach is barely more code and this codebase already
  has the exact pattern to copy.
- **Client-side-only enforcement (hide/disable the "new character" button).** Rejected outright per the
  task's own requirement — trivially bypassed by calling the database directly, which does not meet
  "enforced server-side."
- **A numeric per-player limit instead of a flat one-character switch.** Not rejected, just deferred —
  a plain boolean is the smaller, safer first cut, and the schema choice (a nullable value rather than a
  bare boolean) leaves room to make it numeric later without another migration.

## Risks
- **Schema + RLS + trigger change on a live table with real user rows.** Wrong logic here either locks
  a player out of creating any character at all (support burden) or fails to block anything (feature
  doesn't work) — this class of bug is exactly why this plan exists instead of an ad-hoc patch.
- **The authority question above, if resolved wrong,** either lets any DM restrict a player they have no
  real standing over, or leaves the feature unusable for the exact case (an unbound player) that
  motivated it.
- **Trigger ordering.** This project's existing triggers on the same table are documented as firing in a
  specific alphabetical order relative to each other because more than one can fire on the same
  statement; a new trigger needs to be checked against that existing ordering rather than assumed
  independent.

## Verification
- This project's own automated rules-parity test suite must still show zero failures after the change
  (it's unrelated to this feature but is the standing regression gate for anything touching the shared
  engine/data layer).
- This project's own security-advisor tooling must report no new findings after the migration —
  required by this project's own written process for any RLS/schema change, and this project has
  concretely been bitten before by access-control drift that only that tooling caught.
- Manually verify: flag a test player, confirm a second character creation is refused with the new
  friendly message (not a raw database error) in both tools; confirm an unflagged player is completely
  unaffected; confirm turning the flag off again immediately un-blocks creation; confirm archiving one
  of an already-over-the-limit player's characters does NOT itself get auto-deleted or touched by this
  feature.

## Done when
A DM sharing a campaign with a player can flag that player's account; a flagged player is refused (with
a clear message, in both tools) when trying to create a second active character; an unflagged player is
unaffected; turning the flag off unblocks creation immediately; the project's own regression suite and
security-advisor tooling are clean; the change is documented per this project's own decision-record
convention (a non-obvious trust-boundary/authority decision like this is exactly what that convention
exists for).

---

## Reviewer instructions
Start your response by self-identifying: which model you are and any relevant settings.

You are reviewing this plan **on its own text alone** — you do not have access to the actual codebase,
so judge logic, clarity, scope, and risk, not whether a specific line of code actually looks the way the
plan claims it does.

Answer explicitly:
1. Does this plan actually achieve its stated goal?
2. Are any of its "Verified" claims suspicious — internally inconsistent, or asserted with more
   confidence than the plan's own evidence supports?
3. Is there a better alternative to the proposed approach that the plan didn't consider?
4. What's missing — an edge case, a failure mode, a piece of the "Done when" list that isn't actually
   objectively checkable?
5. Should this be split into more than one plan (e.g., is the "who can set this flag" question big
   enough that it should be resolved as its own decision before any code plan is written at all)?

Output your review as a file named `player-basic-mode-review-<your-model-name>.md`.

## Review outcome

Two Claude Code sub agents reviewed this plan independently and cold (plan text only, no repo access):
`docs/plans/cold-reviews/2026-09-05-claude-subagent-general-player-basic-mode.md` and
`…-claude-subagent-architect-player-basic-mode.md`. Both converged on the same critical gap without
seeing each other's review — treated as high-confidence, not a single reviewer's opinion.

**Accept — plan needs revision before implementation, not ready to build as drafted:**
- **Critical: the proposed `BEFORE INSERT` trigger does not achieve "cannot be bypassed."** Both
  reviewers independently found the same hole: `archived_at` going back to null (un-archiving) is an
  UPDATE, not an INSERT, so a flagged player can archive character A, create character B (passes the
  check, 0 active), then un-archive A via a plain update — ending with two active characters and no
  trigger ever firing. This is the single most important finding; it goes directly to the plan's own
  stated goal.
- **Race condition:** a count-then-insert trigger is a classic check-then-act pattern — two concurrent
  inserts for the same flagged owner can each see count=0 and both pass before either commits.
- **Better alternative, proposed independently by both reviewers:** a partial unique index / uniqueness
  constraint (one active row per owner when the flag is set) instead of a counting trigger. This is
  race-proof by construction (Postgres checks uniqueness atomically) AND closes the archive/unarchive
  bypass for free, since restoring a second row to active would itself violate the constraint. Adopt
  this in the revised approach in place of (or alongside) the trigger.
- **Flag-reversibility gap:** if unflag authority is "any DM currently sharing a campaign with the
  player" (the plan's own default), a player flagged by a DM they later part ways with (leave the
  campaign, DM removes them) can end up with **no one left able to unflag them** — recreating exactly
  the "needs manual DB intervention" problem this feature exists to eliminate. Needs an explicit answer
  before this is safe to build (persist unflag authority independent of current membership; record the
  original flag-setter permanently; a self-service path; or something else) — not a follow-on note.
- **Split the plan**, per both reviewers and the plan's own flagged open question: resolve "who may set
  *and unset* the flag, including what happens when the authorizing relationship ends" as its own
  decision record first; revise this plan's implementation against that resolved answer, closing the
  two enforcement-surface gaps above.

**Noted, lower-priority — fold into the revision but not blocking:**
- The "exactly ONE insert path in the whole app" Verified claim is stronger than its own cited evidence
  (only checked the two player-facing tools, not DM Console) — re-verify before relying on it, or soften
  the claim.
- Consider a `SECURITY DEFINER` wrapper function returning a structured/typed result instead of
  client-side substring-matching a raised error message — more robust than the existing precedent's own
  known fragility, which this plan would otherwise just inherit unexamined.
- No mention of notifying the affected player that they've been flagged, by whom, or why — worth a
  requirement given this grants one DM unilateral, silent authority over another user's account.
- Interaction with the separate, already-flagged per-campaign character-limit task isn't addressed if
  both end up active for the same player.

**Next step:** write the authority/reversibility decision record, then revise this plan's "Proposed
approach" to the uniqueness-constraint design before any implementation branch is opened.
