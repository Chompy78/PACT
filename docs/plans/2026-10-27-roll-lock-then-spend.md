# Plan: "Accept rolled character" — lock after a random roll, then spend the rest in play

Task: `feat/roll-lock-then-spend`. Status: PLAN FOR COLD REVIEW — nothing is built. Supersedes the design notes in `docs/plans/2026-10-04-chargen-creation-ceiling.md` §8.

## Goal

A player using the character generator's random roll on a character whose DM has set a creation limit (an AP ceiling for building the
character) should get: a rolled character built up to that limit; a persistent **Accept rolled character** button; and, when it is pressed,
the character is locked ("creation finished") and the rest of its spendable AP is spent automatically as ordinary in-play purchases. Until
Accept is pressed the roll can be thrown away and re-rolled.

## Context (everything a reviewer needs; they have no repo access)

PACT is a static, vanilla-JS tabletop-RPG toolkit (no framework, no build step). A character is an append-only event log (`LOG`); a pure
rules engine folds it into a build and prices it. Three tools share the engine: **CharGen** (a whole-build form editor used to create a
character), **Live Sheet** (in-play sheet; every purchase appends one event) and **DM Console**.

- **Creation lock.** CharGen's "Finish creating" appends a `creationLocked` event. Before it, CharGen rewrites history freely (the form is the
  source of truth and prices are the cost of the whole build). After it, nothing bought may be removed, and each purchase is an **in-play
  purchase**: one appended event `{type:'buy',cat,payload,cost,label,gp,days}` priced by the engine's `priceOf()`, legality-checked, and
  stamped with gold and downtime charges when the campaign economy is on. CharGen already has this post-lock path for every slot
  (`_cgPostLockAppend(steps)`, steps are `{cat,payload,label}`); the Live Sheet records the same events. The lock is an undo barrier.
- **Creation ceiling (PR #561).** If the DM stamped a limit, CharGen refuses any pre-lock edit that raises spend past it, and the random roll
  is capped at it ("limit + the AP its drawbacks grant"). The remainder is then "spent in play after Finish creating" — by hand today.
- **The roller.** `randomizeRoll(theme, level)` (~540 lines, one closure) clones the current form build `b`, then runs many `tryAct(mutation,
  bucket)` calls: each applies a closure like `x => { x.hd++ }` to `b`, prices the result with `compute()`, and keeps it only if total ≤ budget
  and no new hard warning appears, else restores a JSON snapshot. It returns only the final `b`; **the accepted mutations are not recorded**.
  It applies `b` as one burst (`replaceWholeLogFromBuild`), then re-appends any carried lock event AFTER the burst on purpose: a lock placed
  before it would make every burst event replay as in-play and be re-priced (own-species traits cost more in play).
- **Rules that constrain the design.** (R1) After the lock a *new drawback* is refused (it grants AP; only the DM may impose one). (R2) After the
  lock nothing may be lowered or removed. (R3) A "names gate": once locked, no AP may be spent while any language or spell slot the character
  owns is still unnamed; a roll leaves them blank. (R4) A finished character cannot be re-rolled (the roller refuses); the DM can reopen creation.

## Verified facts vs assumptions

Verified (by reading the code, 2026-10-27; nothing was run): `tryAct` does not record accepted mutations; the roller keeps no state about the
roll after it returns; there is **no function that turns "current build + target build" into purchase steps** — only per-slot plan builders
(hit dice/proficiency, ability scores, languages, vigor, ki/sorcery, attunement, armour, weapon proficiency, free subclass) and a pure
spellcasting diff (`_cgTraditionSteps`); flat categories (skills, tools, boons, arts, features, subclass abilities) are bought one step at a
time; `_cgPostLockAppend` raises `confirm`/`alert` dialogs (soft warnings, wallet shortfall, trade offer) and returns false on any refusal, so
it cannot run unattended; `cgFinishCreating(true)` locks without a confirm but is blocked by the names gate; autosave stores only the LOG, its
counter, name, id and campaign — there is no side flags object; no code reads a "rolled" flag today.
Assumed (unchecked): an unknown LOG event type is ignored by the engine fold and accepted by the server's history triggers (the server freezes
only a fixed list of event types); a roll's AP can always be re-spent in play (in-play prices can exceed creation prices, so the "rest" may not
fit exactly).

## Proposed approach

**Design A (recommended): decide everything at roll time, store a deterministic remainder.**
1. Let the roller run to the FULL spendable budget (not the cap) and record, after every accepted `tryAct`, a snapshot of the build and its total.
2. Pick the **cut**: the last snapshot whose creation-priced total ≤ the cap (+ drawback AP). That snapshot is the creation character and is
   applied exactly as today (one burst, one undo step, unlocked). Drawbacks and identity (species, class) are chosen before the cut or are kept
   inside it, because they cannot be bought after the lock (R1).
3. Compute the **remainder** = final build minus cut snapshot, expressed as an ordered list of purchase steps `{cat,payload,label}`. This needs a
   new pure helper `buildToSteps(cur, target)` that reuses the existing per-slot plan builders and `_cgTraditionSteps`, and hand-builds the flat
   steps; order: hit dice, proficiency, ability scores, training, then features/powers, so each step's prerequisites hold. It refuses (returns
   an error, never a partial list) on anything it cannot express, in which case the roll simply stops at the cut with no Accept button.
4. Store `{steps, rolledAt}` as the **pending remainder** (see Open Question Q3 for where).
5. **Accept** = (a) resolve the names gate (Q2), (b) `cgFinishCreating(true)` to lock, (c) call a new unattended mode of `_cgPostLockAppend`
   (`opts.unattended`): no dialogs, each step priced, legality-checked and gold/downtime stamped as in play; a step that no longer fits is
   skipped and reported, not forced; (d) clear the pending flag; (e) report what was bought and what was skipped.
6. The button is visible while a pending remainder exists and the character is unlocked; any manual edit, New Character, load or re-roll clears it.

**Design B (alternative): a second roller pass after the lock.** Refactor the roller's spend phase into a pure function `rollSpend(build,
budget, allowedCats)` that can start from an arbitrary (locked) build and may only buy in-play-legal things; Accept locks, runs it with the
remaining AP, then converts the resulting build to steps with the same `buildToSteps`. Cleaner semantics (the remainder is rolled with
in-play prices) but it needs the 540-line closure split open and it re-rolls choices the player has already seen the cut of.

## Files involved

`tools/PACT-CharGen-Webtool.html` (roller, Accept button and visibility, `buildToSteps`, `_cgPostLockAppend` unattended mode, flag
storage); possibly `js/ui-helpers.js` (shared text); tests `testing/scripts/chargen-flows-e2e.mjs`, `random-quality-ci.mjs`,
`post-lock-parity-fuzz.mjs`. No engine change, no rules-version bump, no SQL unless Q3 picks a LOG event.

## Out of scope

Changing the roller's choices; re-rolling after Accept (R4 stands); Live Sheet; the DM-side Reopen flow; any server rule.

## Alternatives considered

(1) Do nothing: the player presses "Finish creating" and spends the rest by hand (today). (2) Lock first and re-run the whole roller (the
existing D-GH34 ordering makes it re-create and re-price the character as creation). (3) Make the roller lock itself with no Accept button:
rejected by the owner, because a rolled character must stay re-rollable until accepted.

## Risks

Highest: `buildToSteps` silently mis-mapping a slot and buying or pricing the wrong thing (mitigation: a randomised property test that
folds `cut + steps` and requires it to equal the final build, over thousands of seeded rolls; any difference fails). The roller's quality
gates must stay green. Cloud autosave: the lock must be appended before the purchases, and the debounced push must not send a half-spent
state that the server's frozen-history check rejects (assumed: it only freezes what is already stored). The names gate can leave Accept
unable to lock; the wallet can make later steps unaffordable. Undo: the lock is a barrier, so after Accept the roll cannot be undone.
Added after review: (1) **unattended mode** must keep every gate that the dialogs only presented — the names gate, the legality check, the
house-rules-unknown block — so it must be impossible for it to buy something the interactive path would have refused; (2) **Accept must be
idempotent** (a double click, or an autosave firing between the lock and the last step, must not buy anything twice or push a half-spent
state): disable the button on first press and run the whole sequence as one synchronous batch before autosave can fire; (3) **no partial
failure after the lock** — events cannot be rolled back, so the whole step list is simulated on a virtual build first (the existing
`_cgPostLockAppend` already checks affordability for a whole edit before appending anything) and any step that does not fit is dropped from
the list BEFORE anything is appended, then reported.

## Verification

(a) A seeded roll on a limited, unlocked character stops at the cut, shows Accept, stays re-rollable; (b) Accept locks and appends the stored
steps as in-play events; in a 1,000-roll seeded property test the applied steps and the reported skipped steps TOGETHER partition the
difference between the cut and the final build (applied + skipped = final − cut, no step in both), and with nothing skipped the folded build
equals the roll's final build; (c) each appended event is identical in cat/payload/cost/gp/days to the same purchase
made through the Live Sheet's `buy()`; (d) no dialog opens during Accept; (e) reload with a pending remainder still shows the button (per
Q3); (f) `random-quality-ci` and `chargen-flows-e2e` stay green; (g) pre-lock behaviour of the roller without a ceiling is byte-identical; (h) a second press of Accept, and an autosave forced between the lock
and the last step, change nothing (the LOG after both equals the LOG after one press); (i) with the names gate unsatisfied, Accept neither locks
nor buys, and the unattended path cannot be made to buy past the gate.

## Done when

A rolled character on a limited campaign ends at its limit, the player presses Accept, and the character is locked with the rest of its AP
spent in play at in-play prices, with the checks above passing.

## Open questions for the owner (recommendations in brackets)

- **Q1.** Design A (record-and-cut) or Design B (second pass)? [A: smaller, deterministic, and testable by comparing folded builds.]
- **Q2.** The names gate blocks the lock while languages/spell slots are unnamed. On Accept: auto-pick the names, or stop and open the Name
  dialog first? [Open the dialog first; auto-naming would invent the player's choices.]
- **Q3.** Where does "pending remainder" live so it survives a reload? (a) a new LOG event; (b) a per-character browser-storage key;
  (c) nowhere (the button disappears on reload). [(a) only if the engine and server verifiably ignore an unknown event type, else (b).]
- **Q4.** If a stored step no longer fits at in-play prices (or the wallet is short with the economy on), skip it and report, or abort the
  whole Accept? [Skip and report; wallet-short purchases proceed only if the player confirms the one trade offer shown up front.]
- **Q5.** Should cloud autosave keep running while a roll awaits acceptance? [Yes.]

## Reviewer instructions

1. First line of your reply: state your model name and any settings you can see. Do not guess if you cannot tell.
2. Judge logic, clarity, scope and risk. You cannot run the code; do not claim to have verified anything you only read.
3. Answer exactly these questions, each under its own heading: (i) Does the plan achieve the goal? (ii) Which assumptions look shaky, and
   what would you check first? (iii) Is there a better alternative to Design A and B, and which would you pick? (iv) What is missing from
   the risks or the verification? (v) Is the Verification section objectively checkable — name any item that is not. (vi) Should this be
   split into several plans, and if so where? (vii) For Q1–Q5, give your own recommendation and a one-line reason.
4. Be concrete and short (under 700 words). Output a Markdown file.

## Review outcome (2026-10-27)

Two reviews by free-tier API (raw outputs in `docs/plans/cold-reviews/`): Gemini API (`gemini-3.1-flash-lite`) and Groq API
(`openai/gpt-oss-120b`); an OpenRouter attempt returned errors on every free model and was dropped. Both models mis-identified themselves
(`gemini-1.5-flash`, `gpt-4`) — logged under the model actually requested. Every finding was checked against the plan and the code before use.

Accepted: Design A over B (both reviewers); open the Name dialog, do not auto-name (both); skip-and-report, decided in a pre-flight so nothing
partial is appended (both, and the pre-flight is new); keep cloud autosave running (both); the three extra risks and two extra checks above
(Gemini: unattended-mode bypass and the names gate; Groq: double-click and autosave race, partial failure); tightening of check (b) (Gemini);
**split into two PRs** — (1) the pure `buildToSteps` plus the unattended `_cgPostLockAppend` mode and the property test, with no UI; (2) the roll
cut, the stored remainder and the Accept button (Gemini two plans, Groq three; the third, a server plan, is unnecessary once Q3 avoids a new LOG event).
Q3: both lean to a browser-storage key; checked — the engine's fold skips any event whose type is not `buy`/`name`/`names`/`dmHouseRules`, and
the server's frozen list is a fixed set of types, so a new LOG event would work, but it would put ephemeral client state in the append-only
history, so the recommendation becomes a per-character browser-storage key kept beside the autosave (cross-device it degrades to today's
behaviour: no button, finish and spend by hand).

Rejected: Groq's "hybrid" (it is Design A: steps are descriptors priced at append time, which the plan already says); Groq's claim that the plan
assumes in-play prices never exceed creation prices (the plan says the opposite and has the skip path); Groq's tampering concern about a stored
LOG event (a client can already forge any event; the server enforces AP integrity independently, and the recommendation avoids the event anyway).

Still needs the owner: Q1–Q5 above (recommendations stand, Q3 revised to the browser-storage key).
