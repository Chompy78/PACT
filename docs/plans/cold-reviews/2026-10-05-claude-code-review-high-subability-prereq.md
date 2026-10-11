> Triaged in session: (no session link available in this environment), 2026-10-05
> Reviewer: this repo's own `/code-review high` skill (forked Claude agent, repo access, reading the uncommitted diff). It ran the Node gates but not the browser gates. It started before the CHANGELOG / decision record / board edits were written, so findings 2 was partly a timing artefact.

### 1. The new prerequisite gate retroactively blocks any already-saved character who holds Circle Forms without base Wild Shape. Nothing in the diff measures how many such characters exist.
`js/engine.js` line 653

A live character bought Circle Forms through either door (CharGen save order, or the Live Sheet before the gate existed) and never owned Wild Shape. After the DATA.version v0.370 bump, compute() reports it 'blocked ... (not counted, not owned)' and drops its 9 or 14 AP from the total. The frozen ledger still charges the old cost, so 'AP left' diverges, which is the D-GH30 hazard. AGENTS.md says to measure blast radius against the live characters table. The fixtures only assert that 'every live Circle Forms owner' has Wild Shape, and EV-033 even freezes the Circle Forms cost at 0. The data-comment about not requiring the 6-forms step suggests a measurement was done, but no record of it is in the change.

### 2. This is a rules change (new prereq on Circle Forms, DATA.version v0.369 to v0.370), but the diff has no Players Guide change, CHANGELOG entry, DECISIONS record or task-board graduation.
`js/engine-data.js` line 13

AGENTS.md says 'A mechanics change isn't finished until the engine AND the guide land it' and that CHANGELOG.md is always updated and finished tasks graduate. Guide, CHANGELOG, DECISIONS and `docs/TASK_BOARD_*` are all untouched here, so the guide still lets Circle Forms be taken without Wild Shape. The engine would now refuse that. This is the guide-vs-engine drift the Grit incident documented, and the 'documents-rules:' pointer is not updated.

### 3. The fix adds a second, per-door gate (_subWhy) beside the feature loop's own HD and prereq logic. It does not make the subclass door share the feature door's blocked-state mechanism.
`js/engine.js` line 546

The code's own comment says that gating one of two mirrored doors is the failure that removed the v0.353 §11 gate. Prerequisite and HD logic now exists in three places: the _blockedFeat fixed point, the feature loop's cause-building block, and _subWhy. The wording is kept in sync only by a comment. The next gate added to one door (a new prereq type or an `lvl` rule) can drift from the other. The deeper fix is to register subclass-door ownership as the mirrored ident in _ownedFeatSet/_blockedFeat so one mechanism and one message builder serve both doors.

### 4. _subWhy resolves prerequisites only against _ownedFeatSet (b.features). A prerequisite held through the subclass door is never seen as owned.
`js/engine.js` line 548

Today the only prereq is Druid: Wild Shape, a plain class feature, so nothing breaks. All 192 subclass abilities are mirrored in DATA.features. If a future subclass ability names another subclass ability as its prerequisite and the player owns that one via b.subAbilities, the gate refuses it as 'requires X first'. The CI check only asserts that the prereq is a DATA.features key, not that it is reachable through b.features. The Live Sheet's _inertNote has the same b.features-only limitation.

### 5. The Subclasses & abilities tile and the feature tile are built with an HD-only `why`. The new prereq refusal arrives only as a soft-looking amber `.warn` note ('...blocked ... (not counted, not owned)'), and the tile stays clickable.
`tools/PACT-Live-Char-Sheet.html` line 1967

A Druid without Wild Shape sees the Circle Forms tile as a normal-looking, clickable, affordable buy with an amber note. The note claims it is 'not counted, not owned' for something not yet bought. The refusal only appears after the click. The HD gate by contrast passes a hard `why` and greys the tile. The tile should pass the prereq as reasonExtra, or the wording should be adapted for pre-purchase display.

### 6. _inertNote's prereq check reads only b.features and covers direct prerequisites only (the comment concedes this). It is now also used for held subclass abilities, so the 'Held but inert' notice can disagree with compute().
`tools/PACT-Live-Char-Sheet.html` line 1839

A held Circle Forms whose Wild Shape is present but itself blocked (a chain, or a Wild Shape aliased through FEAT_ALIAS) renders as an ordinary '✓ owned' tile. compute() has already zeroed it as 'not counted, not owned', so the sheet shows a held ability that grants nothing.

### 7. In the duplicate branch, _subWhy(_ka) re-runs requiredHD and the prereq filter for every duplicate. It is also used only as a boolean, with the cause strings thrown away.
`js/engine.js` line 570

A boolean helper exists in intent (`is the counted subclass copy blocked?`) but a string-building closure is called for it. A shared isBlocked(a) used by both the duplicate branch and _subWhy would be cheaper and clearer. This is minor wasted work on a path that only runs for duplicates.

### 8. The new e2e assertion matches the prereq note inside a tile's textContent truncated with .slice(0,120).
`testing/scripts/live-sheet-subclass-owned-e2e.mjs` line 138

The note comes after the label, cost and the 'N gp · M days' quote line. A longer label, a bigger gp or day quote, or a change in warning wording pushes 'requires Wild Shape first' past character 120, so Case 5 fails with no real regression. I could not run this e2e here (playwright is not installed), so it is unverified.

### 9. CharGen's picker prereq flash still covers only invocations (`f.inv`). Circle Forms is not pre-blocked in either CharGen picker; it is only warned about after it is added.
`tools/PACT-CharGen-Webtool.html` line 4356

A CharGen user picks Circle Forms through either picker with no Wild Shape. The picker accepts it and prices it, and the ⛔ warning only shows once the row is in the build. The random-character generator likewise picks random class features with no prereq awareness (its random-quality-ci run passes). The refusal only works after the creation lock, via purchaseLegality.

### 10. The fixture freezes Circle Forms at cost 0 (bought before Wild Shape) and asserts the final total is 38. This validates the total but encodes per-event ledger attribution that does not match the pre-change history of real characters.
`testing/fixtures/events/EV-033-circle-forms-before-wild-shape-final-state-priced.json` line 62

A character that bought Circle Forms first before the gate existed has a frozen 9 or 14 on that event, not 0. The fixture says 'every live Circle Forms owner' is unaffected, but it only proves the order-independent total. It does not cover the frozen-ledger divergence case from the first finding.

---
Reviewer's closing note:

I read the diff and ran the existing checks, with these results:
- `engine-parity-ci.mjs`: 95 passed, 0 failed.
- `subclass-double-purchase-ci.mjs`: 46 passed, 0 failed.
- `engine-legality-ci.mjs`: 66,906 passed, 0 failed.
- `random-quality-ci.mjs`: 74 passed, 0 failed.
- `version-label-ci.mjs`: 10 passed, 0 failed.

I could not run `live-sheet-subclass-owned-e2e.mjs` because the `playwright` module isn't installed here.
