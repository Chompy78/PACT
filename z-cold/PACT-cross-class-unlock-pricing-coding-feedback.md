# PACT Cross-Class Unlock Pricing — Feedback and Implementation Direction

**Date:** 18 August 2026  
**Audience:** Coding AI working on the PACT rules engine, Players Guide, character-generator UI, fixtures and verification tooling  
**Source review:** `2026-08-17-cross-class-unlock-pricing-cold-review.md`

## Executive direction

Replace the escalating **7N AP class-unlock ladder** with a **flat 7 AP cost per non-origin class unlock**.

Do **not** implement the proposed flat 10 AP model unless the owner later explicitly reverses this decision. Flat 7 AP is preferred because it is the tested model that cleanly matches the stated design boundary:

- **1–2 purchases from a foreign class:** a dabble; buying individual abilities at the cross-class surcharge should remain optimal.
- **3+ purchases from the same foreign class:** an investment; unlocking that class should become worthwhile.

Retain the documented ability to skip an unlock and buy individual cross-class features at the `+Tier` surcharge. Cross-class purchasing is intentional and must not be gated.

Keep the origin-class discount unchanged. It remains the permanent reward for thematic coherence: unlocking a foreign class grants sticker pricing, not origin pricing.

Treat broad “magpie” characters separately. Unlock pricing cannot restrain a character who buys one ability from many classes but never unlocks any of them. Do not distort the unlock model in an attempt to solve that separate question.

## Final policy model

### Origin-class purchases

Use the existing origin price. No change is requested.

### Unlocked foreign-class purchases

Use the existing sticker price:

```text
sticker price = cross-class price - Tier
```

No change is requested to the sticker-price formula.

### Locked foreign-class purchases

Continue allowing the purchase without an unlock, using the existing cross-class price:

```text
cross-class price = sticker price + Tier
```

This route is intentional. Do not warn that the purchase is prohibited or invalid merely because its class is not unlocked.

### Foreign-class unlocks

Charge:

```text
7 AP per unlocked non-origin class
```

The price must not depend on:

- how many other foreign classes have already been unlocked;
- the order in which foreign classes are unlocked;
- how many other classes have been sampled without unlocking;
- whether the ability appears in the subclass picker or the mirrored general class-feature catalogue.

Examples:

```text
First foreign-class unlock:   7 AP
Second foreign-class unlock:  7 AP
Third foreign-class unlock:   7 AP
Fourth foreign-class unlock:  7 AP
...
Final valid foreign unlock:   7 AP
```

If the engine internally stores cumulative rather than marginal unlock costs, the cumulative values should increase by 7 AP at every valid rung:

```text
1 unlock:   7 AP cumulative
2 unlocks: 14 AP cumulative
3 unlocks: 21 AP cumulative
4 unlocks: 28 AP cumulative
5 unlocks: 35 AP cumulative
...
```

Extend this safely across every valid class configuration, including characters with more than one origin class.

## Why flat 7 AP is preferred over flat 10 AP

The supplied simulation reports these break-even results:

```text
Model       1st class   2nd class   3rd class   4th class
Flat 7      3 buys      3 buys      3 buys      3 buys
Flat 10     4 buys      3 buys      3 buys      3 buys
```

Flat 7 AP is therefore the cleanest match to the stated “1–2 dabble / 3+ investment” rule at every unlock position.

Flat 10 AP would still be a defensible conservative model, but it would require changing the design statement to a **three-to-four-purchase transition**. It should not be described as providing a uniform third-purchase break-even.

The supplied optimiser also showed that flat 7 does **not** make ordinary dabbling pointless. The one-dab, two-dab, light-dip, scattered and magpie archetypes continued to use individual cross-class purchases rather than unlocking.

The first unlock already costs 7 AP under the current 7N ladder. Flat 7 does not reduce the first unlock; it prevents later unlocks from becoming arbitrarily punitive or economically unreachable.

## Required correctness fixes

These fixes are required independently of the pricing-policy change.

### Fix the missing-table refund cliff

The current cumulative table has too few entries for the supported class count. Past its final entry, the engine can interpret a missing value as free, refund previously paid AP, or produce a negative charge for some multi-origin configurations.

Remove this behaviour completely.

Invalid or out-of-range lookup behaviour must never produce:

- a free unlock;
- a refund;
- a negative AP cost;
- `undefined`, `null`, `NaN` or an equivalent invalid numeric result;
- a silent fall-through to an unrelated default.

Prefer computing the flat value directly if that is compatible with the engine architecture. If a cumulative table remains necessary, populate every valid rung and add explicit bounds handling.

### Remove the provisional cross-class gate or warning

Remove the provisional warning that treats buying a class’s subclass ability without unlocking its class as invalid.

The Players Guide explicitly allows players to skip the unlock and pay the per-feature cross-class surcharge. The implementation must preserve that choice.

### Make both catalogue routes consistent

All mirrored abilities must behave identically whether purchased through:

- the subclass ability picker; or
- the general class-feature catalogue.

Both paths must agree on:

- eligibility;
- origin/sticker/cross-class classification;
- displayed price;
- charged price;
- ownership result;
- warnings and validation messages.

Do not leave one route gated while the other bypasses the gate.

## Explicitly rejected or deferred approaches

### Do not retain the 7N ladder

The current ladder makes later unlocks economically unreachable rather than merely more expensive. Fixing only the missing-entry bug would not solve that design problem.

### Do not implement flat 10 AP as the default

Flat 10 AP is not the selected recommendation. It delays the first foreign-class break-even until the fourth purchase in the supplied build and therefore misses the declared uniform third-purchase threshold.

### Do not use 5N or “10 then +4”

The supplied simulations show that these models preserve the undesirable property where later unlocks can become uneconomic or never break even.

### Do not make dabbling accrue against later unlock costs

Do not count sampled foreign classes or past cross-class purchases as extra rungs on an escalating unlock ladder.

This would:

- create path dependence;
- make early experimentation impose a delayed penalty;
- make future unlock prices harder for players to predict;
- work against the requirement that foreign abilities remain reachable; and
- risk recreating the current later-class lockout under a different trigger.

### Defer any magpie or breadth tax

A magpie character buys one ability from many foreign classes and never unlocks any. Every tested fixed unlock price leaves this archetype unchanged because it never interacts with the unlock mechanism.

Do not add a breadth tax unless later playtesting shows that this pattern creates a real balance or synergy problem. Being unconventional is not, by itself, evidence of imbalance.

If breadth later requires intervention, design and test it as a separate, direct and transparent mechanic rather than hiding it inside class-unlock pricing.

## Implementation scope

Update all of the following together:

1. Rules engine class-access pricing logic.
2. Any cumulative unlock-cost table or equivalent configuration.
3. Bounds and missing-entry handling.
4. Players Guide §11 prose and pricing examples.
5. Players Guide class-access table.
6. Character-generator unlock-cost display.
7. Subclass picker warnings and validation.
8. General class-feature picker pricing and validation.
9. Engine fixtures and expected outputs affected by unlocked-class pricing.
10. Guide-versus-engine price checker.
11. Simulator configuration and expected break-even output.
12. Rules version.

## Required verification

### Unlock-cost tests

For every supported count of origin classes and every valid foreign-class unlock position, verify:

```text
marginal unlock cost = 7 AP
cumulative unlock cost = number of foreign unlocks × 7 AP
```

Include at least:

- one origin class;
- two origin classes, if supported;
- first foreign-class unlock;
- second foreign-class unlock;
- middle valid unlock;
- final valid unlock;
- attempted lookup beyond the final valid unlock;
- malformed or impossible unlock ordinal.

### Bounds and safety tests

Prove that no valid or invalid lookup can return:

```text
negative cost
refund
free unlock caused by missing data
undefined/null/NaN cost
```

Specify the exact expected behaviour for impossible input: controlled rejection, explicit error, or a deliberate clamp. Do not rely on an implicit language-level fallback.

### Pricing-route parity tests

For every mirrored class-gated ability, verify that the subclass picker and general catalogue produce identical results for:

- origin-class character;
- unlocked foreign class;
- locked foreign class;
- any supported multi-origin configuration.

The parity gate must report:

```text
0 failed
```

### Guide-versus-engine tests

The guide-versus-engine checker must report:

```text
0 mismatches
```

Check all three price states:

```text
origin
sticker/unlocked foreign class
cross-class/locked foreign class
```

### Break-even simulation

Re-run the simulator using the same real-build definitions and real ability pricing data.

The expected policy result for flat 7 is:

```text
1st foreign class: unlock wins at 3 purchases
2nd foreign class: unlock wins at 3 purchases
3rd foreign class: unlock wins at 3 purchases
4th foreign class: unlock wins at 3 purchases
```

Define precisely:

- ability purchase order;
- whether equality counts as break-even or only strictly lower cost;
- optimiser tie-breaking behaviour;
- rules-data version;
- build fixtures used.

Commit the simulator inputs and expected output so another developer can reproduce the result.

### UI verification

Confirm that the character generator:

- displays 7 AP for every valid foreign-class unlock;
- continues to display 7 AP after another foreign class is unlocked;
- never displays a negative, free or missing cost;
- clearly distinguishes origin, unlocked and locked foreign pricing;
- does not display the contested prohibition warning;
- shows the same price the engine will actually charge.

### Version and fixture verification

Update expected-output fixtures in the same change as the engine pricing logic. Bump the rules version once in that coordinated change.

The change is not complete if engine, guide, UI and fixture expectations disagree.

## Additional analysis recommended, but not blocking the flat-7 change

The current evidence supports flat 7 better than the tested alternatives, but later balance work should measure:

### Distributional break-even

Across many valid ability combinations and purchase orders, report:

- minimum break-even;
- median break-even;
- mean break-even;
- maximum break-even;
- break-even distribution by total Tier;
- effect of purchasing high-Tier abilities first or last.

Purchase count is only an approximate measure of investment because abilities range from Tier 1 to Tier 7 and the surcharge scales with Tier.

### Complete-build comparisons

At representative early-, middle- and mature-character AP budgets, compare:

- origin specialist;
- origin plus one dabble;
- origin plus one unlocked foreign class;
- two-class split;
- three-class generalist;
- magpie.

Measure total AP allocation, number and Tier of abilities, and the remaining origin-class advantage.

### Synergy and cherry-picking

Test curated high-synergy, high-Tier, low-Tier and commonly desired foreign abilities. The balance risk of broad dabbling depends more on capability combinations than on the number of class names present on the character sheet.

### Player comprehension

Check whether players can correctly predict:

- when an unlock becomes worthwhile;
- the difference between origin, sticker and cross-class prices;
- whether earlier surcharge payments are sunk costs;
- the cost of their next unlock.

Flat 7 should be easier to understand than the ladder, but that should eventually be confirmed with players.

## Decision sequencing

### Immediate correctness work

Implement these regardless of final balance discussion:

1. Remove free, refund and negative unlock outcomes.
2. Replace unsafe missing-entry handling.
3. Remove the unsupported gate or warning.
4. Make both ability-purchase routes consistent.
5. Add complete bounds and route-parity tests.

### Pricing-policy work

Implement flat 7 AP across the engine, guide and UI, then re-run the simulator and parity checks.

### Deferred breadth decision

Do not implement a magpie penalty or accruing ladder in this change. Track broad dabbling as a separate balance question requiring synergy analysis and playtest evidence.

## Definition of done

This work is complete only when all of the following are true:

- Every valid non-origin class unlock costs exactly 7 AP.
- Unlock order does not affect the marginal price.
- One- and two-feature foreign-class dabbles remain available without an unlock.
- The origin discount remains unchanged.
- The sticker and cross-class formulas remain unchanged.
- No class unlock can be free, negative or generate a refund because of missing data.
- Multi-origin configurations are covered safely.
- The provisional cross-class prohibition warning is removed.
- Mirrored purchase routes produce identical eligibility and pricing.
- The engine parity gate reports 0 failures.
- The guide-versus-engine checker reports 0 mismatches.
- The simulator confirms the intended third-purchase break-even at every tested rung.
- The UI displays the exact cost charged by the engine.
- Fixtures are updated.
- The rules version is bumped.
- No dabble-accrual or magpie-tax mechanic is introduced in this change.

## Concise instruction to the coding AI

Implement a **flat 7 AP cost for every non-origin class unlock**, replacing the 7N ladder and its incomplete cumulative table. Preserve individual cross-class purchases at the existing `+Tier` surcharge, retain the origin discount and sticker-price formulas, remove the provisional cross-class warning, and ensure the subclass and general-feature purchase routes behave identically. Add exhaustive bounds tests so missing or out-of-range entries can never create a free unlock, refund or negative cost. Update the engine, Players Guide §11, UI, fixtures, simulator expectations and rules version together. Do not add an accruing ladder, breadth tax or magpie penalty in this change.
