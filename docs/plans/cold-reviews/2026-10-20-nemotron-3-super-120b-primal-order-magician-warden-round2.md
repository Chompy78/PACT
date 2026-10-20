> Triaged in session: (no session link available in this environment), 2026-10-20

Nemotron 3 Super, temperature 0

**1. Does this achieve the goal?**  
Yes. The plan replaces the inert 5 AP “Primal Order” (and the analogous Cleric “Divine Order”) with two purchasable options — Magician/Warden for Druid and Thaumaturge/Protector for Cleric — matching the 2024 D&D split. It provides the prescribed cantrip grant, Wisdom‑based skill bonus, and weapon/armour proficiency flags, with Warden/Protector priced at 0 AP (cost derived from existing proficiency prices). The legacy handling preserves the existing player’s purchase at 5 AP while granting the intended martial‑weapon/Medium‑armour benefit, so no character’s AP total changes unintentionally.

**2. Which assumptions look shaky?**  
- **Zero‑AP pricing for Warden/Protector:** The plan assumes a feature can be priced at 0 AP without special‑case code in the pricing loop. While the comment says this is untested, the engine’s current handling of 0‑AP items is not described, making this a risk.  
- **Derived proficiency flags:** Warden/Protector’s benefits are to be applied at compute time by temporarily setting weapon/armour flags. The assumption that this can be done without storing the flags and without interfering with other proficiency logic needs verification (e.g., warning generation, double‑charge prevention).  
- **Skill‑check bonus location:** No existing home for a flat “+WIS mod to Arcana/Nature (or Religion)” bonus is identified; the plan defers the exact implementation location, which is a major unknown.  
- **Free‑feat proficiency counted first:** The formula “paid cost = table price(paid + free) − table price(free)” assumes the engine can correctly apply the free proficiency before pricing other proficiencies and that the table price function is monotonic with count. This is plausible but not proven in the current code.  
- **Legacy grant leakage:** The grandfathered grant (martial weapons + Medium armour, no Simple/Light) is tied to the legacy key via `bar:true`. The assumption that it will not affect new Warden/Protector keys or other characters relies on the engine correctly restricting the grant to the legacy key only.  

**3. Is there a better alternative, especially to the two‑key design?**  
The two‑key design mirrors existing patterns (multiple purchasable feature variants) and avoids adding a new choice mechanism. The alternative of a single feature with a stored choice field would require UI and engine changes to handle the choice state, increasing complexity. Given that the two‑key approach behaves identically to the player and fits the current data‑driven model, it is the better alternative unless there is a strong need to keep a single feature key for semantic reasons. No clearly superior alternative is presented in the document.

**4. What is missing?**  
- **Exact engine hook for the Wisdom‑based skill bonus** (where in `compute()` the bonus is added, and how it is exposed to the UI for display).  
- **Details on how the derived flags are applied** (e.g., a helper function that adds the flags temporarily, ensures warnings are suppressed for the legacy grant, and prevents double‑charging when the player later buys Simple or Light).  
- **Explicit handling of feature removal** (if a removal path exists, what happens to the legacy grant when the legacy key is removed; if no removal path exists, a note that this is out of scope).  
- **Migration test for saved logs containing the free‑feat proficiency** (to confirm that existing logs with Chef/Crafter/Musician are priced correctly under the new “counted first” rule).  
- **Clarification on guide updates** – the plan mentions updating the Players Guide but does not specify which sections (feature table, proficiency pricing explanation, feat section) need changes to reflect the new counting rule and the zero‑AP Warden/Protector cost.  
- **Decision record content** – while the plan mentions logging a decision record, it does not state what specific decisions (e.g., Y1/Z1, U1, V1a, W3/X1, Q3) will be recorded, which would aid traceability.

**5. Is “Verification” objectively checkable?**  
Yes, the verification items are concrete and observable:  
- Parity test page reporting 0 failed after adding fixtures (a)–(h).  
- Guide price check showing no new mismatches for Druid and Cleric rows.  
- Replay of the real player’s log producing no “no longer in the rules data” warning, same AP total, and correct proficiency display (martial weapons + Medium armour, no Simple/Light).  
- Fixture (a) showing 9 AP weapon + 6 AP armour proficiency.  
These can be checked by running the test suite and inspecting the guide, making the verification objectively verifiable.

**6. Should this be split into several plans?**  
The plan now encompasses multiple interconnected changes:  
- Splitting Druid and Cleric origin features.  
- Implementing the legacy grandfathered grant with `bar:true`.  
- Adding free‑feat proficiency counted first.  
- Adding the Wisdom‑based skill bonus.  
- Updating the Players Guide and decision record.  
While each piece is logically related to the overall goal, the breadth increases review and implementation complexity. Splitting into, for example, (1) feature split + legacy grant, (2) free‑feat proficiency rule, and (3) skill‑bonus implementation could simplify verification. However, the owner has indicated a preference to keep it as one plan, and the verification strategy already ties the pieces together (fixtures test interactions). If the team is comfortable managing the combined scope, keeping it as one plan is acceptable; otherwise, a phased approach would reduce risk.

**Overall assessment:** The plan is well‑structured and addresses the stated goal. The primary risks lie in the untested assumptions (zero‑AP pricing, derived flags, skill‑bonus location, free‑feat counting). Addressing those with targeted spikes or prototypes before full implementation would mitigate uncertainty. Once those are clarified, the plan should be ready for execution.