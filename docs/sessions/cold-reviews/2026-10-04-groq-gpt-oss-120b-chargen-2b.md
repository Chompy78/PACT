> Triaged in session: Claude Code, PACT repo, 2026-10-04 (overnight autonomous round). Real model called: `gpt-oss-120b` via API; the model's own self-identification line below is wrong/unreliable — see the plan's Review outcome.

# Model: gpt‑4‑1106‑preview (direct API call)

## Review of “Plan — CharGen records post‑lock spellcasting changes as in‑play purchases (phase 2b)”

### (a) Does this achieve the goal?

Yes.  
The plan describes a concrete transformation of the current *in‑place* rewrite behaviour for spell‑related slots into a **diff‑→‑append** workflow that mirrors the Live Sheet’s purchase model.  

* For `traditions` it specifies a pure diff algorithm that produces a sequence of indexed mutation events (`found`, `rank`, `cantrip`, `slot`, `known`) that can be priced, legality‑checked and appended as a single undoable step – exactly what the goal demands.  
* For the other slots (`innate`, `misc`, `identity`) it explicitly calls for refusal, matching the rule that those categories have no Live Sheet equivalent or are creation‑only.  

If the implementation follows the described algorithm and the refusal paths are wired into the UI, the post‑lock CharGen tool will no longer rewrite historic purchase data and will instead generate the same event log that the Live Sheet would have produced. Thus the stated goal is met in principle.

---

### (b) Which assumptions are shakiest?

| # | Assumption | Why it is fragile |
|---|------------|-------------------|
| a | **Order `found → rank → cantrip/slot/known` always satisfies prerequisites**. | The Live Sheet enforces UI gating, but the diff runs on arbitrary JSON patches supplied by the CharGen form. If a user manually edits JSON (or a future UI change permits out‑of‑order edits) the algorithm could generate a step that violates rank requirements, causing `purchaseLegality` to reject mid‑sequence. |
| b | **`priceOf` works as a simple delta from the current build for each indexed mutation**. | `priceOf` may incorporate cross‑category effects (e.g., discounts from `bound` or synergy bonuses). The plan assumes a per‑step delta is correct, but no evidence is given that the engine’s pricing logic is purely additive for these mutations. |
| c | **Form cannot reorder or rename traditions/disciplines**. | The plan relies on a “prefix check” that assumes the incoming array preserves order and names. If a later UI change allows drag‑and‑drop reordering or editing of a tradition’s name, the diff will refuse the whole edit, potentially surprising users. |
| d | **Refusing `arcanum`/`pactSlots` never blocks a legitimate workflow**. | Warlock characters may gain extra arcanum or pact slots through class features that are *derived* rather than purchased. If the form reflects those derived values (e.g., after a level‑up), the diff could see a change and refuse it, leaving the UI out of sync. |
| e | **All six verification groups are fully automated and deterministic**. | The description of the test harness is high‑level; it does not guarantee that every edge case (e.g., large numbers of traditions, simultaneous rank and slot increments) is covered. Randomised property tests are mentioned but not detailed. |

---

### (c) Is there a better alternative (including Alternative A)?

**Alternative A (make CharGen read‑only for spellcasting after lock)** is the cleanest from a correctness standpoint. It eliminates the need for a complex nested‑array diff, removes the risk of index drift, and guarantees parity with the Live Sheet because the user must use the Live Sheet for any post‑lock spell changes.

*Pros of Alternative A*  
- Zero code for diffing nested structures.  
- No risk of accidental mis‑pricing or illegal step ordering.  
- Simpler UI/UX: CharGen becomes a “view‑only” snapshot after lock, reducing user confusion.

*Cons*  
- The owner’s stated requirement is that a player be able to spend any leftover AP from character creation **after** lock without switching tools. This convenience would be lost.

If the convenience requirement is non‑negotiable, the current plan is justified, but the team should weigh the maintenance burden and potential for subtle bugs against the user‑experience gain. A hybrid approach could be considered: keep CharGen read‑only for *spellcasting* but allow *other* post‑lock purchases (e.g., `hdProf`, `stats`) as already implemented. This would satisfy most use‑cases while drastically reducing risk.

---

### (d) What is missing — wrong step orders, edge cases in the nested‑array diff, flows that would be blocked by mistake?

1. **Handling simultaneous rank and slot increments**  
   - The algorithm lists rank steps *before* any slot/known steps, but does not explicitly enforce that a slot increase beyond the new rank’s maximum is disallowed. A test where a user raises a rank from 1→3 and adds a level‑3 slot in the same edit could generate a `slot` step for L3 before the rank has been fully applied, triggering a legality failure mid‑sequence. The plan should either batch rank steps first or validate the entire target state before generating steps.

2. **Multiple disciplines under the same tradition**  
   - The prefix check only validates that existing disciplines match by *position* and *name*. If a user adds a new discipline between two existing ones, the index of the second existing discipline shifts, causing later steps to target the wrong discipline. The plan should either enforce “append‑only” discipline creation **after** all existing disciplines or use a stable identifier (e.g., discipline `id`) rather than positional index.

3. **Bound flag toggling**  
   - The diff refuses both `false→true` and `true→false` for `bound`. However, the rule for AP‑granting purchases is “players cannot acquire them after lock”, but a *removal* of an existing bound flag (i.e., `true→false`) might be permissible (it would *remove* a -2 AP grant). The plan currently treats it as a refusal, which could block a legitimate “undo” of a pre‑lock bound discipline that a player wishes to keep after lock.

4. **Empty traditions array**  
   - If a character starts with zero traditions (possible for non‑spellcasters) and later adds one, the prefix check passes (no `i < cur.length`). The diff will generate a `found` step, which is fine. However, the algorithm does not specify how to handle *removing* the *last* tradition (which should be refused) – the prefix check will catch missing tradition at index 0, but the error message should be explicit.

5. **Cross‑category side‑effects**  
   - Certain purchases (e.g., `mbound`) affect AP discounts that influence subsequent spell purchases. The plan assumes `priceOf` per step accounts for such discounts, but the ordering of steps could change total cost (e.g., buying a slot before a bound discount vs after). The diff should order discount‑granting steps **before** any cost‑incurring steps to reflect the intended pricing.

6. **User feedback on refusals**  
   - The plan mentions “plain message and the control put back” but does not define the UI flow. For a good UX, the message should indicate *why* the edit was refused (e.g., “Cannot lower rank after lock”, “Bound spells cannot be added post‑lock”). Missing this could lead to confusion.

---

### (e) Is the verification objectively checkable?

Yes, the verification criteria are **objectively testable**:

- **Head‑to‑head event parity** can be asserted by recording the exact JSON events from both tools and comparing them field‑by‑field.  
- **Refusal cases** can be verified by asserting that no new events are appended, that the spent AP total remains unchanged, and that the UI returns to its prior state.  
- **Affordability** can be validated by checking that the sum of `cost` fields does not exceed the character’s AP pool.  
- **Randomised property tests** (≥200 increase‑only edits) are deterministic given a fixed seed and can be run in CI.  

All of these can be expressed as unit or integration tests using the existing harness. The only non‑deterministic aspect is the UI message content, which should be part of the test assertions.

---

### (f) Should the plan be split (e.g., traditions vs the three refusals)?

**Recommendation: Yes, split into two separate deliverables.**

1. **Traditions diff & purchase path** – This is the most complex, highest‑risk component (nested array diff, ordering, pricing). It deserves focused code review, dedicated tests, and possibly a separate feature flag for incremental rollout.

2. **Refusal handling for innate, misc, identity** – These are comparatively simple “guard” cases (reject and display a message). They can be implemented quickly and validated with a small test suite.

Splitting allows the team to ship the refusal guard logic early (providing immediate safety for unsupported slots) while the more intricate diff work is still under development. It also clarifies ownership and makes CI feedback more granular.

---

## Summary of Recommendations

1. **Proceed with the diff implementation** but add the following safeguards:
   - Validate the *target* build state before emitting steps (ensures rank prerequisites are met).
   - Use stable identifiers for traditions/disciplines or enforce append‑only discipline creation.
   - Order discount‑granting mutations (`bound` changes) before cost‑incurring ones.
   - Clarify refusal messages and UI flow.

2. **Re‑evaluate Alternative A**: if the post‑lock spell‑spending convenience is low‑priority, consider making CharGen read‑only for spellcasting to eliminate the diff risk entirely.

3. **Split the work** into “Refusal guards” and “Traditions diff” tickets to reduce integration risk and accelerate delivery of the safe parts.

4. **Expand the test matrix** to include:
   - Multi‑discipline reordering attempts (should be refused).
   - Simultaneous rank and slot upgrades.
   - Edge case of removing a bound flag.
   - Warlock arcanum/pact slot derived changes (ensure they are ignored, not refused).

With these refinements, the plan should robustly achieve its goal while keeping the project's risk profile manageable.