> Triaged in session: (no session link available in this environment), 2026-10-05
> Reviewer: this repo's own `/code-review high` skill (forked Claude agent, reading the uncommitted diff). It had repo access, unlike the three API reviewers. It ran the three Node gates but not the browser gates.
> Triage: see "Review outcome" in docs/plans/2026-10-05-subclass-double-purchase-guard-cold-review.md.

### 1. CharGen's live compute() and its saved/replayed LOG disagree about which copy of a doubly-held ability is the counted one.
`tools/PACT-CharGen-Webtool.html` line 4682

CharGen's state reader (line ~4295) builds `b` straight from the UI with no `b._abilDoor`, so compute() falls back to 'subclass copy counted, feature copy duplicate'. The save/export burst at line 4682 emits every `feature` event before any `subabil` event, so on reload MUT stamps `_abilDoor[id]='f'` and the FEATURE copy is the counted one. A player who ticks both doors sees one price and warning text. After Save and Load the other copy is counted, with a different warning and a different price whenever the two loops price differently (Martially Bound discounts only the feature loop). The frozen per-event costs in the burst also follow feature-first order, not the order the player picked. CharGen never needed a picker change, but it does need `_abilDoor` stamped (or the burst ordering fixed) to honour 'first bought wins'.

### 2. `_noteDoor` stamps purchase order only for events replayed through MUT. Copies already in a base snapshot (`seedBuild`/`rebuildStateFromEvents(base, events)`) or loaded from a legacy `patch` bundle are unstamped, so a later event wrongly becomes 'first'.
`js/engine.js` line 121

A base snapshot or `patch` event already contains `subAbilities:[S]`, and a later `feature` event buys the mirrored feature F. Only F gets `_abilDoor[id]='f'`. compute() therefore treats the feature copy as first and flags the subclass copy as the duplicate, so the older copy is the one that is not counted. This is the reverse of P3. The price and the 'duplicate: already owned as…' text are wrong, and the subclass copy no longer feeds subclass-unlock accounting. Any pre-existing character whose log or base carries one door outside buy events is exposed.

### 3. `b._abilDoor` is write-once ordering state that is never cleared or recomputed when an ability leaves `b.features` or `b.subAbilities`. It also gets cloned along with `b` in purchaseLegality() and priceOf().
`js/engine.js` line 121

Any flow that removes the first-door copy in place instead of replaying a log (a direct splice of `b.features`, a hand-edited or imported build that kept `_abilDoor`, or a clone of a stale build) leaves `_abilDoor[id]='f'`. Buying the subclass door and then the feature door again yields the wrong 'first' door, and the duplicate warning and price attach to the wrong copy. The ordering is derived state held in a mutable shared field with no invalidation.

### 4. Duplicate detection flags by sub key and by ability id. If the same subclass key appears twice in `b.subAbilities`, or an ability is held twice in `b.features`, the duplicate warning and blocked-purchase line fire once per copy. The within-collection double-charge also still exists.
`js/engine.js` line 523

`b.subAbilities=[S,S]` with `b.features=[F]` and feature first: `_dupSub` holds the key S, so BOTH sub entries hit the `_dupSub.has(key)` branch. The player gets two identical '⛔ duplicate' warnings and two 'Blocked purchases' lines for one ability. With `subAbilities=[S,S]` and no feature copy, the sub loop still charges twice with no warning, since the shared-identity guard only covers the cross-door case. `purchaseLegality`'s multiset diff would also treat the second identical warning as new.

### 5. The duplicate feature copy is skipped in the pricing loop, but the duplicate's own price `c` is used for the 'Blocked purchases' line. Only the subclass copy's Hit-Dice gate is checked, so the two doors' separate gates and prices can disagree.
`js/engine.js` line 538

Subclass copy first and counted; the feature copy is listed under Blocked purchases at the feature price `c`, which includes the Martially Bound discount. The sub loop uses the undiscounted price for the same ability. The displayed blocked-AP amount for one ability therefore depends on which door happened to be second. If `requiredHD(f)` ever differs from `requiredHD(_ka)` (per-item lvl/hd floors), the HD-blocked decision uses only the sub copy's requirement. That can list a duplicate that the engine considers HD-blocked on the feature side, or omit one.

### 6. `_mirrorIdents` is a module-level cache built once from `DATA.subAbilMap` and never invalidated.
`js/engine.js` line 102

Anything that mutates or swaps `DATA.subAbilMap` after the first `_noteDoor` call (a campaign overlay, test harnesses that patch DATA, a hot data reload) leaves `_isMirrored` answering from the old map. `_noteDoor` then silently skips stamping new or renamed abilities, and compute() falls back to 'subclass copy counted' regardless of purchase order. The pure derivation in `compute()`'s `_byId` block reads the live map, so the two halves of the feature can disagree.

### 7. The identity `a.cls+': '+a.name` is re-derived inline in at least four places. `abilityIdent()`, `_isMirrored`'s set builder and the compute() blocks all repeat it. The three-way price expression is copy-pasted again in the new sub-loop dup branch.
`js/engine.js` line 524

The header comment says `abilityIdent()` is 'the ONE shared identity', but compute() builds `_byId`, `_dupSubKey` and the lookup with its own string concatenation, and `_mirrorIdents` concatenates yet again. If the identity ever changes (for example the name-collision case across subclasses, or FEAT_ALIAS applied to subAbilMap), one site is missed and detection silently stops matching. The `(isO)?origin:(unlocked)?max(1,cross-tier):cross` price expression is now copied three times in the sub loop (HD-blocked branch, dup branch, normal branch). It could be a single helper.

### 8. `_ownedFeatSet` and the prerequisite/HD gating are computed from `b.features` only. They do not use the new `ownsAbility()` identity, so ownership is now defined two different ways inside the same engine.
`js/engine.js` line 309

The pickers treat an ability held only via `b.subAbilities` as owned (`ownsAbility`). compute()'s prereq gate (`_ownedFeatSet.has(req)`) does not, so a feature that names a mirrored ability as its prereq stays blocked for a player who owns it through the subclass door. No DATA row has this shape today (checked: 0 mirrored/prereq overlaps), so the gap is latent. Because the UI and the engine now disagree about 'owned', the next data edit that adds one creates a 'shows owned, prereq still blocked' bug.

### 9. Detection runs two `.some()` scans (`b.features`, with FEAT_ALIAS) inside a loop over `b.subAbilities`, on every compute() call. compute() is invoked repeatedly by purchaseLegality (twice), priceOf and every fuzz/replay step.
`js/engine.js` line 523

Cost is O(subAbilities × features) per compute() call. A character with a few dozen of each is fine, but replay (`repriceDraft` runs compute per event) and the 61k-comparison legality sweep multiply it. Build a Set of aliased feature labels once, or reuse the existing `_ownedFeatSet` computed at line 309, which already holds `b.features.map(FEAT_ALIAS)`.

### 10. Only the Live Sheet's four picker lists were switched to `ownsAbility`. Other `b.features.includes(...)` or `indexOf` ownership checks in the same file are unchanged, so an ability owned through the subclass door is still treated as not owned elsewhere.
`tools/PACT-Live-Char-Sheet.html` line 1872

The Eldritch Invocations list (still `b.features.includes(l)` and `b.features.includes(r)` for prereqs) and any other path that reads `b.features` directly for ownership still ignore `b.subAbilities`. The two tools now apply two different ownership rules, which is the 'a rule that guards one of two doors teaches the wrong thing about the door it does not guard' problem the code comments cite. Only the engine's `purchaseLegality` refusal stops the second purchase in those paths, with no 'owned' display.

---
Reviewer's closing note:

I ran `testing/scripts/subclass-double-purchase-ci.mjs` (20 passed, 0 failed), `engine-parity-ci.mjs` (89 passed, 0 failed) and `engine-legality-ci.mjs` (61431 passed, 0 failed). None of them exercise the CharGen reload ordering, the unstamped-base-snapshot case, or the repeated-key case, so those findings come from reading the code, not from a reproduction. I did not run `post-lock-parity-fuzz.mjs`: it failed on a missing Chromium launcher module.
