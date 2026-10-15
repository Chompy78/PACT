# Plan: a character cannot spend more AP until its languages and spells are named

Branch: `feat/names-before-spending`. Supersedes: none (no earlier plan overlaps; the task entry in the task board is the only prior text).

## Goal
Once a character is locked, it cannot make a further AP purchase while any language or spell slot it owns still has a blank name. The block is on by default, for every campaign and for characters in no campaign. A DM can switch it off per campaign. "Finish creating" also refuses while a slot is blank. DM awards are never blocked.

## Context
PACT is a static, vanilla-JS tabletop-RPG character tool (no build step, no backend except a hosted database with row-level security). One file, `js/engine.js`, holds all game rules; three HTML tools (a character generator "CharGen", a play-time "Live Sheet", and a "DM Console") only draw the UI and call the engine. A character is stored as an event log (`LOG`); the engine folds the log into a build and prices it. Today a player can buy language slots and spell slots and never name them. Prices count slots only. Names live in a separate dialog, "✎ Name spells & languages", which writes a `names` event to the log. Sheets therefore carry blank slots indefinitely.

Owner decisions (2026-10-15), all fixed, not up for review:
- Gate applies from the creation lock on. Before the lock, players buy slots and name them at the end, so blocking mid-build would make creation unusable.
- Buying a slot itself is allowed. Only the NEXT purchase waits for the name.
- Per-campaign DM switch named `rules.requireNames`, default ON.
- On everywhere from release day, including all existing campaigns and characters, with no grace period and no migration that turns it off. Existing characters with blank slots will be blocked until they name them or their DM switches it off.
- No live measurement of the damage before this plan. (One earlier count: all 10 characters of one campaign, "Amble", had at least one blank language slot on 2026-10-12.)

## Verified vs. assumed
Verified (read in the code on 2026-10-15):
- `purchaseLegality(cur, cat, payload, opts)` in `js/engine.js` is the single "may this be bought" rule. It returns `{warnings, followup, rest, hard, soft, dup}`. Both Live Sheet `buy()` and CharGen post-lock purchases already call it; `opts` carries the campaign's settings (drawback cap etc.).
- `openNames()` exists separately in CharGen and in Live Sheet; each builds its slot list inline in the dialog code. CharGen's covers: languages (count `b.languages`, names `b.languageNames`), out-of-tradition cantrips (`dabblerCantrips`/`dabblerCantripNames`), innate spells by level (`innate`/`innateNames`), per-discipline cantrips and known spells (`traditions[].disciplines[]`: `cantrips`/`cantripNames`, `known`/`knownNames`), and free choice-grant spells (`grantNames`, which are NOT bought).
- Live Sheet's `openNames()` additionally handles epic-boon ability choices and a "swap" mechanism (`_nameSwapAvail`) for renaming known spells.
- A `names` event carries a `cost` and is priced by the engine (`e.type === 'names'`).
- Campaign settings reach the engine as `opts` / `opts.rules` (for example `rules.languages = {list, strict}` set in DM Console). CharGen builds `opts` in `_cgDmOpts()`; Live Sheet passes `campaignRules`.
- CharGen has `cgFinishCreating()`, which pushes a `creationLocked` event onto the log.

Assumed (not checked; the reviewer should treat as shaky):
- That Live Sheet also has fighting-style, metamagic and maneuver name slots (the task text lists them; only epic-boon was seen in the code).
- That every slot the dialog shows can actually be filled (a strict campaign language list could be empty; a spell list could have nothing eligible).
- That a character in no campaign has a place to carry the switch's default (no DM, so no way to turn it off).

## Proposed approach
1. Engine: add one exported helper `allNameableSlots(build)` returning `[{kind, slot, label, name}]`, one entry per owned slot, named or blank. Kinds: language, dabbler cantrip, innate, discipline cantrip, known spell, and whichever of the others the dialogs really render (the build carries `fightingStyleNames`, `maneuverNames`, `metamagicNames`). Choice-grant spells are excluded (they are free, not bought). Then `unnamedChoices(build)` = `allNameableSlots(build)` filtered to blank names. (Review fix: the dialog needs named slots too, so it cannot be built from blanks only.)
2. Make both `openNames()` dialogs build their slot list from `allNameableSlots` (the gate uses `unnamedChoices`), so the dialog and the gate cannot disagree. Do this as a behaviour-preserving refactor first, in its own commit.
3. Add the rule to the engine legality check: new function `namesGate(build, rules, {locked})` returning `{blocked, reason}`, called from `purchaseLegality()` (or a sibling that both tools' buy paths already call). Blocked when: build is locked, `rules.requireNames !== false`, and `unnamedChoices` is non-empty. The reason names the first missing choice and points at "✎ Name spells & languages".
4. Never block these: the `names` event itself, buy-off/refund, DM awards, and the purchase of the slot (the gate checks BEFORE a purchase, so a purchase that creates a blank slot is fine; the next one waits).
5. CharGen `cgFinishCreating()` refuses while `unnamedChoices` is non-empty (when the switch is on).
6. DM Console: a checkbox "Require spells & languages to be named before spending" in the campaign rules block, saved as `rules.requireNames`. Absent or true means on.
7. Both tools show the reason where a purchase is refused, with a button that opens the names dialog.
8. Players Guide: state the rule where languages and spells are bought, in both the served copy and the master copy.

## Files involved
`js/engine.js` (new helper, gate, export list); `tools/PACT-CharGen-Webtool.html` and `tools/PACT-Live-Char-Sheet.html` (dialogs, buy paths, Finish creating); `tools/DM-Console.html` (the switch); `docs/PACT-Players-Guide.html` plus its master copy in a separate project; a new end-to-end test script under `testing/`; `CHANGELOG.md`, a decision record.

## Out of scope
Pricing (no `compute()` output change, so no rules-version bump); DM awards; blocking before the lock; a grace period; any migration of existing campaigns; naming UI redesign; rate limiting.

## Alternatives considered
- Gate during creation too: rejected, creation becomes unusable (players buy several slots, then name them together).
- Default off, DMs opt in: rejected by the owner (wants it on everywhere).
- Per-campaign switch off for existing campaigns at release: rejected by the owner.
- Grace period with a warning first: rejected by the owner.

## Risks
- Release-day lockout: every locked character with a blank slot cannot spend, in every campaign. Known to include all 10 characters of one campaign. The only relief is the DM switch or naming.
- Deadlock: a slot that cannot be named (empty strict language list, no eligible spell) would block spending forever. The plan has no answer yet.
- No-campaign characters have no DM to switch it off.
- Dialog and gate drift apart if step 2 is skipped.
- The gate must not block the `names` event, or naming becomes impossible.
- Swap mechanism: renaming an already-named known spell must not count as blank.
- Cloud-saved characters: the gate runs in the browser only; the server does not enforce it. Assumed acceptable, since the game's other soft rules are the same.

## Verification
- `testing/tests/engine-parity.html` reports 0 failed.
- New headless script: for each fixture build, `allNameableSlots` matches the slot rows `openNames()` would render, and `unnamedChoices` is exactly those with a blank name.
- Exemption by construction: `saveNames()` in both tools does not call `buy()` or `purchaseLegality()` (checked), so the `names` event cannot be gated. A test confirms naming works while the gate is blocking.
- Spend-path inventory: list every code path that appends a purchase event (Live Sheet `buy()`, CharGen `_cgPostLockAppend`, and any other `emit` of a priced event) and show each passes through the gate; add a test per path.
- New end-to-end test, both tools: with the switch on, a locked character with a blank language cannot buy anything and is told which choice; after naming, the purchase succeeds; "Finish creating" refuses while a slot is blank; DM award goes through; with `requireNames:false` nothing is blocked.
- Pre-lock purchases are never blocked.

## Done when
The behaviours in Verification all pass in both tools, the DM switch saves and reloads, the guide states the rule in both copies, and the changelog and decision record are written.

## Reviewer instructions
- Start your response with one line naming your model and settings.
- Judge logic, clarity, scope and risk. Do not judge correctness you cannot check from this text alone.
- Answer: Does this achieve the goal? Which assumptions look shaky? Is there a better alternative within the owner's fixed decisions? What is missing (especially the deadlock risk)? Is the Verification section objectively checkable? Should this split into several plans?
- Write the answer as a `.md` file named `names-before-spending-review-<model>.md`.

## Review outcome
Round 1 (2026-10-15): one API reviewer, called as `gemini-3.8-flash`, which labelled itself "Gemini 2.5 Flash" (self-ID wrong). Filed at `z-cold/processed/2026-10-15-gemini-names-before-spending-plan.md` (local only, git-ignored).
- Accepted and applied: helper split into `allNameableSlots` + `unnamedChoices` (my wording made the dialog depend on blanks only); verification test rewritten; names-event exemption stated (verified: `saveNames` bypasses `buy`/`purchaseLegality`); spend-path inventory added.
- Accepted, not yet applied (needs owner): deadlock answer; no-campaign characters; DM release notice; split into two plans.
- Verified in code: Live Sheet `buy()` is the one buy chokepoint and already has a pre-purchase bar (`_lsBarGrant`), a precedent for where the gate goes.
