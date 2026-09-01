# Plan — `feat/session-seal`: a DM-triggered per-session history seal

**Revision 2 (2026-09-01)** — rewritten after three cold reviews (GPT-5.6 Luna, M365 Copilot/GPT-5, and
a third self-identifying as GPT-4). All three said *revise before implementing*; all three landed on the
same central gap. See **Review outcome** at the foot for what was accepted, corrected, and rejected.

**Project:** PACT — a static, vanilla-JS tabletop-RPG character toolset. No frameworks, no build step,
no npm. Three browser tools share one rules engine (`js/engine.js`). Characters are an append-only event
LOG; every derived number is recomputed from that LOG at runtime, never stored. Optional sign-in adds
cloud save via Supabase (hosted Postgres + auth). Live data measured 2026-09-01: 35 characters, 8
owners, 4 campaigns, 461 log events.

**Step 2 of 2.** Step 1 (`D-GH-2026-09-01-undo-barrier-shared`) landed 2026-09-01: the "this history can
no longer be taken back" rule is now one shared engine function, `undoFloor(events)`, returning the number
of leading events a log may never shrink below. This plan builds on it.

## Goal

A DM draws a line under a character's history at the end of each session, ideally while awarding AP.
Everything before that line becomes permanent in **both** player tools: it cannot be undone and it cannot
be un-selected. Owner's words: *"each session, there is an undo lock put in place… it must apply to both
sheets so anything already bought can't be unselected."*

## Owner decisions (settled 2026-09-01 — no longer assumptions)

| # | Decision |
|---|---|
| **I2** | **DM *and* solo players may seal.** A campaign character is sealed by its DM; a player with no campaign may seal their own. |
| **J1** | **A DM may still append corrections after a seal.** A seal stops history being rewritten; it does not stop a later authorised change being recorded. |
| **K3** | **Everything before the seal freezes EXCEPT name / appearance / backstory**, which stay editable. |
| **L1** | **A rejected stale save keeps the client's work** and offers to reapply it. Never silently discarded, never silently merged. |

**These three decisions collapse into one rule, which is the central insight of this revision.**
J1 corrections *append*. K3 description edits can be made to *append*. A seal therefore needs no
per-event-type exception list and no "who wrote it" test. The single enforceable invariant is:

> **Once a seal is in the authoritative LOG, no write may alter the events at or before it. Anything
> may still be appended after it.**

J1 and K3 satisfy that by construction rather than by exemption. That is what makes this cheap enough to
enforce in one place.

## Verified facts

Read in the code and SQL; a reviewer should treat these as premises, not independently confirmed.

- **Award AP does not touch the LOG.** The DM Console's award writes a numeric column on the character
  row plus an audit ledger row. There is nothing in the history for a seal to attach to — the original
  reason this feature does not exist.
- **AP arrives by two independent paths** that both feed the same spendable total: that column, and
  `award` events in the LOG. One award written to both would double it.
- **A DM-append database function already exists**, privilege-checked, which strips and re-stamps
  authorship on every event so a browser cannot forge a DM-authored entry. Its allow-list currently
  accepts only a boon/drawback purchase, an AP award, and a boon removal.
- **Optimistic concurrency already exists, and is weaker than it looks.** `pushCharacter()` in
  `js/sync.js` issues its update with a compare-and-swap on a server-maintained `updated_at`, so a stale
  save matches zero rows and raises a conflict. But: (a) it is **opt-in** — when the client has no base
  value it sends an *unguarded* update that replaces the whole LOG; (b) the predicate lives in the
  **client's query**, so any write path omitting it bypasses the check entirely; and (c) it is row-level
  last-write-wins — nothing verifies the new LOG still contains the old prefix.
- **This guard has already failed in production.** `docs/HOW-TO-WORK.md` records 2026-08-07: a character
  went 43 AP spent → 47 → back to 43 across two browser profiles, *with the guard active*.
- **Description edits currently delete.** Editing a name or appearance field filters the old event out of
  the LOG — from wherever it sits — and appends a fresh one. Under a seal that would delete sealed
  history, which is why K3 needs the append-only change rather than a simple exemption.
- **The engine replays both as last-wins assignment** (`name` is a plain assignment; appearance patches
  are an `Object.assign`). Multiple such events replay correctly, so append-only supersession is safe by
  construction; "keep at most one" is tidiness, not correctness.
- **Signed save envelopes already exist** (tamper-evidence on file import), which is what limits the
  export→hand-edit→re-import escape route.
- Gates after step 1: engine parity 73/0, browser tool gate 184/0, barrier gate 19/0.

## Every LOG mutation path

The reviewers' strongest procedural point: naming a few UI paths is not durable. Full inventory, read
from the code — the two marked ★ were **missing from revision 1**, and one contradicts a claim it made.

| Path | Tool | Shape |
|---|---|---|
| Undo / redo snapshot restore | CharGen | replaces LOG — *guarded in step 1* |
| Undo pop | Live Sheet | pops tail — *guarded in step 1* |
| Checkbox un-tick | CharGen | **splices mid-log** |
| Patch-slot replace ★ | CharGen | **filters out prior slot event, appends** |
| Singleton replace (name, budget) ★ | CharGen | **filters out prior event, appends** |
| Whole-build rebuild (New Character, file load, 🎲 Randomise) | CharGen | replaces LOG from the form |
| **Import** ★ | **Live Sheet** | **replaces LOG wholesale — revision 1 wrongly said "no work expected"** |
| Reset | Live Sheet | empties LOG |
| Cloud save / autosave | both | replaces the stored blob |
| DM boon grant / removal | DM Console | appends via the privileged function |

## Phase 1 — the authoritative seal (do this first, alone)

All three reviewers asked for this split, and for good reason: this is the half where being wrong
corrupts real characters belonging to real people.

1. **Seal event schema.** A distinct type that *cannot carry an AP amount at all*, rather than carrying
   zero by convention. Server-authored actor, timestamp and stable id. Optional link to the award ledger
   row when sealed as part of an award.
2. **Database enforcement at a single choke point.** A `BEFORE UPDATE` trigger on the characters table
   that rejects any write whose sealed prefix differs from the stored one. A trigger, not a check inside
   one function, because it covers *every* path in the table above by construction — including paths that
   do not exist yet. This is the direct answer to "the predicate lives in the client's query".
3. **Make the existing concurrency guard mandatory**, closing the unguarded branch, so a client with no
   base value can no longer replace a LOG wholesale.
4. **Atomic, idempotent award-and-seal.** One transaction covering the AP column, the ledger row and the
   seal append; an idempotency key so a retry after a timeout cannot award AP twice.
5. **Extend the DM-append allow-list** to the new type; extend the engine barrier rule to recognise it.
6. **Migration is additive and retroactively seals nothing.**

## Phase 2 — the tools

7. **CharGen:** block the splice and every whole-build path from altering the sealed prefix; make
   description edits append-only under a seal; disable sealed controls with a **focusable, screen-reader
   associated** explanation, not a hover-only tooltip on a disabled element.
8. **Live Sheet:** guard Import and Reset (revision 1 wrongly assumed no work here).
9. **Conflict UX (L1):** on rejection, keep local work, reload the authoritative version, offer explicit
   reapplication of what is still legal. Distinguish "locked by your DM" from a generic save failure.

## The two tiers of enforcement (consequence of I2)

Because the invariant is "the sealed prefix is preserved", the trigger does not care who wrote the seal —
so a **solo player's own seal on a cloud character is enforced too**, not merely advisory. The residual
escape is export → hand-edit → re-import, which the existing signature check already flags as tampered.
A purely local, never-signed-in character has no server and therefore no enforcement; that is inherent.

## Out of scope

Changing how AP is awarded or stored. The creation lock and creation ceiling. Un-sealing (J1's append-only
corrections are the sanctioned route to fixing a mistake). Whether drawbacks stay purchasable after
creation — checked, working as designed.

## Alternatives considered

- **A1 — the AP award itself is the seal.** Rejected: doubles AP or forces a rewrite of a deliberately
  DM-only authoritative field. All three reviewers agreed.
- **A2 — seal Undo only.** Fails the un-select requirement. Usable as an internal checkpoint, never as a
  shipped feature.
- **A3 — CharGen read-only once sealed.** Blocks forward progress; wrong product.
- **A4 — a `sealed_through_event_id` column instead of a marker event.** Raised by two reviewers.
  Rejected: it stores derived state beside an event-sourced log, creating a second synchronisation
  obligation. With 35 characters, deriving the floor during save validation is cheap and correct.

## Risks

1. **A live migration** against 35 real characters. Additive only; retroactively seals nothing; verified
   recovery point before deployment.
2. **Deployment order and old clients.** A cached old page must not be able to erase a seal. The Phase 1
   trigger makes this safe by construction — which is a further argument for shipping Phase 1 first.
3. **Trigger correctness is now load-bearing.** A wrong prefix comparison could reject every legitimate
   save. Needs its own tests before it reaches live data.
4. **Log growth under K3.** Mitigated by only skipping the delete for events *under* the seal — one extra
   event per seal crossed, not one per keystroke.

## Verification

Phase 1 and Phase 2 each gate on the three existing scripts at **0 failed**, plus:

- **Migration safety:** snapshot character rows; migrate; assert LOGs, AP, ownership and campaign links
  unchanged and no seal added.
- **AP accounting:** seal-only moves spendable AP by exactly 0; award+seal moves it exactly once; a
  retried request does not award twice.
- **Atomicity:** inject failure at each stage of award-and-seal; assert all-or-nothing.
- **Barrier semantics:** no seal → unchanged behaviour; one seal → floor immediately after the marker;
  several → latest wins; post-seal events remain undoable.
- **The stale-client race, explicitly:** load revision R; append a seal server-side making R+1; attempt a
  save from R that removes a pre-seal event; assert rejection, an unchanged authoritative LOG, a surfaced
  conflict, and that unrelated local work is neither lost nor silently merged.
- **Every path in the mutation table** attempted against a sealed prefix, each asserting the stored LOG is
  structurally unchanged — including Live Sheet Import and CharGen Randomise.
- **K3 specifically:** a description edit on a sealed character succeeds, changes the displayed name, and
  leaves the sealed prefix byte-identical.
- **Authorisation:** a non-DM cannot append a seal to a campaign character by any exposed route.
- **Accessibility:** the locked explanation is reachable by keyboard and touch, not hover only.
- **Database advisor** after the migration: no new high or critical findings; new warnings documented.

## Done when

A DM awards AP with the lock option set and, in both tools, every purchase before that moment is frozen —
undo refuses it, its control cannot be un-ticked, and no save path can remove it — while new purchases and
description edits still work; with all gates at 0 failed and the change recorded in `CHANGELOG.md` and a
decision record.

---

## Review outcome (round 1, 2026-09-01 — three reviewers, all "revise before implementing")

**Accepted and folded in.** Server-side enforcement of the invariant at a single choke point (all three);
the full mutation-path inventory (all three, and it exposed revision 1's wrong "Live Sheet: no work
expected"); atomicity and idempotency for award-and-seal (Luna, M365); the concrete acceptance matrix
including the stale-client race (all three); the two-phase split (all three); accessibility of the locked
explanation (M365); an AP-incapable event type rather than a zero by convention (M365).

**Accepted with a correction to the reviewers.** All three implied no concurrency control exists. One
does — a compare-and-swap on a server-maintained timestamp — but it is opt-in, client-issued, and
row-level rather than prefix-preserving, and it has already failed once in production. The finding stands;
its stated basis did not, and was corrected against the code before acceptance.

**Rejected.** A `sealed_through_event_id` column (Luna, M365 both raised it and both stopped short of
recommending it) — see A4.

**Resolved by owner decision rather than by design.** DM-only vs solo (→ I2), post-seal corrections
(→ J1), what exactly freezes (→ K3), stale-client policy (→ L1).

**Not done:** the skill's fresh-subagent disinterested-judge pass on the scope-changing finding. This
session is configured not to spawn agents unless asked. Three independent reviewers already concurred, so
the finding does not rest on this session's own judgement — but the step was skipped, not passed.

**Round 2 reviewers,** if commissioned: the design questions are settled, so focus on whether the Phase 1
invariant is genuinely sufficient — is there a write path that could alter a sealed prefix without passing
through a `BEFORE UPDATE` on that table? — and on whether the verification section is now objectively
repeatable.
