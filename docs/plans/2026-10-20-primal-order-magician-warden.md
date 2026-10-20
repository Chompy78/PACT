# Plan: split the Druid feature "Primal Order" into Magician and Warden

Date: 2026-10-20 · Status: DRAFT for cold review · Supersedes: none (no prior plan covers Primal Order)

## Goal
Today the Druid feature "Primal Order" is a flat 5 AP purchase that does nothing at all. Replace it with the
two choices the 2024 D&D rules give it, so a Druid can buy **Magician**, **Warden**, or **both**:

- **Magician** — priced **6 AP** (owner-set). Gives one extra Druid cantrip, plus a bonus to Intelligence
  (Arcana or Nature) checks equal to the Wisdom modifier (minimum +1).
- **Warden** — **no price of its own** (owner decision "H1"). It makes the character proficient with all
  martial weapons and Medium armour by switching on the same four proficiency flags a player can already buy
  directly (Simple weapons, all martial weapons, Light armour, Medium armour). Those flags are priced by
  existing code, so Warden costs exactly what buying them by hand costs.

## Context (what a reviewer needs to know)
PACT is a static, vanilla-JS tabletop-RPG point-buy tool. Players spend **AP** (ability points) on a build.
A saved character is an append-only **LOG of events** (for example "buy feature X"); HP, AC, AP spent and
warnings are always recomputed from that log by `compute()` and never stored. One file, `js/engine.js`
(rules) with its data file `js/engine-data.js`, is the single source of truth for all rules; three UI tools
only display what it returns. Rules text for players lives in a Players Guide HTML that must be changed in
the same task as any mechanics change, or the task is not finished. `DATA.version` (the rules version) is
bumped exactly once, in the engine, only when mechanics change. A test page (`engine-parity`) must report
0 failed. The app has real users: 35 characters across 8 owners at the last count (a dated snapshot).

## Verified facts vs. assumptions
**Verified (read in code or live data on 2026-10-20):**
- `Druid: Primal Order` is in the data as tier T1 passive, 5 AP origin / 6 AP cross-class. Nothing in
  `compute()` reads it, so it grants nothing today.
- Weapon proficiency is priced from `b.weaponProf`: Simple 1, one martial weapon 2, all martial 8. All-martial
  without Simple raises a warning. Armour is priced from `b.armour`: Light 2, Medium 4, Heavy 6, Shield 2, and
  choosing Medium **automatically charges Light too**. Flags are on/off, so owning one twice costs nothing extra.
- Feature prerequisites (`prereq`) only look at other *features*. Simple weapons and Light armour are not
  features, so "Warden requires Simple and Light first" cannot use `prereq`.
- A renamed or removed feature key silently drops a saved purchase unless an entry is added to
  `DATA.featureAliases`; the engine's own comment says to add one whenever a key is renamed or removed.
- Live data: exactly **one player** owns Primal Order (four rows: main, old copy, DM copy, test copy). Each has
  a single buy event with recorded cost 5 and payload key `Druid: Primal Order`.
- Rules version is currently v0.377.

**Assumed (not yet checked):**
- A feature can be priced at 0 AP without special-casing in the pricing loop.
- Warden's flags can be applied at compute time without storing them (derive, don't store).
- A flat "+WIS mod to Arcana/Nature" skill-check bonus has no existing home in the engine; no precedent found,
  but the search was noisy. The cantrip half has a precedent (choice grants).
- Remapping the old key to Magician raises that player's computed total by 1 AP (5 recorded, 6 priced).

## Proposed approach
1. Branch `feat/primal-order-magician-warden` from `preview`.
2. **Data:** in `js/engine-data.js` replace `Druid: Primal Order` with two feature keys,
   `Druid: Primal Order (Magician)` (6 AP) and `Druid: Primal Order (Warden)` (0 AP). Add
   `featureAliases["Druid: Primal Order"] = "Druid: Primal Order (Magician)"`. Update the places that list
   feature names (the `FEAT_PG` page-number maps in CharGen and Live Sheet, and the feature-order lists).
3. **Engine:** in `compute()`, before the proficiency lines are priced, treat a build owning the Warden key as
   if `weaponProf.simple`, `weaponProf.allMartial`, `armour.light` and `armour.medium` were set. Add Magician's
   cantrip grant and its skill bonus (location to be decided in review).
4. Bump `DATA.version` once. Do not change the BUILD number (that happens at release promotion).
5. **Tests:** add fixtures: (a) Druid with Warden alone totals 15 AP across the two proficiency lines;
   (b) Warden after Simple and Light adds only the remainder; (c) Warden plus separately bought martial/Medium
   charges nothing extra; (d) an old-style log with `Druid: Primal Order` still replays and prices as Magician.
   Update `testing/expected/` if existing output changes.
6. **Guide:** change the Druid feature table row and add prose for both choices, in the served guide copy and
   in the separate master; verify the two stay consistent with the repo's guide-check script.
7. Log in the changelog and a decision record; run the parity test and the guide price check.

## Files / documents involved
`js/engine-data.js` (features, aliases, version), `js/engine.js` (`compute()` proficiency section, replay of
feature events), the Live Sheet and CharGen feature page-number maps, the test fixtures and expected-results
file, the Players Guide (served copy and master), changelog, decision record.

## Out of scope
Heavy armour or shields for Warden; any change to the proficiency prices themselves; other Druid features;
the rate-limiting and AP-model work already on the board.

## Alternatives considered
- **One feature with a stored choice field** (the owner's first choice, "E2"). Matches the book most exactly but
  needs a new choice mechanism; two feature keys behave the same to the player and fit existing patterns.
  *Deviation from the owner's pick — needs reviewer and owner sign-off.*
- **Warden as a priced 12 AP feature requiring Simple and Light first.** Needs a new engine check outside the
  `prereq` system and double-charges anyone who also buys the proficiencies.
- **Warden bundled at 15 AP.** Double-charges players who already own Simple or Light.
- **Drop Warden; Magician only.** Avoids the redundancy below, but not what the owner chose.

## Risks and open questions
- **Warden is a free shortcut.** A Druid gets nothing they couldn't already buy for the same price. That is a
  design choice the owner accepted, but the guide must not imply a discount.
- **The one live player's total may rise by 1 AP** (5 recorded, 6 priced), and some ledger code uses frozen
  recorded costs. Needs a decision: let it rise, or grandfather that player.
- Removing a Warden purchase later removes the proficiencies it implied unless bought separately.
- The Arcana/Nature bonus needs a place in the engine and the sheet display; if no clean one exists this
  grows beyond a small change.
- Guide and engine must land together; the guide's master is a separate project.

## Verification
- The parity test page reports 0 failed after fixtures (a)–(d) are added.
- The guide price check reports no new mismatch for the Druid rows.
- Replaying the real player's saved log (all four rows) produces no "no longer in the rules data" warning and
  the expected feature appears as Magician.
- Fixture (a) shows exactly 9 AP weapon proficiency plus 6 AP armour proficiency.

## Done when
Both choices are purchasable and non-exclusive, Warden's proficiencies price at 15 AP total with no double
charge, the existing player's purchase replays cleanly as Magician, rules version bumped once, tests pass, and
guide (both copies) and changelog/decision record are updated.

---
## Reviewer instructions
Start your reply with one line naming your model and any settings. Judge logic, clarity, scope and risk — you
cannot run code, so do not judge correctness you cannot verify from this text. Answer: (1) Does this achieve
the goal? (2) Which assumptions look shaky? (3) Is there a better alternative, especially to the two-key
design? (4) What is missing? (5) Is "Verification" objectively checkable? (6) Should this be split into several
plans? Save as `primal-order-magician-warden-review-<model>.md`.

## Review outcome
_To be filled in after review._
