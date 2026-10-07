> Triaged in session: (no session link available in this environment), 2026-10-07
> Reviewer: this repo's own `/code-review high` skill (forked Claude agent, repo access, reading the uncommitted diff). No external API reviewer was used for this change.
>
> **Triage (each checked against the code):**
> | # | Finding | Verdict | Action |
> |---|---|---|---|
> | 1 | Guide §14 still says Fighting Styles are not discounted while the engine discounts them | True, but a PRE-EXISTING engine-vs-guide mismatch (CharGen's own hint text also says "fighting styles" are discounted) and an owner decision | Left alone; filed as a board task with the probe (Fighter and Ranger both get 1 AP) |
> | 2 | Two comments now false; the discount rule written twice | Accept | One `_mbAdj()` used by both loops; comments rewritten |
> | 3 | In-tool Martially Bound text (CharGen x2, Live Sheet) omits subclass abilities | Accept | Wording updated in all three |
> | 4 | CharGen picker labels ignore the discount | True, PRE-EXISTING (class-feature labels do the same) | Not in scope; display-only; to be filed with the price-label follow-up |
> | 5 | Spell bundles / the 15 AP subclass unlock are outside the discount without saying so | Accept | Comment in `_subPriceOf` states both are deliberately outside |
> | 6 | The all-192 check could pass vacuously on a blocked ability, and points at pricing when a mirror is missing | Accept | Asserts a mirror exists and every probe prices at least 1 on both doors |
> | 7 | The unlocked-class path and the floor are covered only by the Node script, not an engine-parity fixture | Accept (unlocked path) | Fixture CG-065 added; the floor of 1 needs a price-1 ability, which no real fixture has, so it stays in the Node script |

### 1. The reworded §14 paragraph says Martially Bound discounts "the class's own features and its subclass abilities" but still says "Fighting Styles are not discounted". The engine discounts every bound-class feature, Fighting Styles included, and now subclass abilities as well.
`docs/PACT-Players-Guide.html` line 621

A player reads that Fighting Styles are priced flat. They bind Fighter or Ranger and buy Fighting Style. `compute()` takes 1 AP off, so the total is 47 against 50 unbound, per the probe in the new task-board entry. This PR widens the same unexcluded `mbClass` predicate to a second loop (`_subPriceOf`), and the guide edit keeps the Fighting Style sentence. A subclass ability named Fighting Style, such as Champion's Additional Fighting Style (currently barred), would be discounted too. The guide and engine are known to disagree, and the PR does not close that gap in a change that is itself a guide-versus-engine reconciliation. The owner's decision is only a follow-up task.

### 2. Two comments in `compute()` are now false. Line 633 says Martially Bound's "discount applied in the features loop above", and line 520 says "−1 AP (floor 1) on that class's features". The subclass loop applies it too.
`js/engine.js` line 633

A future agent edits the Martially Bound rule, reads these comments, and changes only the feature loop. The two purchase doors diverge again at 7 AP against 8 AP, which is the bug this PR fixes. The new fixtures and the all-192-abilities test would catch it, but the comments still point people at the wrong place. The discount predicate is also written twice, `mbClass && cls===mbClass` then `Math.max(1,c-1)`, at line 564 and in `_subPriceOf` at line 643. A shared `_mbAdj(cls, c)` helper would make the two doors agree by construction, which is the stated goal of the fix.

### 3. The Martially Bound summary still reads "−1 (floor 1) on <class> features". The Live Sheet bind button at tools/PACT-Live-Char-Sheet.html line 1954 reads "−1 AP on <class> features from here on". Both omit subclass abilities, which now get the discount.
`tools/PACT-CharGen-Webtool.html` line 6129

A player binding Rogue is told only features are discounted, while subclass abilities also drop by 1 AP. The in-tool text no longer matches the engine and the revised guide paragraph, and nobody has been told that the discount's scope changed.

### 4. The CharGen subclass-ability picker labels show the unbound price (`isO?a.origin:(isUS?...:a.cross)`) with no Martially Bound adjustment, although `compute()` now charges 1 AP less. The class-feature picker label at line 6144 has the same omission, so this one is pre-existing.
`tools/PACT-CharGen-Webtool.html` line 6146

A Martially Bound Rogue sees "Psychic Blades · … · 8 AP" in the picker. The running total rises by 7 when they buy it. The old 7-versus-8 confusion between the two doors changes form but does not go away, because the label and the charge disagree on both doors. The `.subpick` and `.classpick` label code and the `PRC` helper at line 6170 could take the discount from one shared price function.

### 5. Unlike the feature loop, the subclass-door discount is applied to the `origin`/`cross`/`sticker` price, but `subSpellBundles` pricing is not touched. A bound class's subclass spell bundles still get no discount, and the guide wording "every non-spell purchase" is not stated for them anywhere.
`js/engine.js` line 643

A Martially Bound Rogue buys a subclass expanded-spell-list bundle for the bound class. It prices at the full tier. This is probably correct because bundles are spell purchases, but the PR's new §14 sentence and the test claim 'all 192 abilities' without saying bundles are deliberately excluded. A reader cannot tell whether the omission is a rule or an oversight. A one-line comment in `_subPriceOf` or a fixture would pin it.

### 6. The 'all abilities' check compares bound and unbound prices for every `DATA.subAbilMap` entry. It silently relies on the mirrored `DATA.features[F2]` existing for each one. If a mirror is missing, the feature-door price is 0 plus an 'is no longer in the rules data' warning, and the failure is reported as a generic 'doors differ'.
`testing/scripts/subclass-double-purchase-ci.mjs` line 224

A future subclass ability is added without its feature mirror. The test fails with a message that points at pricing rather than at the missing mirror, which slows diagnosis. The `price()` helper also never checks `compute().warnings` for each probe. An ability whose prerequisites or Hit-Dice gate block it would price as 0 on both doors and pass the equality checks vacuously, so the 'all 192' claim could overstate coverage.

### 7. The new expected CG-062 and CG-063 entries are empty and CG-064's duplicate warning names the ability only as "Psionic Power / Psychic Blades". There is no fixture for a bound class via an unlocked (sticker) or cross-class price, or for the floor of 1 in a fixture.
`testing/expected/expected-warnings.json` line 196

The `Math.max(1, c-1)` floor and the unlocked-class branch are covered only by the Node CI script, not by the engine-parity.html fixtures that the AGENTS.md verification gate uses. A regression in the unlocked or floor path would pass engine-parity with 0 failed and only fail the separate script.
