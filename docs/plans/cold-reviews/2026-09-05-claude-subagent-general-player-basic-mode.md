# Cold Review: Account-level "basic mode" plan

Claude Code sub agent (general-purpose, model: claude-sonnet-5) — cold review, no repository access used.

---

## 1. Does this plan actually achieve its stated goal?

Mostly, but not completely. The stated goal is "restrict a player to one active character... enforced
so it cannot be bypassed by calling the database directly." The proposed mechanism — a `BEFORE INSERT`
trigger that counts the owner's non-archived rows — closes the *creation* path, but the plan's own
"Verified" section establishes that `archived_at` is how a character becomes inactive/active again
(it is described as a soft-delete flag, which implies it is also un-set to bring a character back to
active). Restoring an archived character back to active is necessarily an **UPDATE**, not an INSERT.

Nothing in the proposed approach gates that UPDATE. So the actual bypass the plan needs to prevent is
trivially available to exactly the flagged player it's meant to restrict: archive character A, create
character B (allowed — you're at 0 active, this passes the trigger), then flip `archived_at` back to
null on A via a normal UPDATE. Now the player has two active characters and the trigger never fired,
because it only watches INSERT. This isn't a contrived corner case — it's the direct, predictable
consequence of defining "active" as "archived_at is null" while only guarding the INSERT surface. As
written, the plan does not achieve "cannot have more than one active character... enforced so it
cannot be bypassed."

The fix is straightforward in concept (extend the trigger, or add a second trigger, to also fire
`BEFORE UPDATE OF archived_at` and re-run the same count check when the new value is null and the old
value wasn't), but the plan as drafted doesn't mention it, and "Files / areas involved" and
"Verification" don't reference an UPDATE-side trigger or an unarchive test case at all. This should be
treated as a real gap, not a nitpick — it goes directly to whether the feature does what it claims.

## 2. Are any of the "Verified" claims suspicious?

Most of the Verified section is appropriately hedged (paraphrased SQL rather than quoted, an explicit
"snapshot, re-check" caveat on the row counts, "on the order of" phrasing). Two claims stand out as
carrying more confidence than the cited evidence supports:

- **"There is exactly ONE code path in the whole app where a genuinely new character row gets inserted...
  Both character-editing tools call through this same shared function — there is no second, tool-specific
  insert path to worry about."** The evidence offered for this is that the two character-editing tools
  share one function. That evidence supports "the two character-editing tools have no separate insert
  paths from each other" — it does not, by itself, support the stronger claim "in the whole app,"
  which requires also ruling out an insert path from the third tool (the DM-facing console, which the
  plan elsewhere describes as managing rosters and campaign-relationship writes). The plan may well be
  right that DM Console never inserts a new character row on a player's behalf, but that's a separate
  fact that isn't stated as having been checked, and the "whole app" phrasing papers over the gap. Given
  that this "single insert path" claim is load-bearing for the entire design (it's the reason a trigger
  on one table is believed sufficient), it deserves its own explicit verification line, not inheritance
  from a narrower fact.

- **"There is already a working precedent... for a database trigger that blocks a write and raises a
  custom, client-recognizable error message... the client-side code matches on a distinctive substring
  of the raised message text."** This is presented as a strength ("cleanest way..."), but it's worth
  flagging that the plan is proposing to *extend* a pattern whose own stated fragility (substring
  matching because the driver doesn't surface typed error codes) is being carried forward rather than
  reconsidered. That's a reasonable call given "this codebase already has the exact pattern to copy" —
  but the plan states this as pure precedent-following without noting that it is also copying that
  precedent's known weakness (a message-wording change silently breaks client detection, degrading to a
  generic error with no test to catch it). That risk isn't wrong to accept, but it isn't named either.

The row-count snapshot ("few dozen rows... under a dozen owners... a handful of campaigns") is
appropriately hedged and self-aware about staleness — not a problem.

## 3. Is there a better alternative to the proposed approach?

Two are worth naming that the plan didn't consider:

- **A partial unique index instead of (or alongside) a count-based trigger.** The plan's trigger counts
  existing non-archived rows and compares to the limit at INSERT time. That's a classic check-then-act
  pattern, and depending on the database's transaction isolation level, two concurrent inserts for the
  same owner (double-click, two devices/tabs racing a first cloud-save) can each see a pre-insert count
  of 0 and both pass the check before either commits, producing exactly the two-active-character state
  the feature exists to prevent. A partial unique index — e.g., unique on `owner_id` where
  `archived_at IS NULL` and `basic_mode` is true (or unique per owner enforced only when the flag is
  set, via a conditional constraint or a second guarded column) — is race-proof by construction,
  because uniqueness violations are checked atomically by the database itself, not by an application-level
  read-then-decide trigger. This also happens to solve the UPDATE/un-archive bypass from Q1 for free,
  since restoring `archived_at` to null on a second row would itself violate the same constraint. This
  deserves at least a "considered and rejected because X" entry in Alternatives — right now it's simply
  absent.

- **A wrapper RPC/stored procedure as the sole creation entry point, returning a structured result
  instead of relying on trigger-raised message-substring matching.** The plan already routes all
  creation through one shared client-side function (the UPDATE-by-id-then-INSERT-on-zero-rows helper).
  Since that chokepoint already exists, an alternative is to make the *insert itself* go through a
  `SECURITY DEFINER` function that does the limit check and returns an explicit typed result (e.g. a
  boolean/enum column in the response) rather than depending on the client parsing exception text. This
  avoids the fragility named in point 2 above. The plan's Alternatives section considers "RLS-only" and
  "client-only" but not this middle option, even though the plan's own precedent-reuse reasoning would
  apply almost as well to it.

Neither alternative invalidates the plan's core direction (server-side enforcement, not client-only) —
but the race-condition point in particular is a substantive miss, not a style preference, since it
undermines the "cannot be bypassed" requirement under ordinary concurrent use, not just adversarial use.

## 4. What's missing?

- **The archive/unarchive UPDATE bypass (Q1).** The single biggest functional gap. Should be an explicit
  edge case in Verification and a line item in the proposed approach.
- **The concurrency/race condition on the count check (Q3).** Worth at least a Risks entry; ideally
  closed by a uniqueness constraint rather than left as a count-then-insert race.
- **Flag reversibility when the authorizing relationship ends.** The plan grants "any DM who shares at
  least one campaign with the player" the authority to *set* the flag, and (implicitly, via the same
  mechanism) to *unset* it. But campaign membership is not static — a player can leave a campaign, or a
  DM can remove them from one. If the unflag function re-checks "does the caller currently share a
  campaign with this player" at call time (the natural way to implement the stated authority model),
  then a player flagged by a DM they've since parted ways with has **no one left with standing to unflag
  them** — not the original DM (no longer shares a campaign), not any other DM (never shared one). This
  directly contradicts the plan's own motivating goal ("so a human doesn't have to intervene by hand next
  time") — it recreates exactly the kind of stuck state requiring manual DB intervention that the whole
  feature exists to eliminate, just shifted from "duplicate characters" to "unremovable restriction."
  This needs an explicit answer (e.g.: unflag authority persists independent of current campaign
  membership; or only the flag-setting DM can unset it and that's recorded permanently; or flags expire;
  or a self-service unflag path exists) before this is safe to build, not as a follow-on note.
- **No notice to the affected player.** The plan gives one DM (of possibly several who happen to share a
  campaign with a player) the unilateral, silent power to restrict that player's account, with no mention
  of the player being informed when it happens or being able to see *who* flagged them or *why*. Given the
  motivating incident was a data-quality problem, not a trust/abuse problem, granting silent unilateral
  authority over another user's account capacity is a bigger step than the plan's framing acknowledges.
  Worth at minimum a "the player can see their own flag state and who set it" requirement.
- **Interaction with the *other* already-flagged task** (the campaign-scoped per-campaign character
  limit). The plan calls this orthogonal and out of scope, which is reasonable, but doesn't say what
  happens when both are active for the same player at once (e.g., does hitting either limit produce a
  distinguishable message, or would a player see two different "you're at your limit" errors depending on
  which trigger fires first, with no way to tell them apart)? Given both would presumably live on the same
  table with similarly-shaped triggers, a message-collision or trigger-ordering interaction between the
  two features seems likely enough to name explicitly, even just as a forward-looking note.
- **"Done when" checkability.** Most items are genuinely objective (regression suite clean, advisor
  clean, a decision record exists, toggling on/off has an observable effect). Two are not fully specified:
  "a clear message... in both tools" — "clear" is subjective; better stated as "an app-styled error
  string is shown, not a raw database error," which is checkable. And there's no done-when criterion at
  all for the archive/unarchive bypass or the concurrency race, because the plan doesn't yet recognize
  either as in scope — once added, they need matching acceptance criteria (e.g. "un-archiving a second
  character while at the limit is refused with the same message").

## 5. Should this be split into more than one plan?

Yes, at least the authority question should be resolved as its own decision before the code plan is
finalized — and the review above surfaces a concrete reason beyond the plan's own instinct: the "any DM
sharing a campaign" default doesn't just raise "who has standing to *restrict* a player" (which the plan
already flags as its biggest open question) — it also creates an unflag-reversibility failure mode (Q4)
that isn't mentioned at all. That's exactly the kind of "non-obvious trust-boundary/authority decision"
this project's own convention says gets a decision record, and it has direct consequences for how the
database function in step 3 must be written (does it check current campaign membership, historical
flag-setter identity, or something else?) — meaning the implementation can't actually be finalized until
this is settled. Writing the trigger/migration/UI code now, ahead of that decision, risks building step 3
against the wrong authority model and having to redo the unflag path once the reversibility gap is
noticed (likely in production, given it only shows up when a DM-player relationship later ends).

Suggested split:
- **Plan/decision A:** who may set and who may unset the flag, including what happens when the
  authorizing relationship (shared campaign) ends after the flag is set — resolved and recorded as a
  decision first.
- **Plan B (this plan, revised):** the schema/trigger/UI implementation, updated to (a) close the
  archive/unarchive UPDATE bypass, (b) address the count-check race condition (ideally via a uniqueness
  constraint rather than a trigger-only count), and (c) implement whatever authority model Plan A settles
  on.

The rest of the plan (schema shape, trigger-as-primary-mechanism, client error handling, out-of-scope
boundaries) is sound and doesn't need separate treatment — it's specifically the authority/reversibility
question, and the two enforcement-surface gaps found above, that warrant resolving before implementation
rather than during it.
