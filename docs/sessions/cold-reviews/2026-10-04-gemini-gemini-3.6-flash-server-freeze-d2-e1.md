> Triaged in session: Claude Code, PACT repo, 2026-10-04 (overnight autonomous round). Real model called: `gemini-3.6-flash` via API; the model's own self-identification line below is wrong/unreliable — see the plan's Review outcome.

Model: Claude 3.7 Sonnet (API call, default temperature/settings)

# Review: Server-side freeze of a locked character's priced history (D2 / E1)

*File identification: `server-freeze-review-claude-3.7-sonnet.md`*

---

## Overall Assessment

This is an exceptionally well-structured, context-complete technical proposal. The document provides all necessary schema details, trigger logic, background incidents, and risk mitigations inline, fulfilling the "cold review" requirement.

The core diagnosis—that `pact_ap_ledger_protected` systematically excludes all `cat = 'patch'` events, leaving a massive security and data integrity hole—is correct. The proposed remedy (extending the protection list to priced keys within `patch` events and enforcing the lock boundary `v_lock_idx`) directly addresses the vulnerability.

However, there are critical subtle edge cases in client-side data serialization and historical data structure that could cause **false refusals** for legitimate players.

---

## Detailed Answers to Specific Questions

### (a) Does this achieve the goal without refusing legitimate saves?

**It achieves the security goal, but carries a high risk of refusing legitimate saves under specific, common conditions.**

1. **The "Mixed Patch Event" Trap:**
   The plan states: *"An event mixing keys is protected if any key is priced."*
   If a character's creation-era `patch` event contains both priced keys (e.g., `{ stats: { STR: 14 }, appearance: { eyeColor: "blue" } }`), protecting this event freezes the *entire* event payload. If the player later edits their appearance in play, and the client attempts to update the existing appearance patch in place (as stated under *Client behaviour*: *"the creation tool still edits the appearance patch event in place after the lock"*), the server trigger will detect a modification to a protected event index and **refuse the save**.

2. **JSON Key Ordering / Serialization Mismatches:**
   `pact_ap_ledger_protected` strips top-level fields (`seq`, `ts`, `rules`, `label`) and compares event objects. If the browser JS engine or Supabase JSONB parser normalizes or reorders object keys inside `payload.patch` (e.g., changing `{ "hd": 4, "stats": ... }` to `{ "stats": ..., "hd": 4 }`), positional comparison between `OLD.log` and `NEW.log` will fail, resulting in a false refusal.

---

### (b) Which assumptions are shakiest?

1. **Assumption (a) & (c): "An event mixing keys is protected if any key is priced" + "No legitimate client flow rewrites a priced patch event."**
   *Why it's shaky:* Creation tools frequently bundle state updates into a single patch event during initial character generation. If unpriced metadata (appearance, house rules, notes) was co-located in the same `patch` event as priced data during creation, any post-lock edit to that unpriced metadata will trigger a server refusal if the client edits the patch in place.

2. **Assumption (b): "Positional comparison of the protected list is still correct once patch events join it."**
   *Why it's shaky:* Positional array comparison (`protected_old[i] != protected_new[i]`) assumes that protected events are strictly append-only and immutable. If client-side code "cleans up" or re-orders historical events during load/hydration (e.g., re-sorting `patch` fields or merging contiguous patches), exact positional equality breaks even if the semantic character state is identical.

3. **Assumption (d): `character_backups` is a faithful history.**
   *Why it's shaky:* If previous client bugs or admin manual fixes resulted in malformed states in historical backups, replaying them might yield false negatives (passing bad transitions) or false positives (failing on past valid fixes).

---

### (c) Is there a better alternative to the two-function change?

The current proposal modifies two existing functions (`pact_ap_ledger_protected` and `pact_enforce_locked_history`) in a single migration. This is cleaner than adding a second trigger (Alternative A). 

However, an improvement to the approach within these functions would be:

* **Sanitize/Normalize `payload.patch` at the boundary rather than treating the whole patch event as monolithic:**
  Instead of protecting the entire `patch` event if *any* key is priced, `pact_ap_ledger_protected` could project **only the priced key-value pairs** out of `payload.patch`.
  * Example projection: If an event has `{ hd: 4, appearance: { eyes: "blue" } }`, the protected version of that event only contains `{ hd: 4 }`.
  * **Benefit:** Modifying `appearance` in place later won't change the protected projection, preventing false refusals while keeping `hd` fully frozen.

---

### (d) What is missing?

1. **Case Sensitivity and JSON Field Normalization:**
   PostgreSQL `jsonb` field extraction is case-sensitive. If client code sends `ProfBonus` vs `profBonus` or subtle casing variations, a priced key could bypass the protected filter.

2. **DM Re-lock Edge Case (Creation Re-opening Lifecycle):**
   When a DM reopens creation (`creationUnlocked` appended), the character is no longer "currently locked" (`last creationLocked` is before `last creationUnlocked`).
   * The plan states: *"If the character is not currently locked... the lock boundary does not apply."*
   * **Missing detail:** When the player finishes re-editing and appends a *new* `creationLocked`, `v_lock_idx` now points to this *new* lock event. Does the new lock freeze the edits made during the unlocked period? Yes. But what if a seal or award existed *before* the reopen? The plan handles this (`v_idx = greatest(seal, award, lock)`), but test cases should explicitly verify that a DM reopen does **not** allow mutating pre-seal/pre-award events.

3. **Attacker Vector: Moving priced keys out of `patch` into unprotected event types:**
   Can an attacker submit an event with an unrecognized category or bypass key classification by using nested objects? Ensure the key inspection in `pact_ap_ledger_protected` inspects top-level keys of `payload.patch` deterministically.

---

### (e) Is the verification objectively checkable?

**Yes, the verification plan is exceptionally strong and measurable.**
* The Docker harness provides clear binary pass/fail conditions for attack vectors and regression cases.
* The backup-replay audit and headless client round-trip audit provide quantitative safety metrics before production deployment.
* Byte-identical rollback checking via `pg_get_functiondef` guarantees zero-risk deployment reversibility.

*Recommendation for Verification Step 4:* Define an explicit acceptance threshold for the backup-replay audit (e.g., "0 unexpected refusals out of N transitions").

---

### (f) Should this be split?

**The split strategy in the document (Stage 1 now, Stage 2 later) is correct and necessary.**

* **Stage 1 (Immediate):** Apply lock boundary D2 + Stage 1 priced keys (slots the client already appends correctly).
* **Stage 2 (Deferred):** Apply Stage 2 keys (`traditions`, `innate`, `originClass`, etc.) **only after** the corresponding client-side spellcasting and identity update is deployed and verified in production.

Splitting the SQL migration script itself is not needed; staging via key lists in Stage 1 and Stage 2 provides the exact safety isolation required.

---

## Risk & Mitigation Summary

| Risk | Criticality | Recommended Action |
| :--- | :--- | :--- |
| **Mixed Patch Edit Refusal** | High | Modify `pact_ap_ledger_protected` to extract/project *only* priced keys from `payload.patch` rather than freezing the entire patch event. |
| **JSON Key Ordering Failure** | Medium | Ensure PL/pgSQL JSON comparisons use `jsonb` canonical key ordering or key-sorted extraction. |
| **Stage 2 Key Leakage** | Low | Hard-code Stage 1 key list explicitly in SQL migration; do not include Stage 2 keys until client release. |

---

## Conclusion & Recommended Outcome

**Conditional Approval.** The plan is logically sound and directly solves the exploit. Before executing the migration on production, update the design of `pact_ap_ledger_protected` to **project only priced keys** out of `payload.patch` (rather than blocking the whole event if a priced key is present), avoiding false refusals on historical mixed patch events.