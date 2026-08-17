# Guide-audit triage — state of the guide↔engine reconciliation

**Updated 2026-08-17** (fourth pass). Guide v0.333 · engine **v0.346**.
The checkers are the source of truth; this file is a snapshot.

```
node testing/scripts/guide-price-check.mjs  docs/PACT-Players-Guide.html   # feature tables
node testing/scripts/guide-spell-check.mjs  docs/PACT-Players-Guide.html   # spell economy + worked examples
node testing/scripts/guide-bundle-check.mjs docs/PACT-Players-Guide.html   # subclass bonus-spell bundles
```

## Read this first

The 2026-08 audit (`pact-guide/plans/guide-audit-report.md`, 171 findings) is **a map of where to look,
not a source of fixes.** Confirmed failures in it:

- `Fix:` lines quote `origin` or `cross` where the guide's column needs **sticker** (#36, #41, #42).
- **Three of five** Ch9–11 findings (#3, #14, #17) were already fixed or never real.
- It pointed the guide *toward* the engine on three heritage traits where the **engine** was wrong.

**My own triage was wrong twice, the same way** — reporting checker failures as guide defects.
`Extra Attack (3/4 attacks)` already matched the engine; all 8 bundle rows already existed in
`DATA.subclasses`. Acting on that list would have created duplicates. **A `no-engine-key` result means
"the checker could not match the name", not "the engine is missing this."**

## Where things stand

| Checker | Result |
|---|---|
| `guide-price-check` — 424 feature rows | **0 price-mismatch · 0 no-engine-key** |
| `guide-spell-check` — 667 cells / 700 rows / 34 tables | **0 mismatches** |
| `guide-bundle-check` — 24 bundle rows + Appendix J | **0 findings** |

All three are mutation-tested: injecting a wrong value makes them exit 1 and name it.

`guide-bundle-check` (added 2026-08-17) covers a gap the first two structurally could not reach —
`guide-price-check` resolves a row name to a `DATA.features` key and bundles aren't in `DATA.features`;
`guide-spell-check` keys on spell level and bundles have none. Both therefore reported every bundle row as
`ambiguous`/unparsed. It checks four things the others can't: each row's price against
`DATA.subclasses[*].spellBundle`, that every engine bundle is printed *somewhere* (a missing row is
invisible to a row-by-row checker — this is how Circle of the Stars stayed unpriced), that a class with
bundles has a summary row at all (Ranger had none), and that Appendix J lists every subclass of a
bundle-granting class including the ones selling nothing.

### What got fixed along the way

`DATA.version` v0.343 → **v0.346** across three bumps — heritage-pack membership and the pricing model
(v0.344), stepped ladders the guide advertised but the engine lacked (v0.345), and a conflated Druid key
plus three missing features and a Cunning Strike repricing (v0.346). See `CHANGELOG.md`.

### Coverage of the spell checker

| Range | What | Verdict |
|---|---|---|
| L340–406 | Ch12–13 grids: HD gate, slot sticker, origin/bound discounts, innate 3×, spell-known | all match |
| L394–406 | Ch12–13 worked examples | running totals correct |
| L955–1120 | **Appendix H (Multiclass Builds) + Appendix I (The Emberwatch)**, 24 tables | running totals correct |

Appendices H/I are the `#102–171` range that had never been inventoried at all.

## Still open

### 1. ~~Three "varies per subclass" rows~~ — **closed 2026-08-17**

Audit #44. Resolved as U1 + V2 + a new appendix: the summary rows now carry the real range and say
"none" out loud where a subclass sells nothing, and **Appendix J** gives the per-subclass detail. See
`CHANGELOG.md` 2026-08-17. `guide-bundle-check` now enforces all of it.

**One genuine outlier, down from a wrongly-reported five.** Reading the real spell lists out of
`DATA.spellGrants.subclassSpells` (a bundle prices the grants unlocking at charLevel ≤ 5; the rest ride
free) reproduces **20 of the 21** stored prices exactly. The lone miss is **Circle of the Sea**, charged
11 (9) where its seven paid grants total 12 (10). Its list is the same shape as Aberrant Sorcery's — a
cantrip plus two spells each at 1st, 2nd and 3rd — and that one *is* charged 12 (10). So it reads as a
1 AP slip rather than a deliberate discount. Engine and guide agree on the figure, so nothing is broken;
correcting it is an owner call.

> **How this was got wrong first.** An earlier pass *assumed* the grant shape (two spells each at
> 1st/2nd/3rd) after wrongly concluding the spell lists weren't stored anywhere. That reproduced only 16
> prices and labelled four Druid circles and Archfey Patron "hand-set" — none are. `DATA.spellGrants`
> exists and is authoritative; never reconstruct a shape when the data is sitting there.

### 2. What the checkers structurally cannot prove

- **Line-item values inside worked examples.** The running-total check proves `Running` accumulates
  `AP`; it does not prove each `AP` figure is the right price. A build with a wrong line item that sums
  consistently passes. Closing this needs a **build-replay check** — feed each worked example through
  `compute()` and compare. That is the single highest-value remaining piece of tooling.
- **Prose claims.** Half-caster Rank-5 cap, Wizard "uncapped spellbook", Warlock known-spell formula.
  Assertions in text, not cells; several are `[UNCLEAR]` wording calls. Untouched.

### 3. Known checker limitations — not guide defects

- `Fighting Style` (L268, L663) and `Channel Divinity` (L268): ambiguous, tables carry no class heading.
- `Extra Attack (3/4 attacks)` at L268: hand-verified correct; class-agnostic table resolves to the
  first matching class.
- 23 `stepped-feature` rows print one cell for a whole ladder; the real ladder is shown alongside.
- 11 `unparsed-price` cells (`—`, `varies`, `free — set by race`) are mostly legitimate.

### 4. The `documents-rules` stamp

Still never applied — and it was the original point of this work. It asserts "this prose was reconciled
against engine vX". Stamping is now *defensible* for feature pricing and spell arithmetic, but would
still overclaim until item 2's build-replay check exists and the prose claims are settled.

## Suggested order

1. ~~Decide the three "varies" rows.~~ Done 2026-08-17.
2. Build the worked-example build-replay check (item 2) — mechanical, no content decisions.
3. Settle the prose claims — needs owner wording. Two of the four are already fixed in the live guide
   (the half-caster Rank-5 cap now says the tool doesn't enforce it; the wizard says "no wizard-specific
   exception"), and two more were corrected on 2026-08-17 (bundle cantrips, half-caster spell counts).
   The Warlock known-spell formula is the one left unchecked.
4. Decide the five hand-set bundles (item 1) — a rules call, not a defect.
5. Then stamp `documents-rules`, honestly.
