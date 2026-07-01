# Session 2026-07-01 — REV-01: make the regression gate actually assert

**Branch:** `fix/rev-01-regression-gate` → **PR #34** → `preview`

## What was done

The parity gate (`testing/tests/engine-parity.html`) hard-coded `pass: true` on every run and left `testing/expected/expected-results.csv` blank, so "5/0" only proved that `compute()` didn't throw — not that results were correct.

### Runner rewrite

Replaced the single "Run tests" button with two modes:

- **Capture baseline** — runs all fixtures through the live engine, outputs ready-to-paste CSV rows. Prompts the human to confirm the numbers against the PHB/guide before committing.
- **Run tests (assert)** — fetches `expected-results.csv` at runtime, compares each actual value to the stored expected, and marks PASS or FAIL with a diff line for every failure.

CG-003 additionally hardwires two structural assertions that are always run regardless of the CSV:
- `remaining < 0` (the build is over-budget)
- first warning starts with "OVER BUDGET"

LS-001 and EV-001 assert `rebuildStateFromEvents().ok`, `.total`, and `.eventsApplied`.

### Baseline values captured and confirmed (engine v0.332)

| Fixture | total | warnings | notes |
|---------|------:|:--------:|-------|
| CG-001 | 2 | 0 | empty build — `DATA.HD[0].cum = 2`; every character pays 2 AP for Hit Die 1 (see D-GH13) |
| CG-002 | 50 | 0 | valid 50-AP Warlock; exactly on budget |
| CG-003 | 67 | 1 | over-budget Sorcerer; remaining = −17 |
| LS-001 | 78 | 1 | Aldric Valor live sheet; Ki-without-feature warning |
| EV-001 | 68 | 0 | Mira Quickfingers award-and-purchase |

### Surprising finding: CG-001 total = 2, not 0

The "default empty build" fixture looks empty but every character automatically pays for Hit Die 1. `DATA.HD[0].cum = 2`, so the engine adds 2 AP for `hd: 1` via `add("Hit Dice", row.cum)`. Languages at `n=1` cost `(n−1)·n/2 = 0`. Confirmed via browser eval: `compute(CG-001).lines` returns `[["Hit Dice", 2]]` with nothing else. Documented in D-GH13.

## Decisions logged

- **D-GH13** — two-mode runner design and the CG-001 = 2 AP baseline explanation.

## Done-when verified

- Perturbing one price in DATA causes a FAILED test.
- Clean tree → 5 passed / 0 failed.
