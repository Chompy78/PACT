# D-GH-2026-10-11-verify-guide-blind-spots — the guide price checker fails on rows it cannot compare, unless a reason is written down

**Status:** DONE on branch `fix/verify-guide-blind-spots`. No engine, data, guide-text or rules-version change in this repo.

## Context

Four combined guide rows (for example "Roving / Tireless") sat stale for six weeks while `verify-guide.mjs` passed. Three causes, all in `guide-price-check.mjs`: a combined row was matched on its first name through a prefix fallback; a price range was "unparsed"; and ambiguous / unparsed / stepped rows were listed but never failed. A fourth was found while writing reasons for the listed rows: candidates were collapsed by identical numbers before the table's class was applied, so Paladin's Fighting Style (same numbers as Ranger's) could never be found and was never compared.

## Options

- **A. Fix the four stale rows only.** Done earlier (2026-10-08); leaves the next one invisible.
- **B. Teach the checker the shapes and make unexplained rows fail (chosen).** Combined-member checking, range checking, class-first narrowing, and an `ALLOW` list with a reason per row.
- **C. Make every listed row a hard failure with no allow-list.** Rejected: 18 rows are legitimately not comparable (a flat-vs-varying bundle, a Metamagic ladder, a no-price row for a barred entry); failing on them would make the checker permanently red.

## Decision

`guide-price-check.mjs` now fails on: any ambiguous / unparsed-price / stepped-feature finding not in `ALLOW`, and any `ALLOW` entry that matches no row (so the list cannot rot). Each entry carries a reason. Two entries are honestly labelled OPEN QUESTION (Improved Combat Superiority, Iron Mind): the guide and the engine look like they disagree and the owner has not decided.

## Why

- A checker that only lists a class of row teaches everyone to ignore the list. The point of the allow-list is that the reason is written once, by someone who looked, and a new row of the same kind cannot slip through.
- Class narrowing before collapsing is the correct order: the same numbers in two classes are two entries, not one.
- `guide-table-diff.mjs` cannot be part of CI: the pact-guide master is not in this repo. It is a local helper, run by hand when both files are available. It pairs tables by content similarity, because pairing by position turned one added table into over a hundred phantom differences.

## Consequences

- The first run of the table diff found 54 differences between the master and the served copy, far more than the one Ranger row. The served copy matches the engine on the price rows sampled, so a transfer from the master would regress them. Filed on the board; not fixed here.
- Mutation-checked: a wrong second member of a combined row, a wrong range, a new unparsed row, a stale allow-list entry and a wrong Paladin Fighting Style price each fail; a correct combined row and a correct range pass.
