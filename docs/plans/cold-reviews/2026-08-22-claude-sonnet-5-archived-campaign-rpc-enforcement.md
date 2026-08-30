Reviewing as Claude Sonnet 5, default settings.

# Review: Server-side enforcement that an archived campaign is write-locked

## 1. Does this plan achieve its stated goal?

For the scope it defines, yes. The goal is narrowly "every DM-write path that mutates campaign settings
or a bound character's state rejects the write when the campaign is archived," and the plan enumerates
six such paths (five RPCs plus one RLS policy) and closes all six with the same mechanism. If the
enumeration is complete, the invariant becomes real rather than a UI convention.

The goal is *not* fully achieved at the level of "archived = frozen everywhere" — `character_dm_notes`
and the invitation subsystem remain open, by explicit, reasoned choice. That's a scope decision, not a
gap in execution, but it means "achieves its stated goal" is true of the goal as scoped, not of the
looser goal a reader might infer from the title alone. Worth making that distinction explicit in the
plan's own "Done when" line, which currently reads as if the invariant is now complete.

## 2. Are any "Verified" facts actually shaky?

Most of the verified section is fine — it reads as an actual grep result, not a recollection, and the
plan is unusually honest about the difference (the "two of five names don't exist as RPCs" correction is
exactly the kind of thing a lazier plan would have glossed over).

Two items in the verified list deserve a second look:

- **The `campaigns_update` grant is stated as covering only `ignore_player_ap` and `rules`.** That's
  presented as verified, but the plan never shows the full column list on that grant, only that those two
  columns are the ones relevant to the two missing RPC names. If the same grant/policy also covers other
  DM-writable columns (a campaign name, a settings blob, anything else), those columns get the same
  archived-lockdown for free from step 3 — which is probably desirable, but the plan doesn't say so, and a
  reader can't tell whether that's an intended side effect or an unexamined one. This should be listed as
  "assumed: `ignore_player_ap` and `rules` are the only DM-grantable columns on `campaigns_update`," not
  folded into the verified paragraph as a settled fact.
- **The ordering rationale ("call the guard after the authority check so an unauthorized caller doesn't
  learn archive state") is asserted as the reason for the ordering choice, but is never verified as
  correctly implemented** in the Verification section (see point 4 below). It's a good design decision;
  it just isn't checked.

Everything else in "Verified" reads as genuinely checked against the current tree, not inferred.

## 3. Is there a better alternative to the proposed approach?

The overall shape (one exception-raising guard for RPCs, one boolean predicate for the RLS policy,
deliberately not merging `is_campaign_dm()` itself) is sound, and the rejected trigger-based alternative
is rejected for a correct reason. One real DRY gap, though: `assert_campaign_active()` and
`is_campaign_dm_and_active()` each independently re-derive "archived_at is not null" / "archived_at is
null" against the same table. That's a small duplication today, but it's exactly the kind of duplication
this plan's own step 1 rationale (one guard, not six inline copies) argues against. A cleaner version:
define a single `is_campaign_active(p_campaign uuid) returns boolean` first, then have
`assert_campaign_active()` call it and raise, and have `is_campaign_dm_and_active()` call it and `and`
it with `is_campaign_dm()`. Same number of new objects, but the existence check exists in exactly one
place instead of two. Not a blocker, just a tidier version of the same idea.

No better alternative to the two-mechanism split itself (RPC guard vs. RLS predicate) — that split is
forced by the fact that these two write paths are gated by genuinely different mechanisms (function body
vs. row-level policy), and the plan's reasoning for why a shared trigger doesn't simplify that is correct.

## 4. What's missing?

- **A verification step for the ordering guarantee named in step 2 of "Proposed approach."** The plan
  asserts that placing the guard after the authority check prevents leaking archive state to an
  unauthorized caller, but the Verification section never actually tests "non-DM calls one of these five
  RPCs against an archived campaign and gets the *authority* error, not the *archived* error." That's a
  one-line addition to step 2 of Verification and it's the only place in the document where a stated
  design intention isn't checked.
- **The full column-grant list on `campaigns_update`**, per point 2 above — either confirm it really is
  just the two columns, or say explicitly that the fix's blast radius on that policy is "every DM-grantable
  column on `campaigns`," not just the two named ones.
- **An explicit expected-error assertion in Verification step 2.** "Confirm each is rejected server-side
  with the expected exception" doesn't say what the expected exception *is* — pin it to the literal message
  from `assert_campaign_active` (or a SQLSTATE) so a reviewer re-running this later has an unambiguous
  pass/fail, not "some error came back."
- Not missing, but worth naming as a risk rather than leaving implicit: the plan never states what happens
  to **in-flight requests** if `archive_campaign` runs concurrently with one of the six write paths — almost
  certainly fine (last-write-wins at the transaction level, no ordering guarantee promised either way), but
  a one-line "no ordering guarantee against concurrent archive/unarchive calls, and none is claimed" would
  close the question instead of leaving it unaddressed.

Nothing suggests a seventh write path was missed — the self-described grep methodology is reasonable, and
the plan is upfront that a second pass should re-run it before the migration ships.

## 5. Is the Verification section objectively checkable by someone who is not the plan's author?

Mostly yes. Steps 1, 3, and 4 are unambiguous pass/fail conditions a different engineer could run without
guessing at intent. Step 2 is checkable in spirit but has the one soft spot noted above (no pinned
expected-error text/code), which means two different people could reasonably disagree about whether a
given error response counts as "the expected exception." Tightening that one line would make the whole
section objectively checkable rather than almost so.

## 6. Should this plan split into more than one?

No — the scope boundary as drawn is the right one. The six paths share one invariant and one fix
mechanism, so keeping them in a single migration is appropriate; splitting them further would just be six
small PRs solving the same problem for no isolation benefit, since none of the six changes is riskier or
more separable than the others. Deferring `character_dm_notes` (blocked on an unrelated policy-shape
decision) and the invitation subsystem (recently hardened, avoid compounding two security-relevant changes
in one review) are both good reasons to exclude rather than include, not signs that this plan itself is
oversized. If anything, this document is close to the stated "roughly one screen" target being exceeded —
but the length comes from the honest verified/assumed accounting rather than padding, so I would not cut
content to hit the length target.

---

**Summary:** Sound plan, correctly scoped, mechanism is appropriate and reasonably DRY. Fix before
shipping: pin down the `campaigns_update` column-grant claim (verified vs. assumed), add the
non-DM-gets-authority-error check to Verification, and pin an expected error string/code in Verification
step 2. None of these change the approach — they tighten claims that are currently a notch looser than the
rest of an otherwise carefully self-audited document.
