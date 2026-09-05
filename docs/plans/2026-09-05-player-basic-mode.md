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
- `owner_id` cannot currently be changed on an existing character row by any path in the app: it is
  absent from the column-level UPDATE grant entirely (Postgres rejects naming it before the row policy
  even runs), and the row policy's own check additionally requires the new row's owner to still equal
  the caller — so even a hypothetical future grant couldn't reassign a row to someone else. No
  ownership-transfer RPC exists either. Checked specifically because a Gemini cold review (below) raised
  ownership transfer as a way to bypass an archived_at-keyed trigger; confirmed not currently possible.

**Resolved by decision record** (`decisions/2026/D-GH-2026-09-05-player-basic-mode.md`, written after the
first review round below): a DM sharing a campaign with the player may turn the flag ON. The flagged
player can always turn it OFF themselves, independent of whether any DM still shares a campaign with
them — a DM sharing a campaign may also turn it off, as a convenience, but that path is never the only
one. Who set it and when is recorded and visible to the player. This replaces the earlier "any DM sets
AND unsets, re-checked against current membership" default, which both review rounds below found could
permanently strand a flagged player once the qualifying DM relationship ended.

**Still open — needs a decision, not just an implementation:**
- Whether the one-character limit should be configurable (a number) or a plain on/off switch. Drafting
  as a plain boolean for simplicity; a number is a trivial extension later if wanted.
- Whether a character that's currently *local-only* (never cloud-saved) counts toward the limit. The
  database can only ever gate what reaches it — a player could still keep unlimited never-saved local
  characters on their own device. Treating that as acceptable / out of scope, not a bypass worth closing.

## Proposed approach
1. Add three columns to the player-accounts table: `basic_mode` (nullable boolean, default null/off —
   existing players entirely unaffected until deliberately flagged), `basic_mode_set_by` (the setting
   DM's account id), `basic_mode_set_at` (timestamp). The latter two exist purely so the flagged player
   can see who restricted them and when, per the decision record above — not used in enforcement logic.
2. **Enforcement mechanism — revised from the original draft.** The first draft proposed a `BEFORE
   INSERT` trigger that counts existing active rows. Both cold-review rounds below found this doesn't
   actually achieve "cannot be bypassed": restoring a character from archived back to active
   (`archived_at` → null) is an UPDATE, not an INSERT, so the trigger never fires on that path — a
   flagged player can archive one character, create a second (passes at zero), then un-archive the
   first, ending at two active characters. It's also a plain check-then-act race under concurrent
   inserts.

   The reviewers' own suggested fix — a partial unique index — turns out to have a real wrinkle worth
   naming rather than silently assuming away: Postgres partial-index predicates are expected to depend
   only on the indexed table's own columns via immutable expressions, and `basic_mode` lives on a
   different table, one whose value is expected to change over time independent of the character rows
   it would need to gate. A literal `unique index on characters(owner_id) where archived_at is null and
   <owner's basic_mode>` isn't a straightforward, safe construction under that constraint. Two ways to
   still get the reviewers' actual point (an atomic, race-proof check that covers both insert AND
   un-archive) without that wrinkle:
   - **(a) Broaden the trigger** to fire `BEFORE INSERT OR UPDATE OF archived_at` (covering un-archive,
     not just creation), and close the race by taking an explicit lock on the owner's existing rows
     (`SELECT ... FOR UPDATE`) or a Postgres advisory lock keyed on `owner_id` before counting, so two
     concurrent attempts serialize instead of both reading count=0. This is the smaller diff — same
     trigger pattern this codebase already has, just broadened and lock-guarded — and is the
     recommended first cut.
   - **(b) Denormalize:** copy `basic_mode` onto the character row itself at write time (kept in sync by
     a trigger on the accounts table cascading down whenever the flag changes), then a genuine partial
     unique index on `characters(owner_id) where archived_at is null and basic_mode` becomes valid,
     since it now only depends on this table's own columns. More moving parts (a second, cross-table
     sync trigger) for a table this small; worth it only if (a)'s per-write lock is later found to be a
     real contention problem, which is unlikely at this table's current size.

   Either way, the check is enforced independently of the existing INSERT policy (belt-and-suspenders,
   matching how the `ap`/`campaign_id` guards are layered today) and cannot be bypassed by calling the
   database directly, since it fires regardless of caller.
3. Two database functions for flipping the flag, both matching the decision record's authority model:
   one callable by a DM sharing a campaign with the target player (sets it on; also usable by that DM to
   set it off, as the decision's convenience path) and one callable by the player themselves on their
   own account (always available to turn it off, regardless of any DM's current standing — this is the
   path that actually closes the reversibility gap, not the DM path).
4. Client-side: catch the new trigger's distinctive error message at the one shared insert call site
   (see Verified above) and surface a plain-language message ("this account is limited to one
   character") instead of a raw database error, in both character-editing tools since they share that
   code path.
5. UI: a small affordance wherever a DM already manages their campaign's roster, to set/unset the flag
   on a player and see it's currently on; and a small affordance in each player-facing tool's own
   account/settings area showing "basic mode is on, set by <DM> on <date>" with an unset control — the
   player's own escape hatch has to be visible somewhere a DM-only tool can't be the only place it lives.
6. A database migration file, then run this project's own advisor/security-lint tooling before treating
   the change as done — this project has been bitten before by access-control drift that only that
   tooling caught.

## Files / areas involved (names, not line numbers — they'll drift)
- The RLS policy file (character table's INSERT policy and column-grant section, plus the new/broadened
  trigger and its lock-acquisition logic).
- A new migration file alongside the project's existing dated migration files.
- The shared sync module's single insert call site and its public save-entry-point wrapper (both
  character-editing tools already route through this one module for cloud saves) — also wherever that
  module handles un-archiving, now that the trigger covers that path too.
- Whichever DM-facing tool file already has campaign roster management, for the DM-side toggle UI.
- Each player-facing tool's own account/settings surface, for the player's own self-unset control.
- The player-accounts table's own migration/schema definition, for the three new columns.

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
  UI could not give a useful message.
- **Client-side-only enforcement (hide/disable the "new character" button).** Rejected outright per the
  task's own requirement — trivially bypassed by calling the database directly, which does not meet
  "enforced server-side."
- **A numeric per-player limit instead of a flat one-character switch.** Not rejected, just deferred —
  a plain boolean is the smaller, safer first cut, and the schema choice (a nullable value rather than a
  bare boolean) leaves room to make it numeric later without another migration.
- **A literal partial unique index keyed directly on the accounts table's live `basic_mode` value, with
  no denormalization.** This was the two cold reviewers' own proposed fix for the original trigger's
  bypass and race. Not rejected as a direction — it's the right instinct — but rejected in this exact
  form: Postgres partial-index predicates are meant to depend only on the indexed table's own columns
  via immutable expressions, and a cross-table reference to a value that's expected to change
  independently doesn't fit that safely. Reshaped into the two options in step 2 above (a lock-guarded
  broadened trigger, or a denormalized same-table flag that makes a real partial unique index valid)
  instead of asserting the naive cross-table version would just work.
- **A `SECURITY DEFINER` wrapper function returning a structured/typed result, instead of client-side
  substring-matching a raised error message.** Flagged by one reviewer as more robust than the existing
  locked-history precedent's own known fragility (a future message-wording change silently breaks
  detection). Not adopted in this revision — staying consistent with the existing precedent keeps this
  feature's error-handling shape unsurprising next to the code it's modeled on — but worth reconsidering
  if that fragility ever actually bites in practice.
- **A lighter-weight version of the above, raised by a Groq-hosted reviewer:** keep the trigger, but have
  it `RAISE EXCEPTION ... USING ERRCODE = '<custom code>'` instead of relying purely on a message
  substring — the client can then match on the typed SQLSTATE, which survives a future wording change
  that would silently break substring matching, without the larger redesign a full RPC wrapper needs.
  Worth adopting alongside the existing substring-match fallback (belt-and-suspenders, same spirit as the
  rest of this plan's enforcement layering) rather than instead of it.

## Risks
- **Schema + RLS + trigger change on a live table with real user rows.** Wrong logic here either locks
  a player out of creating any character at all (support burden) or fails to block anything (feature
  doesn't work) — this class of bug is exactly why this plan exists instead of an ad-hoc patch.
- **Trigger ordering.** This project's existing triggers on the same table are documented as firing in a
  specific alphabetical order relative to each other because more than one can fire on the same
  statement; a new trigger needs to be checked against that existing ordering rather than assumed
  independent — now more load-bearing than in the original draft, since the trigger is broadened to
  also fire on the `archived_at` UPDATE path, which other existing triggers may also touch.
- **Lock contention/deadlock, if approach (a) from step 2 is built carelessly.** An explicit row or
  advisory lock taken inside a trigger needs a consistent lock-ordering discipline (always lock by
  `owner_id`, always released at transaction end) to avoid a deadlock between two concurrent writers for
  the same owner — low likelihood at this table's current size, but worth a specific test rather than
  assumed away given it's new to this codebase's trigger patterns. A concrete pattern, suggested by a
  Gemini cold review: `pg_advisory_xact_lock(hashtext(NEW.owner_id::text))` — an advisory lock scoped to
  the transaction, keyed on the owner, with no risk of colliding with a real row lock elsewhere.
- **Future feature risk, not a current bug:** if this app ever grows a character-ownership-transfer
  feature, whatever trigger enforces this limit must also fire on that path (not just `archived_at`) —
  confirmed above that no such transfer path exists today, so this isn't a gap to close now, just a trap
  for whoever adds that feature later to not reopen this exact class of bypass.
- **Account-deletion edge case, raised by an OpenRouter-hosted reviewer:** undecided what happens to
  `basic_mode`/`basic_mode_set_by`/`basic_mode_set_at` if a flagged player's account is ever deleted —
  depends on the new columns' foreign-key `ON DELETE` behavior (`CASCADE` silently drops the metadata,
  `RESTRICT` could block the deletion outright). Doesn't affect the core goal (a deleted account has no
  characters left to restrict), but is worth deciding at migration time rather than discovering via a
  failed deletion later.

## Verification
- This project's own automated rules-parity test suite must still show zero failures after the change
  (it's unrelated to this feature but is the standing regression gate for anything touching the shared
  engine/data layer).
- This project's own security-advisor tooling must report no new findings after the migration —
  required by this project's own written process for any RLS/schema change, and this project has
  concretely been bitten before by access-control drift that only that tooling caught.
- Manually verify: flag a test player, confirm a second character creation is refused with the new
  friendly message (not a raw database error) in both tools; confirm an unflagged player is completely
  unaffected; confirm the player's own self-unset control immediately un-blocks creation with no DM
  involvement required; confirm archiving one of an already-over-the-limit player's characters does NOT
  itself get auto-deleted or touched by this feature.
- **New, added in this revision — the two gaps the cold reviews found:** confirm un-archiving a second
  character while flagged and already at the limit is refused with the same message (closes the
  archive/create/un-archive bypass); confirm two near-simultaneous creation attempts for the same
  flagged owner cannot both succeed (closes the count-then-act race) — a scripted concurrent-request
  test, not just manual sequential clicking, since the race is exactly the kind of thing sequential
  manual testing cannot exercise.
- Confirm a DM who no longer shares a campaign with the player can neither set nor unset the flag, and
  confirm the player retains their own unset control regardless.
- **New, added after a Gemini cold review:** confirm what happens if a DM flips the flag on while the
  player is actively mid-session in a character editor — specifically, that the client clears/updates
  its local cached "can I save" state on hitting the refusal rather than retrying a background autosave
  in a loop against a write that can never succeed.

## Done when
A DM sharing a campaign with a player can flag that player's account; the flagged player can always
unset it themselves, independent of that DM's continued standing; a flagged player is refused (with a
clear, app-styled message, in both tools) when trying to create a second active character OR to
un-archive a second one while already at the limit; two concurrent creation attempts cannot both
succeed; an unflagged player is unaffected; the project's own regression suite and security-advisor
tooling are clean; the authority/reversibility decision and this implementation are both documented per
this project's own decision-record convention.

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

**Update 2026-09-05 — decision recorded.** See `decisions/2026/D-GH-2026-09-05-player-basic-mode.md`:
a DM sharing a campaign may set the flag; the flagged player can always unset it themselves regardless
of any DM's current standing (a DM sharing a campaign may also unset it, as a convenience, but that path
is never required); setter identity and timestamp are recorded and visible to the player. This plan's
"Proposed approach" step 3 (the DM-authorization function) and its "Assumed/open" authority bullet are
now superseded by that decision and still need rewriting to match it, alongside the still-open
enforcement-mechanism revision (uniqueness constraint, not a counting trigger) — neither has been
implemented yet.

**Update 2026-09-05 — plan body revised** to match the decision and both prior findings (authority
model, broadened trigger + lock instead of a bare counting trigger). See the "Proposed approach",
"Files/areas", "Alternatives", "Risks", "Verification", and "Done when" sections above — all rewritten,
not just noted.

**Update 2026-09-05 — third review round, Gemini API (`gemini-3.6-flash`, free tier).** See
`docs/plans/cold-reviews/2026-09-05-gemini-player-basic-mode.md`. Reviewing the *already-revised* plan
(not the original), so this round's job was to catch what the two Claude sub agents missed, not
re-litigate what they already found. It did:
- **Genuinely new finding, verified and accepted as a forward-looking note (not a current bug):**
  raised character-ownership transfer (`owner_id` changing) as a path the archived_at-keyed trigger
  wouldn't cover. Checked directly against the schema: no such transfer path exists today (`owner_id`
  is excluded from the UPDATE column grant, and the row policy's own check requires the new row's owner
  to still equal the caller) — so not a live bug, but recorded above as a trap for whoever might add a
  transfer feature later.
- **Accepted, folded in above:** a concrete advisory-lock pattern
  (`pg_advisory_xact_lock(hashtext(owner_id))`) for the lock-guarded trigger option, and a new
  verification case for what the client should do if the flag flips on mid-session for an actively-open
  editor (clear cached save-state rather than retry-loop a write that can never succeed).
- **Noted, minor, not yet folded in:** the plan's "Verified" section doesn't document the
  campaigns/campaign-membership schema despite the authorization model depending on it — a
  self-containment gap worth closing next time this document is touched, not urgent enough to interrupt
  for.
- **One reviewer-reliability finding, logged for the record rather than acted on:** the model's own
  self-identification line claimed "Gemini 2.5 Pro," which is simply false — the API call was made
  against `gemini-3.6-flash`. Its actual findings were still independently verified and judged on their
  merits regardless (the ownership-transfer point checked out as accurate even though the self-ID
  didn't) — but the mismatch is worth tracking if this reviewer is used again.
- **Not adopted:** re-litigating the SECURITY-DEFINER-RPC-vs-error-string-matching alternative — already
  considered and deliberately deferred in "Alternatives considered" above; this round's restatement of
  it didn't add a new reason to revisit that call.

**Update 2026-09-05 — fourth review round, Groq API (`openai/gpt-oss-120b`, free tier).** See
`docs/plans/cold-reviews/2026-09-05-groq-player-basic-mode.md`. This round is a clear illustration of why
Step 7.1's "verify every claim, don't take the reviewer's word" exists — several of its central claims
did not hold up once actually checked against this document:
- **Rejected, factually wrong:** its top recommendation — a denormalized flag plus a partial unique
  index — presented as an alternative "the plan didn't consider." This document's own "Proposed
  approach" step 2(b) already proposes exactly that design, including the same immutable-predicate
  reasoning. The reviewer appears to have generated a generic critique without registering content
  already in the document it was reviewing.
- **Rejected, already resolved:** re-raised the DM-authority-lapsing case as an open gap needing
  verification; this document's own Verification section already states that exact check.
- **Rejected, doesn't apply:** a table-lock/migration-downtime concern for the new columns — moot given
  the columns are specified as nullable with a null default, a metadata-only change in Postgres.
- **Accepted, one genuine addition:** a lighter-weight alternative to the already-deferred RPC-wrapper
  idea — `RAISE EXCEPTION ... USING ERRCODE`, giving the client a typed error to match on instead of
  only a message substring, without the bigger redesign a full RPC would need. Folded into
  "Alternatives considered" above.
- **Second data point on reviewer self-ID unreliability:** this model claimed to be "gpt-4o (ChatGPT)"
  — simply false; the call went to Groq's `openai/gpt-oss-120b`. Combined with the Gemini round's
  mismatch, this is now two independent cases in one session of a model getting its own identity wrong
  when asked — logged in `cold-review-api-universal-jc` (the new skill built this session for API-based
  cold reviews) as an established pattern, not a one-off.

**Update 2026-09-05 — fifth review round, OpenRouter API (`nvidia/nemotron-3-super-120b-a12b:free`, free
tier).** See `docs/plans/cold-reviews/2026-09-05-openrouter-nemotron-player-basic-mode.md`. The most
accurate round yet — unlike Groq, it correctly recognized the plan's current, already-revised state
rather than critiquing a version that no longer exists.
- **Accepted, genuinely new:** raised what happens to the `basic_mode` flag/metadata if a flagged
  player's account is ever deleted, depending on foreign-key `ON DELETE` behavior. Folded into Risks
  above.
- **Confirmed accurate (not new, but correctly recognized as already-logged rather than re-presented as
  undiscovered):** the "exactly ONE insert path" claim being stronger than its cited evidence — this
  reviewer noticed the plan's own Review-outcome section already flags this.
- **Third data point on reviewer instruction-following, a different failure mode this time:** this model
  skipped the self-identification instruction entirely rather than reporting a wrong identity — no self-
  ID line at all. Worth the same "verify it actually followed the reviewer instructions" discipline as
  the wrong-identity cases, just a different way to fail at the same thing.
