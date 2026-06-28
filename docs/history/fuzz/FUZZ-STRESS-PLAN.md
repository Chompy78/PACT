# PACT — Overnight "Weird & Wonderful" Looping Checks (autonomous run)

**Goal:** stress the v0.315 engine far beyond the deterministic gate suite, using seeded
property-based fuzzing, metamorphic relations, and differential testing — running on a
**wall-clock budget (~3 h default)**, checkpointing a report after every round so there's a
growing artifact even if interrupted.

**Tooling:** deterministic Node fuzzing (NOT LLM agents) — reproducible, cheap, and the right
fit for a pure `compute()`. Every failure logs its **seed + iteration + the exact build JSON**
so any counterexample is replayable.

**Policy while you sleep:** these checks only READ the engine — they never edit it. If a suite
finds a real counterexample it is recorded in the report (with a minimized build) for your review;
I will NOT auto-patch engine logic unattended. The committed engine + 33 gates stay green.

## Suites (each loops on a time-slice, accumulating iterations across rounds)

1. **no-throw / finite-output** — random builds: `compute()` never throws; `total/hp/mods/saveDC/
   slots/AP` are all finite; `hp ≥ 1`; no `NaN`/`undefined`/`Infinity` in any `lines` value.
2. **ledger sum invariant** — `Σ lines[i][1] === total` (every `add()` is accounted; no orphan AP).
3. **compute purity** — `compute(b)` twice returns identical `total/hp/lines` (no hidden state).
4. **surcharge law** — random caster builds: per spell-economy purchase the origin/unlocked/
   un-unlocked deltas are exactly −1/0/+1, and **flat across Hit Dice** (HD5 ≡ HD17).
5. **price-split invariant** — buying an ability increase costs identically with vs without a flat
   bonus (Epic Boon / Primal Champion) present (the load-bearing v0.314 guarantee).
6. **monotonicity** — +2 to a stat never lowers `abilAP`; +1 HD never lowers level or base HP;
   higher slot level never cheaper than a lower one; spell-cost ordering origin ≤ unlocked ≤ un-unlocked.
7. **drawback caps** — random drawback sets: >12 AP gained fires the cap warning; stat-capped
   drawbacks enforce their ceiling; Frail+Glass don't stack.
8. **Frail/Grit arbitrage** — random HP-reduction + Vigor/Grit builds: final HP never exceeds
   base−hd (offset suppressed) and the warning fires.
9. **differential ×4 engine files** — same random build → `compute()` in CharGen + Live Sheet +
   both DM consoles → identical `total/hp/lines` (runtime parity of the console bundles).
10. **eligibleSpells fuzz** — never throws; `maxLv ≤ rank`; no offered spell above its HD/rank gate.
11. **render fuzz** — `spellPanel` + `renderCharSheet` never throw and never leak
    `undefined`/`NaN`/`[object Object]` into the HTML.
12. **swap-economy fuzz** — random Hit-Die / swap states: `_swapAvailFrom` / `_swapSplit` never go
    negative; free pool ≤ 2 per HD; paid split is non-negative.

## Output
- `output/overnight-report.md` — human summary (updated each round): per-suite iterations, pass/fail,
  and any counterexamples (seed + build).
- `output/overnight-report.json` — machine record (full counterexamples).
- Console/log → `working/overnight.log`.

## Run
`node tests/fuzz/overnight.cjs` with `FUZZ_BUDGET_MS` (default 10800000 = 3 h), `FUZZ_SEED`
(default 0x9E3779B9). Launched in the background; checkpoints survive interruption.
