> Triaged in session: (no session link available in this environment), 2026-10-20

Nemotron 3 Super (default settings)

1. **Does this achieve the goal?**  
   Yes. The proposal replaces the inert 5 AP “Primal Order” feature with two purchasable keys:  
   - *Druid: Primal Order (Magician)* at 6 AP (granting a cantrip and a Wisdom‑based skill bonus).  
   - *Druid: Primal Order (Warden)* at 0 AP (triggering the four proficiency flags that together cost the same as buying Simple weapons, all martial weapons, Light armour and Medium armour separately).  
   An alias maps the old key to the Magician option, allowing existing logs to replay as Magician. A Druid can therefore buy Magician, Warden, both, or neither, satisfying the stated goal.

2. **Which assumptions look shaky?**  
   - **Zero‑AP feature pricing:** The plan assumes the pricing loop can handle a feature priced at 0 AP without special‑case logic. If the loop skips zero‑cost entries or treats them as invalid, Warden would not apply.  
   - **Deriving proficiencies at compute time:** It assumes the engine can treat ownership of the Warden key as equivalent to setting the four proficiency flags during `compute()`, without storing those flags elsewhere. If any part of the engine expects the flags to be stored on the build object, the derived approach could miss updates or cause inconsistencies.  
   - **Location for the Wisdom‑based skill bonus:** The document notes that a flat “+WIS mod to Arcana/Nature” bonus has no existing home in the engine and that the placement must be decided in review. If no suitable hook exists, implementing this bonus may require broader changes than anticipated.  
   - **Alias handling for future renames:** Only the old key is aliased to Magician. If the Warden key were ever renamed or removed, a similar alias would be needed; the plan does not mention this contingency.

3. **Is there a better alternative, especially to the two‑key design?**  
   The considered alternative of a single feature with a stored choice field (E2) would match the source material more closely but would require a new choice mechanism in the engine, which the author wishes to avoid. The two‑key approach reuses existing patterns (feature keys, pricing, aliases) and needs only minor engine additions, making it a pragmatic fit for the codebase. Other alternatives (priced Warden with prerequisites, bundled Warden, or dropping Warden) either introduce double‑charging, require new engine checks, or fail to meet the owner’s design choice. Thus, the two‑key design appears to be the most suitable given the constraints.

4. **What is missing?**  
   - **Concrete engine implementation details:** Where exactly in `compute()` the Magician cantrip grant and Wisdom‑based skill bonus should be added is left “to be decided in review.” The review cannot verify correctness without this detail.  
   - **UI/sheet display guidance:** How the new cantrip and skill bonus will be presented to players (Live Sheet, CharGen, Players Guide) is mentioned only at a high level; concrete changes to the guide‑check script or UI components are not specified.  
   - **Decision on the existing player’s AP increase:** The plan notes that the one live player’s total may rise by 1 AP (recorded 5 AP vs. priced 6 AP) and that a decision is needed (let it rise or grandfather the player), but no resolution is recorded.  
   - **Edge‑case test coverage:** While fixtures (a)–(d) are listed, the document does not show the actual test data or confirm that all combinations (e.g., Warden + Martial + Medium bought separately, Warden + Simple + Light + additional proficiencies) are covered.  
   - **Version‑bump scope:** It states that only `DATA.version` should be bumped, but does not verify that no other version‑like constants (e.g., BUILD, cache‑busting strings) need updating.

5. **Is “Verification” objectively checkable?**  
   Yes. The verification items are concrete, observable outcomes:  
   - The parity test (`engine-parity`) reports 0 failures after adding fixtures (a)–(d).  
   - The guide price check shows no new mismatches for the Druid rows.  
   - Replaying the real player’s saved log yields no “no longer in the rules data” warning and the feature appears as Magician.  
   - Fixture (a) demonstrates exactly 9 AP weapon proficiency + 6 AP armour proficiency.  
   Assuming the fixtures are implemented as described, each item can be objectively validated by running the existing test suite and guide‑check script.

6. **Should this be split into several plans?**  
   Not necessarily. The change is tightly scoped: it touches data (feature keys, aliases), engine (proficiency handling, cantrip/skill bonus), tests, guide text, and version/changelog. All of these are logical parts of a single feature split. Splitting them into separate plans would create unnecessary overhead and risk of desynchronization (e.g., engine changes landing before guide updates). The current plan already delineates the required steps clearly, so a single, cohesive plan is appropriate.  

---  
*Save this review as `primal-order-magician-warden-review-Nemotron 3 Super.md`.*