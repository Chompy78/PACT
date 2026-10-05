# Post-lock parity fuzz — do CharGen and the Live Sheet treat the same purchase the same way? — 2026-10-05

**Owner's instruction (paraphrased):** after finishing phase 2b-2, run many automated trials that improve a character from beyond the creation lock with the same purchases in the Live Sheet and in CharGen; the results should be the same; cover as many combinations as possible; work out where the problems are.

## Method

`testing/scripts/post-lock-parity-fuzz.mjs` (headless Chromium, the project's own harness). Per trial:

1. Take a build fixture from `testing/fixtures/builds`, add AP headroom, randomise Hit Dice / ability scores / proficiency bonus half the time, optionally switch the coin-and-calendar economy on with a declared wallet.
2. Load it into CharGen, "Finish creating", hand the *same* locked envelope to the Live Sheet. Check the two start from the same folded build.
3. For K seeded random purchase intents (Hit Die, ability, language, armour, weapon proficiency, skill/boon/tool/art/feature, subclass, racial trait, spell rank/cantrip/slot/known/new discipline, …): click the matching buy **tile** in the Live Sheet (a blocked tile only flashes a reason; a missing tile means "not offered"), do the equivalent through CharGen's real control, then compare accepted/refused, events appended (category, payload, price, frozen gold/downtime), and total/spent.
4. A trial stops at its first mismatch. Every mismatch records the seed and the exact starting build, so `--replay <report.json> --index N` reproduces it.

No AI sub-agents were used: the space is large but the check is mechanical, so a seeded script is cheaper and exactly repeatable.

## Rounds

| Round | Code under test | Result |
|---|---|---|
| Baseline | current `main` (live) | 71 differences in 211 purchases |
| 1–2 | `feat/chargen-2b2-traditions-diff` | 0 differences (fresh page per trial) |
| 3 (page reuse, 600 characters) | same | 0 mismatches, but exposed a stack overflow (below) |
| 4 (widened: racial, tool expertise, subclass abilities, worn armour; random HD/stats) | same | 10 / 243, 8 / 139, … mismatches — two causes, both fixed (below) |
| 5 (seeds 501–503) | after fixes 1–3 | 1 mismatch in 239 purchases: finding 4 below (fixed); the other workers 0 |

## Findings

1. **Stack overflow when loading a character while a locked one is open** (pre-existing on live since #573). The form rebuild called the flat-category sync, which tried to "buy" rows into the still-locked old log; the refusal repainted, the repaint rebuilt the rows, and so on until "Maximum call stack size exceeded". **Fixed:** `_cgPostLockAppend` and `retractFlatEvent` do nothing while a load is rebuilding the form (`_histSuspended`). Regression test in `chargen-flows-e2e.mjs`.
2. **CharGen allowed subclass abilities / spell lists of a class the character has no access to** after the lock. The Live Sheet only offers them for the origin class and unlocked classes; CharGen's picker lists every class (a Cleric bought a Fighter ability for 17 AP). **Fixed:** the same access rule in `_cgPostLockAppend`.
4. **Buying All martial, then ticking Improvised, was refused as "giving up" Simple** (round 5). After an All-martial purchase the form's Simple box can stay unticked while the log has Simple; the next edit read that as a removal. **Fixed:** All martial counts as including Simple in the diff.
3. **Harness artefact, not a defect:** worn armour. CharGen disables ineligible armour options exactly as the Live Sheet does; the harness set the select's value directly, which a real user cannot do. The harness now treats a disabled option as "no control".

## Explained differences (not counted as defects)

- CharGen refuses new drawbacks and "Magically Bound" after the lock; the Live Sheet still offers them (owner question below).
- Armour: ticking Heavy in CharGen also ticks the lower tiers it requires, in one edit; the Live Sheet buys them one tile at a time. Same purchases, same prices.
- Warlock pact slots / Arcanum have no purchase in either tool; CharGen refuses with a message.

## Not covered / open

- **Drawbacks** are effectively untested: the Live Sheet takes them through `takeDrawback`, not a buy tile.
- Several Live Sheet eligibility gates live in its tile code, not in the engine (rank / Hit Dice for slots and known spells, art HD and minimum stats, feature prerequisites, cross-class selector). CharGen reproduces them through its own form. A single engine `purchaseAvailability()` would remove the duplication — a larger change, not done here.
- In one replay the Live Sheet showed a wallet shortfall confirm that CharGen did not (the harness's CharGen wallet may differ from the Live Sheet's); dialogs are not part of the comparison. Worth a look if wallet parity matters.

## Unexplained: one stall

With seed 7001 the ninth character (fixture CG-030, a Warlock) makes the Live Sheet page close/stop answering on its first purchase, every time, inside the fuzz run; the identical starting build and purchase replay fine on their own (`--replay <report> --errors --index 0`). The harness now gives every purchase 60 s and reports the intent instead of hanging the run (and opens a fresh browser context per trial with `--fresh-page`). It looks like a browser/harness effect, not a rules difference, but it is not proven. The CI job uses seed 7002 (20 characters, ~2 minutes, clean).

## Questions for the owner

1. Should the Live Sheet also stop offering "Magically Bound" and new drawbacks after the lock, to match CharGen? Or should CharGen allow them?
2. Keep a short seeded run (say 30 trials) as a CI gate? It takes several minutes.

## How to run

`node testing/scripts/post-lock-parity-fuzz.mjs --trials 50 --ops 5 --seed 501 --port 7991 --out report.json`, then `--replay report.json --index N` for one mismatch. Needs Playwright from `testing/node_modules`. Keep exports of real player data out of the repository.
