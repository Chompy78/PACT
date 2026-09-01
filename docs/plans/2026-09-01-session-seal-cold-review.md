# Plan for cold review — `feat/session-seal`: a DM-triggered per-session history seal

**Project:** PACT — a static, vanilla-JS tabletop-RPG character toolset. No frameworks, no build step,
no npm. Three browser tools share one rules engine (`js/engine.js`). Characters are stored as an
append-only event LOG; all derived numbers (HP, AC, AP spent) are recomputed from that LOG at runtime,
never stored. Optional sign-in adds cloud save via Supabase (hosted Postgres + auth), where DMs run
campaigns. Live data today: 25 characters, 8 owners, 4 campaigns — this is not a greenfield app.

**Step 2 of 2.** Step 1 landed 2026-09-01 and is assumed working; this plan builds on it.

## Goal

Let a DM draw a line under a character's history at the end of each game session, ideally as part of
awarding AP. Everything bought before that line becomes permanent in **both** player tools: it cannot be
undone, and it cannot be un-selected. The owner's words: *"each session, there is an undo lock put in
place… it must apply to both sheets so anything already bought can't be unselected."*

## Context

Three tools matter here. **CharGen** builds a character. The **Live Sheet** runs one in play. The **DM
Console** is the DM's view of their campaign roster. CharGen and the Live Sheet share one save format,
so the same character opens in either.

Step 1 centralised the rule for "this history can no longer be taken back" into the engine, because it
had been hand-written three times and two copies had drifted. It now exports `undoFloor(events)` — the
number of leading events a log may never shrink below — treating three things as barriers: a DM-stamped
edit, a non-discretionary AP award, and the "creation finished" marker. Both tools' undo now honours it.

That was groundwork, not the feature. Four things still block the goal, and this plan is about them.

## Assumptions vs. verified facts

**Verified** (read in the code and SQL this session):

- The DM Console's "Award AP" action writes a **numeric column on the character row** plus an audit
  ledger row. It never touches the character's event LOG. There is therefore nothing in the history for
  a seal to attach to — this is the single biggest reason the feature doesn't exist yet.
- AP reaches a character through **two independent paths** that both feed the same spendable total: that
  numeric column, and `award` events inside the LOG. Writing one award to both paths would double it.
- A database function already exists that lets a DM append events to a character's LOG. It is
  privilege-checked (DM of that character's campaign only), and it **strips and re-stamps** the
  authorship fields on every event, so a player's browser cannot forge a DM-authored entry. Its
  allow-list currently accepts only: a purchase of a boon or a drawback, an AP award, and a boon
  removal. Anything else is rejected outright.
- A DM granting a boon already writes a two-event pair through that function, and both events come back
  DM-stamped — so DM-written barrier events are a proven, working path, not a new mechanism.
- **In CharGen, un-ticking a checkbox physically deletes that purchase from the LOG** (a splice, mid-log),
  with no undo involved and no barrier check on that code path whatsoever. A lock wired only to the Undo
  button would leave every checkbox live.
- CharGen additionally has **whole-build replacement paths** (New Character, file load, 🎲 Randomise)
  that rebuild the LOG from the on-screen form. These can drop barrier events entirely. Pre-existing.
- The three automated gates all pass at 0 failed after step 1: the engine parity gate (73 assertions), a
  browser-driven tool gate (184), and a new pure-function gate for the barrier rule (19).

**Assumed** (not confirmed with the owner — please challenge these):

- The seal is **DM-only**. It follows from "me awarding AP", but a solo player with no DM has no way to
  seal, and it is not established whether that matters.
- Seals are **stackable** — many over a campaign's life, the most recent one setting the floor. Follows
  from "each session" but was never stated.
- **Existing characters are not retroactively sealed.** Nothing is frozen until a DM seals it.
- A sealed purchase should be visibly *explained*, not merely dead — a greyed control with no reason
  reads as a bug.

## Proposed approach

1. **A dedicated seal event, worth zero AP.** Not the award itself. The award keeps using the numeric
   column it already uses; the seal is a separate marker written to the LOG in the same DM action. This
   is what avoids double-counting AP, and it keeps "how much AP" and "what is frozen" independent.
2. **Database:** extend the DM append-events function's allow-list to accept the new marker type. It
   already stamps authorship, so the marker is tamper-evident for free.
3. **Engine:** teach the shared barrier rule about the new marker. One added case; the floor mechanism
   step 1 built needs no other change.
4. **DM Console:** the existing award form gains an "and lock history" option, plus a standalone "Lock
   history" action for sealing without awarding.
5. **Live Sheet:** no work expected — its undo already asks the shared rule, which will now recognise
   the marker.
6. **CharGen — the bulk of the work.** Three separate paths must respect the floor, not just undo:
   the checkbox-untick delete; the whole-build replacement paths; and the controls themselves, which
   must be disabled (with a tooltip saying why) for any purchase sitting under the seal.

## Documents and components involved

`js/engine.js` (the shared rule) · a new SQL migration (allow-list) · `tools/DM-Console.html` (the award
form) · `tools/PACT-CharGen-Webtool.html` (checkbox retraction, whole-build replacement, control
disabling) · `tools/PACT-Live-Char-Sheet.html` (expected: no change) · the barrier gate script.

## Out of scope

Changing how AP is awarded or stored. The creation lock and creation budget ceiling (adjacent, separate).
Whether drawbacks stay purchasable after creation — checked, working as designed, not a bug. Un-sealing
(a DM reopening a sealed session) — worth deciding, deliberately not designed here. Local/offline
characters, which have no DM to authorise a seal.

## Alternatives considered

- **A1 — make the AP award itself the seal**, no separate marker. Fewer moving parts and matches the
  owner's instinct exactly. Rejected: the award would have to move into the LOG to be a barrier, and it
  already lives in a column that feeds the same total, so it would either double the AP or require
  reworking a server-authoritative field that is deliberately DM-only.
- **A2 — seal the Undo button only.** Roughly a third of the work. Rejected as a finished state: it does
  not stop un-ticking, so it fails the owner's actual requirement, though it is a viable staging point.
- **A3 — make sealed purchases un-editable by making CharGen read-only once sealed.** Simple and
  airtight, but wrong: a sealed character must still be *buildable forward*; only the sealed part freezes.

## Risks

1. **Double-counting AP** if the seal ever carries an amount. Mitigated by design (0-AP marker), but it
   is the failure that would corrupt real characters, so it needs an explicit test.
2. **A live database migration** against 25 real characters owned by 8 real people. Must be additive and
   must not seal anything retroactively.
3. **CharGen's control-disabling could fight existing machinery** — the tool already force-unchecks boxes
   that become invalid, so "re-tick and disable the sealed ones" has to cooperate with that, not race it.
4. **Offline/late arrival.** A DM seals while a player is offline; the player has meanwhile undone
   purchases the seal was meant to cover. What happens on sync is undefined and this plan does not
   currently say. Possibly the sharpest open question here.
5. **Silent failure mode.** A too-weak barrier breaks nothing visibly — a player quietly erases something
   their DM did, and nobody finds out until the numbers disagree at the table.

## Verification

- All three existing gates back at **0 failed** (`engine-parity-ci.mjs`, `tool-pricing-ci.mjs`,
  `undo-barrier-ci.mjs`), run from the repo with no npm install.
- The barrier gate extended with the new marker, including a case proving a seal grants no AP.
- A browser check that a sealed character's affected CharGen checkboxes are disabled and cannot be
  un-ticked, and that its Undo refuses — the two halves of "can't be unselected".
- The database advisor run after the migration (this project has twice been bitten by permission drift
  that internal guards masked).

## Done when

A DM awards AP with the lock option set, and in **both** tools every purchase made before that moment is
frozen — undo refuses it and its control cannot be un-ticked — while new purchases after it behave
normally; with all gates at 0 failed and the change recorded in the project's changelog and decision log.

---

## Reviewer instructions

Begin your response by stating which model you are and any relevant settings.

You have **no access** to this repository, so judge **logic, clarity, scope and risk** — not correctness
you cannot verify from this text. If something is unverifiable from the document alone, say so rather
than guessing at it.

Answer each of these:

1. Does this plan actually achieve the stated goal?
2. Which assumptions look shakiest, and what would you do about them?
3. Is there a better alternative than the chosen approach — including among the three rejected?
4. What is missing? Pay particular attention to risk 4 (the offline/late-arrival case), which the plan
   itself flags as underspecified.
5. Is the verification section **objectively checkable**, or does it rely on judgement calls?
6. Should this be split into more than one plan?

Output your review as a markdown file named `session-seal-review-<your-model-name>.md`.

---

## Review outcome

*(to be filled in after reviews return)*
