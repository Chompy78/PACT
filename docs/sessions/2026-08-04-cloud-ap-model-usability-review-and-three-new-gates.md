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

---

# Part two — v1.343 → v1.358 (same day, continued)

The session kept going well past the point this note was first written. What follows is the second half.

## The AP model, again — and the same shape as before

The owner reported the DM Console roster flagging characters **"OVER BUDGET by 27 / 36 AP"** and correctly
identified that the deficit was measured against player AP alone. It is the same "who owns a value"
thread that ran through part one: `characters.ap` is server-owned and deliberately never written into the
character's log, but `dmAnalyze()` called `compute(b)` with **no opts** and reported `economy()`'s totals
— and `economy()` can only see the log. On a campaign running `ignore_player_ap`, the player pool is zero
*by design*, so the entire budget was invisible. Fixed in v1.358; Anders −15 → 12, Cedric −36 → 0.

**The diagnosis was nearly targeted at the wrong figure.** Cedric's −36 matches both the roster card's
"AP left" *and* the OVER BUDGET warning, because his log has no awards. Anders' card reads **−15**, not
−27. Only running the engine over both real logs showed the reported numbers were `compute().remaining`
(the warning), not `economy().available` (the card). **Two different figures were wrong from one shared
cause** — fixing the card alone would have left the warning intact and looked like a partial fix for no
reason. Reproduce the number the human actually read, not the nearest plausible one.

## Being wrong twice, in public, on the same bug

The species-pack investigation (`D-GH-2026-08-04-species-pack-ledger-drift`) produced two confident wrong
diagnoses in a row, both corrected by the owner:

1. "The identity step should have cost +15" — read the *final* build's line items as if they were that
   step's delta. The ideal delta was −4 against a recorded −5. It was fine.
2. "CharGen recorded four species traits as free that the engine prices at 21" — derived by comparing
   cumulative recorded cost against `compute()` on **truncated log prefixes**. Those are states that never
   existed (species traits owned with no species set), so `compute()` prices them as cross-race. The
   traits are pack-included and correctly 0, exactly as the owner said.

The generalizable rule, and the thing worth carrying forward: **`compute()` on a truncated event log is
not evidence.** The fold is order-dependent and intermediate states can be incoherent. Reason about the
final build, or about deltas the tool actually computed — never about a prefix of somebody else's log.

The real mechanism turned out to be more interesting than either guess, and is recorded in full in the
decision: the identity delta *refunds a phantom 21 AP the log never charged*, because `priceOf()` computes
against `compute(build)` while recorded costs are never held equal to it. Any divergence compounds.

## Two numbers, both right, on one screen

Fenwick Copperkettle exposed a genuine ambiguity rather than a bug: card "AP left" **−11** (frozen ledger,
36 − 47 paid) versus AP Ledger **4 over** (repriced, 40 vs 36). The 7 AP gap is ~3 of real price drift and
4 of drawback accounting. Both are correctly computed; they answer different questions.

Decision **G1**: "AP left" uses the frozen figure, because that is what the Live Sheet's `buy()` gate
enforces — it is the number that governs whether a player can actually spend. The divergence is accepted
and documented on `feat/ap-model-reconcile` rather than papered over. **I should have surfaced the
divergence before writing −11 into a table as if it were the answer**; the owner caught it by reading
their own ledger.

`apLevel` was deliberately left wrong (a fully DM-funded character reads "Earned Lv 0 · 0 earned"),
because it is wrong *identically* in the Live Sheet — fixing it in one tool would have traded a shared bug
for a new divergence between them.

## Process notes

**Stacked PRs do not auto-retarget.** #354–#357 were stacked and merged bottom-up on the assumption that
each would retarget to `preview` as its base merged. GitHub only does that when the base branch is
**deleted**. So #355, #356 and #357 each merged into their own stacked base and never reached `preview`,
which sat with #354 alone. Caught by noticing the task board had 11 entries instead of 15 — *not* by any
tooling. The recovery was clean because the deepest branch had accumulated all four, so one consolidating
PR (#359) landed the lot. **Merge stacked PRs top-down, or delete each base as it merges.**

**The local git proxy can serve a stale ref.** `git fetch` reported `preview` at the #354 merge for
several minutes after three more merges had landed, and a `BUILD` bump was applied on top of that stale
base before it was caught. When a merge's reported SHA and a local `git log` disagree, believe the API.

**Playwright auto-dismisses dialogs.** Three checks in the archived-campaign gate passed whether their
guard existed or not, because every `confirm()`-gated write took its cancel branch and never reached the
RPC. Verified by deleting the guards and watching the suite stay green. This is the second time in two
days the same trap has produced a vacuous pass — a Playwright check on a confirm-gated path should be
presumed vacuous until shown red.

**Production data work.** At the owner's direction: two `check-` diagnostic character copies, password
resets for two accounts, player-AP zeroing on four characters, and removal of a duplicated +36 DM award.
The one-character-per-campaign limit turned out to be a unique **index** that is also the TOCTOU race
guard for `bind_character_to_campaign` — my first constraint query missed it because it is an index, not a
constraint, and the insert failed rather than silently succeeding. Worth the reminder that
`pg_constraint` is not the whole story.
