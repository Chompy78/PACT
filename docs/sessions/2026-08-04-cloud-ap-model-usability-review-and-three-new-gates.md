# 2026-08-04 — the AP model, a usability review, and three new gates

One long session: v1.330 → v1.343, eight promotions. It started as five reported bugs and ended with the
test suite roughly doubled. The fixes are in `CHANGELOG.md` and the *why* of each in `decisions/2026/`;
this note keeps the reasoning that does not belong to any single change.

## The thread that ran through everything: who owns a value

Nearly every real defect this session was the same shape — **a value the server owns, read or written as
if the client owned it.**

- `characters.ap` read from a local cache (`peekCharacter()` prefers the local copy) on two paths that
  needed the server's number, so a player whose DM had just paid them saw 0 spendable AP.
- The Live Sheet's cloud save omitting `campaignId`, the input to `saveCharacter()`'s anti-fork guard —
  so a drifted id minted a new row instead of adopting the campaign's existing one, stranding an
  orphaned duplicate.
- `parseInt(x,10) || 79` rewriting a DM's deliberate `0`, because a falsy-zero is indistinguishable from
  "unset" to `||`.

The lesson that generalises: when a column is authoritative somewhere else, the function that reads it
should say so in its **name**. `refreshServerAp()` exists rather than a flag on `peekCharacter()` for
exactly this reason — both stale-AP bugs sat under comments confidently asserting the opposite of what
the code did, and a comment is not a defence.

## The mistake worth keeping: a placeholder is not a decision

`bind_character_to_campaign` was given an `absent → 79` default on the reasoning that "DM Console
displays 79, so granting 0 breaks a promise the UI makes." That shipped, and was reversed the same day.

The 79 is a hardcoded `value="79"` on an input **inside a collapsed `<details>`**. A DM who never
expanded that panel had not seen the field, let alone agreed to it. Paying out a full level-1 budget on
the strength of an HTML placeholder was the larger error.

Recorded in full at `D-GH-2026-08-04-starting-tier-level-band`, and deliberately kept as an addendum on
the original record rather than edited away: *"the UI already shows this number" is only an argument when
the number is something a human chose.*

## Never trust a green you have not seen fail

Three new gates landed (`cloud-e2e` 33, `dm-console-ui` 41, `chargen-flows` 26) and **every check was
verified red before being trusted.** That discipline earned its keep immediately — it caught three
vacuous passes in tests I had just written:

| Vacuous pass | Why it passed meaninglessly |
|---|---|
| Overflow assertion on a fieldset | Measured a **collapsed** section: width 0, so nothing could overflow |
| Feedback-button overlap check | Pointed at **CharGen**, which has no fixed bottom bar — passed with the fix reverted |
| "Rebinding does not grant twice" | Hit an early return, so the `ap_awards` guard it existed to protect **never executed** |

That last one is the sharpest: deleting the guard outright would have left the suite fully green. A test
that cannot fail is worse than no test, because it is counted as coverage.

## Triaging a review: the finding and its cause are two different claims

The usability review produced 25 findings. Investigating them, **three of four I checked named a
mechanism that was wrong while still pointing at something real nearby**:

- "The invite is dropped on sign-in" — the token provably survives the redirect. The symptom was
  Playwright auto-dismissing `confirm()`, routing the flow down the app's *declined* branch. That branch
  **was** a genuine one-way door (token wiped, no recovery) and is now fixed.
- "Invites never show as redeemed" — the whole chain verified intact against live data. The real problem
  was two panels going stale independently.
- "Console error during sign-in" — a sandbox artifact, as the reviewer suspected. It did expose a
  genuine unguarded `currentUser()` that left the signed-in panel half-populated.

None of these were wasted. But acting on the *stated cause* would have meant changing working code in
all three. The rule this produces: **reproduce the cause before fixing it**, and when writing findings,
keep the observation and the diagnosis as separate claims.

**Playwright auto-dismisses `confirm()` unless a handler is registered.** That single behaviour produced
the report's only CRITICAL and one of its HIGHs. It is now in the review prompt.

## Two gaps that were invisible because nothing exercised them

- **`service_role` had no table grants in production at all.** Nothing noticed because the app never uses
  that role — it is the browser client throughout, on the anon key under RLS. It surfaced the moment the
  seed script became the first thing to authenticate as it. Supabase's project defaults normally supply
  these, which is exactly why depending on them was wrong: `sql/rls-policies.sql` states its job is that
  a fresh project works.
- **DM Console had no automated UI coverage whatsoever.** `cloud-e2e` drives `campaign.js`/`dm.js`
  directly and never opens the console, and every other gate ran signed-out on a single page load. The
  rules panel — the screen a DM configures a campaign from — could break on any change with everything
  still green.

Both share a shape: *the thing nothing uses is the thing nothing tests.*

## Process notes

**Branch topology.** The review session's branch was merged straight into `main`, leaving `main` 20
commits ahead of `preview`. Since `preview` is the default branch and promotes *into* `main`, the next
promotion PR would have read as a revert of those commits. Caught before it did damage; the fix is to
merge `main` back into `preview` to re-converge. Worth watching whenever a branch lands outside the
normal `preview → main` flow.

**Reviewing against production.** The owner chose to run the review against the live project after being
shown what was actually in it — four real players, one active that day. That is a legitimate call once
the facts are on the table; the earlier assumption ("there isn't really anything important yet") was
reasonable and wrong, which is why checking first mattered. The safety story was tagging
(`@review.pact.test`, `[REVIEW]` prefixes) plus a purge that works off those tags and the schema's own FK
cascades, with a guard for the one cascade that is not safe alone — `characters.campaign_id` is
`ON DELETE SET NULL`, so a real character inside a review campaign would have been silently *unbound*
rather than erroring.

**A stale API is not a hung job.** `cloud-e2e` appeared stuck for 13 minutes; querying the job directly
showed it had completed successfully in 4.5. The check-runs endpoint was serving cached data. Query the
job, not the summary, before concluding something is wrong.
