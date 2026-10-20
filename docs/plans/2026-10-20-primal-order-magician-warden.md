# Plan: split the Druid feature "Primal Order" into Magician and Warden

Date: 2026-10-20 · Status: DRAFT for cold review, round 2 (round 1 outcome is at the bottom; the plan has grown
since: Cleric Divine Order, free feat proficiency and a grandfathered grant were added) · Supersedes: none

## Goal
Today the Druid feature "Primal Order" is a flat 5 AP purchase that does nothing at all. Replace it with the
two choices the 2024 D&D rules give it, so a Druid can buy **Magician**, **Warden**, or **both**:

- **Magician** — priced **6 AP** (owner-set). Gives one extra Druid cantrip, plus a bonus to Intelligence
  (Arcana or Nature) checks equal to the Wisdom modifier (minimum +1).
- **Warden** — **no price of its own** (owner decision "H1"). It makes the character proficient with all
  martial weapons and Medium armour by switching on the same four proficiency flags a player can already buy
  directly (Simple weapons, all martial weapons, Light armour, Medium armour). Those flags are priced by
  existing code, so Warden costs exactly what buying them by hand costs.

**Added 2026-10-20 (owner decision U1): the same split for the Cleric's Divine Order.** It has the identical
shape — `Cleric: Divine Order (Protector/Thaumaturge)` is a priced 5 AP origin / 6 AP cross-class feature with no
effect in `compute()`. Replace it with two keys, mirroring Primal Order:
- **Protector** — no price of its own; switches on Simple, all martial weapons, Light, Medium and Heavy armour
  flags, so the existing lines charge about 21 AP in total (1 + 8 + 2 + 4 + 6).
- **Thaumaturge** — one extra Cleric cantrip plus a bonus to Intelligence (Arcana or Religion) checks equal to
  the Wisdom modifier (minimum +1). **6 AP**, mirroring Magician (owner decision V1a, 2026-10-20).
No live character owns the old key (checked 2026-10-20), so no live character needs migrating, but the old key
is still barred the same way, since local files and exports can hold it.

**Added 2026-10-20 (owner decision W3/X1): free proficiency from feats is made real in the engine.** The guide
says Chef, Crafter and Musician give their skill/tool/instrument proficiency free, but the engine grants nothing
(a comment at the tools pricing step says the old free-grant fields were removed as never used and that
bringing them back needs a fixture). The owner's rule: the granted proficiency is **added** to the build and
**counts toward the number owned**, so it makes the character's *other* skills and tools cost more (the table
price climbs with the count). That is the **opposite of the guide's "treated as the last one bought"** wording,
so the guide changes too. In pricing terms: paid cost = table price for (paid + free) minus table price for
(free), i.e. the free ones are counted first. Live measurement 2026-10-20: no character owns Musician, Chef or
Crafter, so no saved character reprices today. The tools price path and the skills price path both need it.

## Context (what a reviewer needs to know)
PACT is a static, vanilla-JS tabletop-RPG point-buy tool. Players spend **AP** (ability points) on a build.
A saved character is an append-only **LOG of events** (for example "buy feature X"); HP, AC, AP spent and
warnings are always recomputed from that log by `compute()` and never stored. One file, `js/engine.js`
(rules) with its data file `js/engine-data.js`, is the single source of truth for all rules; three UI tools
only display what it returns. Rules text for players lives in a Players Guide HTML that must be changed in
the same task as any mechanics change, or the task is not finished. `DATA.version` (the rules version) is
bumped exactly once, in the engine, only when mechanics change. A test page (`engine-parity`) must report
0 failed. The app has real users: 40 characters at the last count, 2026-10-20 (a dated snapshot).

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
- (Resolved) The legacy flag exists: `bar:true`. Its CharGen guard blocks new purchases there; whether the Live
  Sheet and DM Console block them too is not yet confirmed.
- (Superseded) The first draft aliased the old key to Magician, which would have raised the live player's total
  by 1 AP. Dropped in favour of the legacy item above.

## Proposed approach
1. Branch `feat/primal-order-magician-warden` from `preview`.
2. **Data:** in `js/engine-data.js` replace `Druid: Primal Order` with two feature keys,
   `Druid: Primal Order (Magician)` (6 AP) and `Druid: Primal Order (Warden)` (0 AP). **Do not alias the old
   key** (owner decision Q3, 2026-10-20: the one live owner chose Warden). Keep `Druid: Primal Order` in the
   data as a **legacy item** by setting the existing `bar:true` flag on it (verified: the flag keeps a feature in
   `DATA.features` so an owned one still prices, hides it from the purchase menus, and excludes it from new
   purchases; it is already used on the four Weapon Mastery features). It stays priced at its recorded 5 AP so
   the live character's total does not move. **Owner decision Y1 (2026-10-20): for the one live owner it keeps
   granting Warden's real benefit — all martial weapons and Medium armour — but NOT Simple weapons and NOT
   Light armour.** That is a state the normal ladder forbids (all-martial without Simple raises a warning;
   choosing Medium auto-charges Light), so this needs a grandfathered grant that skips the prerequisite warning
   and the Light charge. **Owner decision Z1: it adds no further charge — the 5 AP already paid covers the
   martial and Medium parts** (the one deliberate exception to the "no undercut" principle, for one character
   who bought it in good faith). The sheet code that reads proficiency (weapon and armour display, armour
   eligibility) must see the grant. Apply `bar:true` to `Cleric: Divine Order (Protector/Thaumaturge)` too.
   Update the places that list feature names (the `FEAT_PG` page-number maps in CharGen and Live Sheet, and
   the feature-order lists).
3. **Engine:** in `compute()`, before the proficiency lines are priced, treat a build owning the Warden key as
   if `weaponProf.simple`, `weaponProf.allMartial`, `armour.light` and `armour.medium` were set. Add Magician's
   cantrip grant and its skill bonus (location to be decided in review). Do the same for Cleric Protector
   (adding `armour.heavy`) and Thaumaturge. Add the grandfathered legacy grant described in step 2. Add the
   free feat proficiency: feats that grant one (Chef, Crafter, Musician) add it to the tools/instruments or
   skills list at compute time, counted first, so paid cost = table price(paid + free) - table price(free).
4. Bump `DATA.version` once. Do not change the BUILD number (that happens at release promotion).
5. **Tests:** add fixtures: (a) Druid with Warden alone totals 15 AP across the two proficiency lines;
   (b) Warden after Simple and Light adds only the remainder; (c) Warden plus separately bought martial/Medium
   charges nothing extra; (d) an old-style log with `Druid: Primal Order` still replays at 5 AP, grants all
   martial weapons and Medium armour but not Simple or Light, raises no warning, and cannot be bought again;
   (e) Warden dropped after Simple was bought separately leaves Simple in place (only if a removal path
   exists); (f) a character with Musician: the instrument is present, is counted first, and the next tool
   costs the higher table price; (g) Cleric Protector totals about 21 AP across the lines; (h) a Cleric and a
   Druid log from before the change still replay with no "no longer in the rules data" warning.
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
- **The live player's character stays unchanged** (legacy item at 5 AP). Verified 2026-10-20: they own no Simple
  weapons and no armour, are at Hit Die 3 with Strength 10, and have roughly 80 AP unspent (rough arithmetic:
  79 base + 105 awarded - about 103 recorded spend). Under decision Y1/Z1 the legacy item keeps granting all
  martial weapons and Medium armour (not Simple, not Light) for the 5 AP already paid, so no swap is needed.
  Any build that owns the legacy key gets the same grant. If a DM ever wants to move that player to the new
  Warden, the shipped `dmDiscount` event (DM-only, any priced purchase, up to its full price, AP only, never
  alters the build; migration applied in production, one live discount exists) can discount the legacy
  purchase by 100%; the engine has no way to remove a purchased feature (`dmRemoveBoon` is boons only).
- **The grandfathered grant is a one-off state the ladder forbids** (martial without Simple, Medium without
  Light). It must not leak: it applies only to the legacy key, and the new Warden/Protector keys use the
  normal flags and prices.
- **Free feat proficiency reverses a stated guide rule** ("counted last"); the guide must change with the
  engine. No live character is affected, but local files could hold the feats.
- Per owner decision AB1 the guide gets no new "loophole" rule; the DM's existing authority (the guide's
  section on the DM's final say over any purchase) is relied on instead.
- Removing a Warden purchase later removes the proficiencies it implied unless bought separately.
- The Arcana/Nature bonus needs a place in the engine and the sheet display; if no clean one exists this
  grows beyond a small change.
- Guide and engine must land together; the guide's master is a separate project.

## Verification
- The parity test page reports 0 failed after fixtures (a)–(h) are added.
- The guide price check reports no new mismatch for the Druid and Cleric rows.
- Replaying the real player's saved log (all four rows) produces no "no longer in the rules data" warning,
  still totals the same AP, and shows all martial weapons and Medium armour but not Simple or Light.
- Fixture (a) shows exactly 9 AP weapon proficiency plus 6 AP armour proficiency.

## Done when
Both choices of Primal Order and of Divine Order are purchasable and non-exclusive, Warden prices at 15 AP and
Protector at about 21 AP with no double charge, the existing player's purchase replays at the same total with
martial weapons and Medium armour only, feats that grant a proficiency add it and make later ones dearer,
rules version bumped once, tests pass, and guide and changelog/decision record are updated.

---
## Reviewer instructions
Start your reply with one line naming your model and any settings. Judge logic, clarity, scope and risk — you
cannot run code, so do not judge correctness you cannot verify from this text. Answer: (1) Does this achieve
the goal? (2) Which assumptions look shaky? (3) Is there a better alternative, especially to the two-key
design? (4) What is missing? (5) Is "Verification" objectively checkable? (6) Should this be split into several
plans? Round 2 asks you to look hardest at three new parts: the grandfathered legacy grant (can it leak to
other characters?), the "free proficiency counted first" pricing formula (is it right and does it need a
migration for saved logs?), and whether the plan is now too big for one change. Save as
`primal-order-magician-warden-review-<model>.md`.

## Review outcome
Round 1, 2026-10-20: two API reviewers, no severe or contested findings, so no fresh-agent judge was needed.
- **Gemini API (gemini-3.1-flash-lite)** — its self-ID line said "GPT-4o, Temperature 0", which is wrong; filed under the model requested.
- **OpenRouter (nvidia/nemotron-3-super-120b-a12b:free)** — self-ID matched.

Both: the plan achieves its goal, the two-key design is the right fit, and it should stay one plan.

| Finding | Source | Verdict |
|---|---|---|
| The +1 AP for the one live player needs an explicit decision | both | **Open — owner decision.** Already a listed risk; decision record must state the choice |
| Add a fixture: buy Warden, buy Simple separately, drop Warden, Simple stays | Gemini | **Accept → test (e).** A feature-removal path was not found, so confirm it exists first |
| Guide must say Warden has no price of its own, so its cost is not misread | Gemini | **Accept → doc-note** |
| Zero-AP pricing, derived flags, skill-bonus location are unproven | both | **Already in Assumed.** Prove each before implementing; the bonus location is the biggest unknown |
| Version bump scope | Nemotron | **Partly accept → doc-note.** Labels read `DATA.version` live, so no extra edit; the guide master's `documents-rules` stamp is updated as part of the reconciliation |
| Alias handling if Warden is later renamed | Nemotron | **Reject.** The engine's own rule already requires an alias on any rename |
| Concrete engine detail for Magician is missing | Nemotron | **Defer → task item.** Investigate before coding |
