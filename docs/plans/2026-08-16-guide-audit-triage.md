# Guide-audit triage — state of the guide↔engine reconciliation

**Updated 2026-08-16** (third pass, end of session). Guide v0.333 · engine **v0.346**.
Both checkers are the source of truth; this file is a snapshot.

```
node testing/scripts/guide-price-check.mjs docs/PACT-Players-Guide.html   # feature tables
node testing/scripts/guide-spell-check.mjs docs/PACT-Players-Guide.html   # spell economy + worked examples
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
| `guide-price-check` — 421 feature rows | **0 price-mismatch · 0 no-engine-key** |
| `guide-spell-check` — 667 cells / 700 rows / 34 tables | **0 mismatches** |

Both are mutation-tested: injecting a wrong value makes them exit 1 and name it.

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

### 1. Three "varies per subclass" rows — needs a wording decision

The guide prints one flat price where the engine genuinely differs. Audit #44.

| Line | Row | Engine range |
|---|---|---|
| 648 | `Circle bonus spells` | Moon 7/8 · Sea 9/11 · Stars 5/5 · Land 7/8 |
| 678 | `Origin bonus spells` | Draconic 6/8 · Aberrant 10/12 · **Wild Magic has none** |
| 683 | `Patron bonus spells` | Fiend & GOO 6/8 · Archfey 7/9 · Celestial 14/16 |

Wild Magic is the sharp case: any single number quotes a price for something that cannot be bought.

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

1. Decide the three "varies" rows.
2. Build the worked-example build-replay check (item 2) — mechanical, no content decisions.
3. Settle the prose claims — needs owner wording.
4. Then stamp `documents-rules`, honestly.
